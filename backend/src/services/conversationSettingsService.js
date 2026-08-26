import Conversation from "../models/Conversation.js";
import { serializeConversation } from "../serializers/conversation.js";
import { getIo } from "../socket/io.js";
import { SERVER_EVENTS, userRoom } from "../socket/events.js";

/**
 * Ghim, lưu trữ và tắt thông báo — ba tuỳ chọn RIÊNG CỦA TỪNG NGƯỜI.
 *
 * Ba field này đã có sẵn trong `Conversation` từ trước (`pinnedBy`, `archivedBy`,
 * `participants[].mutedUntil`) nhưng chưa từng có đường nào ghi vào chúng, nên
 * `pinned` mà serializer trả ra vĩnh viễn là `false`. Đây là phần còn thiếu.
 *
 * Cả ba đều là trạng thái theo người, KHÔNG phải theo cuộc trò chuyện: một người
 * lưu trữ nhóm không được làm nhóm đó biến mất khỏi hộp thư của người khác. Vì thế
 * kết quả chỉ phát về các thiết bị của CHÍNH người gọi (`u:<id>`), không phát ra
 * room của conversation.
 */

/** Trần thời gian tắt thông báo: 1 năm. Lâu hơn thì coi như tắt hẳn. */
const MAX_MUTE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * @param {object} args
 * @param {object} args.conversation  document đã qua requireMembership
 * @param {string} args.userId
 * @param {boolean} [args.pinned]
 * @param {boolean} [args.archived]
 * @param {number|null} [args.muteMinutes]  `null` để bật lại thông báo
 * @returns {Promise<object>} conversation đã serialize cho chính người gọi
 */
export async function updateConversationSettings({
  conversation,
  userId,
  pinned,
  archived,
  muteMinutes,
}) {
  const update = {};

  /*
   * `$addToSet` / `$pull` chứ không phải đọc mảng rồi ghi đè.
   *
   * Cùng lý do như `toggleReaction`: người dùng thường mở nhiều tab, và hai thao
   * tác gần nhau trên hai thiết bị sẽ khiến bản ghi sau xoá mất thay đổi của bản
   * trước. `$addToSet` cũng tự chống trùng, nên ghim hai lần không tạo hai entry.
   */
  if (pinned !== undefined) {
    if (pinned) {
      update.$addToSet = { ...update.$addToSet, pinnedBy: userId };
    } else {
      update.$pull = { ...update.$pull, pinnedBy: userId };
    }
  }

  if (archived !== undefined) {
    if (archived) {
      update.$addToSet = { ...update.$addToSet, archivedBy: userId };
    } else {
      update.$pull = { ...update.$pull, archivedBy: userId };
    }
  }

  if (muteMinutes !== undefined) {
    const until =
      muteMinutes === null
        ? null
        : new Date(Date.now() + Math.min(muteMinutes * 60_000, MAX_MUTE_MS));

    // Positional `$` nhắm đúng participant của người gọi. Filter đã được ép ở
    // updateOne bên dưới, nên `$` luôn khớp một phần tử tồn tại.
    update.$set = { ...update.$set, "participants.$[me].mutedUntil": until };
  }

  if (Object.keys(update).length > 0) {
    await Conversation.updateOne({ _id: conversation._id }, update, {
      // arrayFilters chỉ cần khi có đụng tới `mutedUntil`, nhưng truyền thừa là
      // vô hại và giữ nhánh này chỉ có một lời gọi.
      arrayFilters: muteMinutes !== undefined ? [{ "me.userId": userId }] : undefined,
    });
  }

  const fresh = await Conversation.findById(conversation._id)
    .populate({ path: "participants.userId", select: "displayName avatarUrl" })
    .populate({ path: "lastMessage.senderId", select: "displayName avatarUrl" });

  const serialized = serializeConversation(fresh, { viewerId: userId });

  // Chỉ các thiết bị của chính người này. Ghim trên máy tính thì điện thoại cũng
  // phải thấy ghim — nhưng người khác trong nhóm thì không được thấy gì cả.
  getIo()
    ?.to(userRoom(String(userId)))
    .emit(SERVER_EVENTS.CONVERSATION_UPDATED, { conversation: serialized });

  return serialized;
}
