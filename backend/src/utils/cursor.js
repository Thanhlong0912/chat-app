import mongoose from "mongoose";
import { badRequest } from "./errors.js";

/**
 * Cursor phân trang keyset trên khoá kép `(createdAt, _id)`.
 *
 * Vì sao phải là khoá kép: `createdAt` một mình không phân biệt được các tin nhắn
 * trùng millisecond — mà đó là chuyện thường xuyên (insertMany, hoặc gửi liên tiếp
 * trong cùng một ms). Khi đó mọi tin nhắn trong nhóm đó chia sẻ cùng một giá trị
 * cursor và sẽ bị bỏ sót hàng loạt hoặc trả về lặp. `_id` của Mongo so sánh được
 * theo thứ tự nên phá hoà một cách xác định, cho ta một thứ tự tổng mà không cần
 * thêm cột `seq` (vốn kéo theo một điểm tranh chấp ghi trên mỗi tin nhắn).
 *
 * Cursor được mã hoá base64url và coi là opaque: client không được tự dựng nó,
 * nên sau này đổi khoá sắp xếp không phá vỡ client.
 */
export const encodeCursor = (doc) => {
  if (!doc) return null;

  const payload = JSON.stringify({
    t: new Date(doc.createdAt).toISOString(),
    i: String(doc._id),
  });

  return Buffer.from(payload, "utf8").toString("base64url");
};

export const decodeCursor = (cursor) => {
  if (!cursor) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
  } catch {
    throw badRequest("INVALID_CURSOR", "Cursor không hợp lệ");
  }

  const createdAt = new Date(parsed?.t);

  if (Number.isNaN(createdAt.getTime()) || !mongoose.isValidObjectId(parsed?.i)) {
    throw badRequest("INVALID_CURSOR", "Cursor không hợp lệ");
  }

  return { createdAt, id: new mongoose.Types.ObjectId(String(parsed.i)) };
};

/**
 * Điều kiện "cũ hơn cursor" — dùng khi lật ngược về quá khứ.
 * Loại trừ chính bản ghi tại cursor.
 */
export const olderThan = ({ createdAt, id }) => ({
  $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }],
});

/** Điều kiện "mới hơn cursor" — dùng cho backfill sau khi kết nối lại. */
export const newerThan = ({ createdAt, id }) => ({
  $or: [{ createdAt: { $gt: createdAt } }, { createdAt, _id: { $gt: id } }],
});
