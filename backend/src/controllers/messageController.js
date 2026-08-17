import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import {
  emitNewMessage,
  updateConversationAfterCreateMessage,
} from "../utils/messageHelper.js";
import { getIo } from "../socket/io.js";
import { badRequest } from "../utils/errors.js";

export const sendDirectMessage = async (req, res) => {
  const { recipientId, content, conversationId } = req.body;
  const senderId = req.user._id;

  let conversation;

  if (!content) {
    throw badRequest("EMPTY_CONTENT", "Thiếu nội dung");
  }

  // FIXME(Phase 1): `conversationId` được tin tưởng hoàn toàn — `checkFriendship`
  // chỉ kiểm tra `recipientId` là bạn bè, nên có thể chèn tin nhắn vào một
  // conversation mà người gửi không tham gia.
  if (conversationId) {
    conversation = await Conversation.findById(conversationId);
  }

  // Không có conversationId thì phải tìm cuộc hội thoại sẵn có giữa hai
  // người, nếu không mỗi tin nhắn lại tạo thêm một cuộc hội thoại mới.
  if (!conversation) {
    conversation = await Conversation.findOne({
      type: "direct",
      participants: { $size: 2 },
      "participants.userId": { $all: [senderId, recipientId] },
    });
  }

  if (!conversation) {
    conversation = await Conversation.create({
      type: "direct",
      participants: [
        { userId: senderId, joinedAt: new Date() },
        { userId: recipientId, joinedAt: new Date() },
      ],
      lastMessageAt: new Date(),
      unreadCounts: new Map(),
    });
  }

  const message = await Message.create({
    conversationId: conversation._id,
    senderId,
    content,
  });

  updateConversationAfterCreateMessage(conversation, message, senderId);

  await conversation.save();

  emitNewMessage(getIo(), conversation, message);

  return res.status(201).json({ message });
};

export const sendGroupMessage = async (req, res) => {
  const { conversationId, content } = req.body;
  const senderId = req.user._id;
  // Do checkGroupMembership gắn vào, đã xác nhận người gửi là thành viên.
  const conversation = req.conversation;

  if (!content) {
    throw badRequest("EMPTY_CONTENT", "Thiếu nội dung");
  }

  const message = await Message.create({
    conversationId,
    senderId,
    content,
  });

  updateConversationAfterCreateMessage(conversation, message, senderId);

  await conversation.save();

  emitNewMessage(getIo(), conversation, message);

  return res.status(201).json({ message });
};
