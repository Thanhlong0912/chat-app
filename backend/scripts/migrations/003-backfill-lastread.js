import mongoose from "mongoose";
import logger from "../../src/utils/logger.js";

export const name = "003-backfill-lastread";

export const description = "Suy ra participants[].lastReadAt từ unreadCounts và lastMessage";

/*
 * Vì sao fallback là `joinedAt` chứ không phải `null`.
 *
 * `null` nghĩa là "chưa đọc gì cả", nên mọi conversation cũ sẽ hiện lên như thể
 * toàn bộ lịch sử đều chưa đọc — người dùng mở app lên và thấy hàng nghìn tin chưa
 * đọc. Dùng `joinedAt` giữ badge gần đúng với trạng thái hiện tại, và
 * `unreadCounts` đang lưu vẫn được dùng cho badge tới lần `advanceRead` kế tiếp,
 * lúc đó con trỏ sẽ được tính lại chính xác.
 */
export async function up() {
  const conversations = mongoose.connection.db.collection("conversations");

  const cursor = conversations.find(
    {},
    { projection: { participants: 1, lastMessage: 1, lastMessageAt: 1, unreadCounts: 1 } },
  );

  let scanned = 0;
  let updated = 0;
  const ops = [];

  for await (const convo of cursor) {
    scanned += 1;

    const participants = convo.participants ?? [];
    if (!participants.some((p) => p.lastReadAt == null)) continue;

    const lastSenderId = convo.lastMessage?.senderId
      ? String(convo.lastMessage.senderId)
      : null;
    const lastMessageAt = convo.lastMessageAt ?? convo.lastMessage?.createdAt ?? null;
    const unread = convo.unreadCounts ?? {};

    const nextParticipants = participants.map((p) => {
      if (p.lastReadAt != null) return p;

      const userId = String(p.userId);
      const count = unread[userId] ?? 0;
      // Đã đọc hết nếu badge bằng 0, hoặc nếu chính họ là người gửi tin cuối.
      const caughtUp = count === 0 || userId === lastSenderId;

      return {
        ...p,
        lastReadAt: caughtUp ? (lastMessageAt ?? p.joinedAt ?? null) : (p.joinedAt ?? null),
        lastReadMessageId:
          caughtUp && convo.lastMessage?._id ? toObjectId(convo.lastMessage._id) : null,
      };
    });

    ops.push({
      updateOne: {
        filter: { _id: convo._id },
        update: { $set: { participants: nextParticipants } },
      },
    });

    if (ops.length >= 500) {
      updated += (await conversations.bulkWrite(ops)).modifiedCount;
      ops.length = 0;
    }
  }

  if (ops.length) {
    updated += (await conversations.bulkWrite(ops)).modifiedCount;
  }

  logger.info(`  quét ${scanned} conversation, cập nhật ${updated}`);
}

/**
 * `lastMessage._id` từng được khai báo là String nên dữ liệu cũ lưu chuỗi hex.
 * Chuỗi hex cast sạch sang ObjectId; nếu vì lý do nào đó không hợp lệ thì bỏ qua
 * chứ không làm dừng cả migration.
 */
const toObjectId = (value) => {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
};
