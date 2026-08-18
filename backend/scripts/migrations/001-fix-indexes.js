import mongoose from "mongoose";
import logger from "../../src/utils/logger.js";

export const name = "001-fix-indexes";

export const description =
  "Tạo index đúng cho Conversation/Message/Friend và drop các index sai hoặc dư thừa";

/*
 * KHÔNG dùng `mongoose.syncIndexes()`.
 *
 * syncIndexes drop MỌI index không được khai báo trong schema — trên một cluster
 * production đó chính là cách người ta xoá mất những index mình đã quên. Ở đây mọi
 * thao tác đều tường minh, và drop chỉ diễn ra SAU khi index thay thế đã build xong.
 */

const createIndex = async (collection, keys, options = {}) => {
  // Xem index đã có chưa TRƯỚC khi tạo, để log nói đúng sự thật.
  //
  // `createIndex` trên một index đã tồn tại là no-op và vẫn trả về tên, nên nếu
  // cứ thế log "+ tạo" thì lần chạy thứ hai trông y hệt lần đầu — mà chạy lại
  // rồi đối chiếu log chính là cách ta kiểm chứng tính idempotent.
  //
  // `indexes()` ném lỗi khi collection chưa tồn tại; coi như chưa có index nào.
  const existing = new Set((await collection.indexes().catch(() => [])).map((i) => i.name));

  const name = await collection.createIndex(keys, options);

  logger.info(
    existing.has(name)
      ? `  · index ${collection.collectionName}.${name} đã có, bỏ qua`
      : `  + tạo index ${collection.collectionName}.${name}`,
  );

  return name;
};

// 27 = IndexNotFound, 26 = NamespaceNotFound.
//
// NamespaceNotFound xảy ra khi cả collection còn chưa tồn tại — chuyện rất bình
// thường trên một database mà một collection nào đó chưa có document nào. Nếu
// không bắt mã này, migration sẽ dừng giữa đường và các bước sau không chạy.
const IGNORED_DROP_CODES = new Set([26, 27]);

const dropIndexIfExists = async (collection, indexName) => {
  try {
    await collection.dropIndex(indexName);
    logger.info(`  - drop index ${collection.collectionName}.${indexName}`);
  } catch (error) {
    if (
      IGNORED_DROP_CODES.has(error.code) ||
      /index not found|ns not found/i.test(error.message)
    ) {
      logger.info(`  · ${collection.collectionName}.${indexName} không có, bỏ qua`);
      return;
    }
    throw error;
  }
};

export async function up() {
  const { db } = mongoose.connection;
  const conversations = db.collection("conversations");
  const messages = db.collection("messages");
  const friends = db.collection("friends");
  const users = db.collection("users");

  // --- Conversation ---
  // Index cũ có key "participant.userId" (số ít) — một path không tồn tại, nên nó
  // không phục vụ query nào và mọi lượt lấy danh sách conversation đều full scan.
  await createIndex(conversations, { "participants.userId": 1, lastMessageAt: -1 });
  await dropIndexIfExists(conversations, "participant.userId_1_lastMessageAt_-1");

  // --- Message ---
  // Khoá kép cho cursor keyset.
  await createIndex(messages, { conversationId: 1, createdAt: -1, _id: -1 });

  // Chặn trùng khi client retry. partialFilterExpression loại mọi document cũ
  // (không có clientMessageId) nên an toàn với dữ liệu đang chạy.
  await createIndex(
    messages,
    { conversationId: 1, clientMessageId: 1 },
    { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } },
  );

  // Hai index này là prefix của index kép ở trên nên không còn tác dụng gì.
  await dropIndexIfExists(messages, "conversationId_1_createdAt_-1");
  await dropIndexIfExists(messages, "conversationId_1");

  // --- Friend ---
  await createIndex(friends, { userB: 1 });

  // --- User ---
  // `phone` từng khai báo sparse mà không unique, nên index (nếu có) là vô nghĩa.
  await dropIndexIfExists(users, "phone_1");
}
