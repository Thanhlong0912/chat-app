import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { serializeMessage } from "../serializers/message.js";
import {
  emitNewMessage,
  updateConversationAfterCreateMessage,
} from "../utils/messageHelper.js";
import { getIo } from "../socket/io.js";
import { badRequest } from "../utils/errors.js";

/**
 * Nơi DUY NHẤT một tin nhắn được ghi.
 *
 * Cả controller HTTP và socket handler đều là adapter mỏng gọi vào đây, nên logic
 * cập nhật conversation, phát realtime và chống trùng chỉ tồn tại một bản.
 */

const REPLY_SNAPSHOT_LENGTH = 140;

/**
 * @param {object} args
 * @param {object} args.conversation  document đã xác thực quyền
 * @param {object} args.sender        req.user / socket.user
 * @param {string} [args.content]
 * @param {string} [args.clientMessageId]
 * @param {string} [args.replyToMessageId]
 * @param {Array}  [args.attachments]
 * @param {string} [args.kind]
 * @returns {Promise<{message: object, serialized: object, duplicate: boolean}>}
 */
export async function createMessage({
  conversation,
  sender,
  content,
  clientMessageId,
  replyToMessageId,
  attachments,
  kind,
}) {
  if (!content?.trim() && !attachments?.length) {
    throw badRequest("EMPTY_MESSAGE", "Tin nhắn phải có nội dung hoặc tệp đính kèm");
  }

  const replyTo = await buildReplySnapshot(conversation, replyToMessageId);

  const payload = {
    conversationId: conversation._id,
    senderId: sender._id,
    kind: kind ?? (attachments?.length ? "image" : "text"),
    content: content?.trim() || null,
    ...(attachments?.length ? { attachments } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
  };

  let message;
  let duplicate = false;

  try {
    message = await Message.create(payload);
  } catch (error) {
    /*
     * Trùng `clientMessageId` không phải lỗi — đó là client gửi lại.
     *
     * Đây là thứ khiến gửi lạc quan an toàn khi mất kết nối: client retry cùng một
     * clientMessageId, và server trả về đúng tin nhắn đã tạo thay vì tạo bản thứ
     * hai hoặc báo lỗi. Chỉ có thể làm được nhờ partial unique index
     * {conversationId, clientMessageId}.
     */
    const isDuplicate = error?.code === 11000 && clientMessageId;

    if (!isDuplicate) throw error;

    message = await Message.findOne({
      conversationId: conversation._id,
      clientMessageId,
    });

    // Cực hiếm: index báo trùng nhưng không tìm lại được (ví dụ vừa bị xoá).
    if (!message) throw error;

    duplicate = true;
  }

  // Người gửi đã có trong bộ nhớ, gán trực tiếp để payload realtime có tên và
  // avatar mà không cần thêm một query populate.
  message.senderId = sender;

  const serialized = serializeMessage(message, { viewerId: sender._id });

  // Bản trùng thì conversation đã được cập nhật ở lần gửi đầu — cập nhật lại sẽ
  // tăng số chưa đọc lên lần thứ hai cho một tin nhắn duy nhất.
  if (!duplicate) {
    updateConversationAfterCreateMessage(conversation, message, sender._id);
    await conversation.save();

    emitNewMessage(getIo(), conversation, message);
  }

  return { message, serialized, duplicate };
}

/**
 * Ảnh chụp của tin nhắn được trả lời.
 *
 * Phải kiểm tra tin nhắn gốc thuộc CÙNG conversation — nếu không, một reply có thể
 * dùng để rút 140 ký tự nội dung từ một conversation khác.
 */
async function buildReplySnapshot(conversation, replyToMessageId) {
  if (!replyToMessageId) return null;

  if (!mongoose.isValidObjectId(replyToMessageId)) {
    throw badRequest("INVALID_ID", "replyToMessageId không hợp lệ");
  }

  const parent = await Message.findOne({
    _id: replyToMessageId,
    conversationId: conversation._id,
  })
    .select("_id senderId content kind deletedAt")
    .lean();

  if (!parent) {
    throw badRequest(
      "REPLY_TARGET_NOT_IN_CONVERSATION",
      "Không thể trả lời một tin nhắn ngoài cuộc trò chuyện này",
    );
  }

  return {
    messageId: parent._id,
    senderId: parent.senderId,
    // Tin nhắn gốc đã xoá thì không trích nội dung.
    contentSnapshot: parent.deletedAt
      ? null
      : (parent.content ?? "").slice(0, REPLY_SNAPSHOT_LENGTH) || null,
    kindSnapshot: parent.kind ?? "text",
  };
}

/**
 * Tìm hoặc tạo conversation 1-1 giữa hai người.
 * `$size: 2` là bắt buộc, nếu không sẽ khớp cả group có đúng hai người này.
 */
export async function findOrCreateDirectConversation(senderId, recipientId) {
  const existing = await Conversation.findOne({
    type: "direct",
    participants: { $size: 2 },
    "participants.userId": { $all: [senderId, recipientId] },
  });

  if (existing) return existing;

  return Conversation.create({
    type: "direct",
    participants: [
      { userId: senderId, joinedAt: new Date() },
      { userId: recipientId, joinedAt: new Date() },
    ],
    lastMessageAt: new Date(),
    unreadCounts: new Map(),
  });
}
