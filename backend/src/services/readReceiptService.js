import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { findParticipant } from "../domain/groupPermissions.js";
import { badRequest } from "../utils/errors.js";

/**
 * Read receipt dựa trên con trỏ `lastReadAt` của từng participant.
 *
 * Vì sao không dùng mảng `readBy[]` trên từng message:
 *  - Khuếch đại ghi: mỗi lần đọc phải `updateMany($addToSet)` lên toàn bộ tin nhắn
 *    chưa đọc. Mở một nhóm 50 người với 200 tin tồn đọng là 200 lượt ghi document,
 *    mỗi lượt làm mảng phình thêm. Với `lastReadAt` chỉ là một lượt ghi duy nhất,
 *    bất kể tồn đọng bao nhiêu.
 *  - Dung lượng: O(số tin × số thành viên) so với O(số thành viên) mỗi conversation.
 *  - Idempotent: "đã đọc tới X" là đơn điệu, nên phát lại vô hại và một cơn bão
 *    reconnect không thể làm sai dữ liệu.
 *  - UI không mất gì: người đã đọc tin `m` là
 *    `participants.filter(p => p.lastReadAt >= m.createdAt)`, đủ để vẽ dấu tick
 *    từng tin và "đã xem bởi N người".
 *
 * Đánh đổi duy nhất là không biểu diễn được việc đọc lệch thứ tự (đánh dấu đã đọc
 * một tin cũ mà bỏ qua các tin mới hơn) — không sản phẩm chat nào cần điều đó.
 */

/**
 * Đẩy con trỏ đã đọc của một user lên tới một tin nhắn.
 *
 * @param {object} args
 * @param {object} args.conversation  document đã xác thực quyền
 * @param {string} args.userId
 * @param {string} [args.lastReadMessageId] tin nhắn đọc tới; mặc định là tin cuối
 * @returns {Promise<{lastReadAt: Date|null, unreadCount: number, advanced: boolean}>}
 */
export async function advanceRead({ conversation, userId, lastReadMessageId }) {
  const participant = findParticipant(conversation, userId);

  if (!participant) {
    throw badRequest("NOT_A_MEMBER", "Bạn không ở trong cuộc trò chuyện này");
  }

  const target = await resolveTarget(conversation, lastReadMessageId);

  if (!target) {
    // Chưa có tin nhắn nào — không có gì để đánh dấu.
    return { lastReadAt: participant.lastReadAt ?? null, unreadCount: 0, advanced: false };
  }

  /*
   * Mốc thời gian LẤY TỪ DB, không bao giờ từ client.
   *
   * Nếu tin vào timestamp client gửi lên thì một đồng hồ lệch (hoặc một client
   * cố ý) có thể đánh dấu đã đọc cả những tin nhắn trong tương lai.
   */
  const lastReadAt = target.createdAt;

  /*
   * Chỉ tiến, không lùi.
   *
   * Điều kiện `$elemMatch` khiến update chỉ khớp khi giá trị đang lưu cũ hơn —
   * một gói tin đến muộn từ tab cũ không thể kéo con trỏ về quá khứ. Atomic, nên
   * không cần đọc-rồi-ghi.
   */
  const result = await Conversation.updateOne(
    {
      _id: conversation._id,
      participants: {
        $elemMatch: {
          userId: new mongoose.Types.ObjectId(String(userId)),
          $or: [{ lastReadAt: null }, { lastReadAt: { $lt: lastReadAt } }],
        },
      },
    },
    {
      $set: {
        "participants.$[p].lastReadAt": lastReadAt,
        "participants.$[p].lastReadMessageId": target._id,
      },
    },
    { arrayFilters: [{ "p.userId": new mongoose.Types.ObjectId(String(userId)) }] },
  );

  const advanced = result.modifiedCount > 0;

  // Tính LẠI từ lastReadAt thay vì $inc/$set độc lập. Cách cũ khiến hai nguồn
  // trôi khỏi nhau và badge hiển thị sai.
  const unreadCount = await countUnread(conversation._id, userId, lastReadAt);

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { [`unreadCounts.${userId}`]: unreadCount } },
  );

  return { lastReadAt, unreadCount, advanced };
}

const resolveTarget = async (conversation, lastReadMessageId) => {
  if (lastReadMessageId) {
    if (!mongoose.isValidObjectId(lastReadMessageId)) {
      throw badRequest("INVALID_ID", "lastReadMessageId không hợp lệ");
    }

    // Phải thuộc đúng conversation này — nếu không, client có thể dùng id của một
    // conversation khác để suy ra thời điểm tin nhắn ở đó.
    const message = await Message.findOne({
      _id: lastReadMessageId,
      conversationId: conversation._id,
    })
      .select("_id createdAt")
      .lean();

    if (!message) {
      throw badRequest("MESSAGE_NOT_IN_CONVERSATION", "Tin nhắn không thuộc cuộc trò chuyện này");
    }

    return message;
  }

  // Mặc định: tin nhắn mới nhất.
  return Message.findOne({ conversationId: conversation._id })
    .sort({ createdAt: -1, _id: -1 })
    .select("_id createdAt")
    .lean();
};

/** Số tin chưa đọc: mới hơn con trỏ, không phải của mình, chưa bị xoá. */
export const countUnread = (conversationId, userId, lastReadAt) =>
  Message.countDocuments({
    conversationId,
    senderId: { $ne: new mongoose.Types.ObjectId(String(userId)) },
    deletedAt: null,
    ...(lastReadAt ? { createdAt: { $gt: lastReadAt } } : {}),
  });

/**
 * Ai đã đọc một tin nhắn, suy ra từ con trỏ của từng participant.
 * Đây là chỗ read receipt "theo từng tin nhắn" được dựng lại mà không cần lưu
 * gì thêm trên message.
 */
export function readersOf(conversation, message) {
  const senderId = String(message.senderId?._id ?? message.senderId);

  return (conversation.participants ?? [])
    .filter((p) => {
      const id = String(p.userId?._id ?? p.userId);
      if (id === senderId) return false;
      if (!p.lastReadAt) return false;
      return new Date(p.lastReadAt) >= new Date(message.createdAt);
    })
    .map((p) => String(p.userId?._id ?? p.userId));
}
