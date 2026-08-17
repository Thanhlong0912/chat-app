import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import {
  emitNewMessage,
  updateConversationAfterCreateMessage,
} from "../utils/messageHelper.js";
import { getIo } from "../socket/io.js";
import { serializeMessage } from "../serializers/message.js";
import { loadMembership } from "../services/membershipService.js";
import { isMember } from "../domain/groupPermissions.js";
import { badRequest } from "../utils/errors.js";

export const sendDirectMessage = async (req, res) => {
  const { recipientId, content, conversationId } = req.body;
  const senderId = req.user._id;

  let conversation;

  if (!content) {
    throw badRequest("EMPTY_CONTENT", "Thiếu nội dung");
  }

  if (conversationId) {
    // `conversationId` đến từ client nên phải kiểm tra quyền. Trước đây nó được
    // tin tưởng hoàn toàn — `checkFriendship` chỉ xác minh `recipientId` là bạn
    // bè — nên chỉ cần gửi kèm id của một conversation bất kỳ là chèn được tin
    // nhắn vào đó, kể cả group mà mình không tham gia.
    const { conversation: found } = await loadMembership(senderId, conversationId);

    if (found.type !== "direct") {
      throw badRequest("WRONG_CONVERSATION_TYPE", "Đây không phải cuộc trò chuyện 1-1");
    }

    // Người nhận phải đúng là phía còn lại của conversation này. Nếu không khớp
    // thì từ chối thay vì âm thầm rơi xuống nhánh tìm/tạo bên dưới — sai lệch ở
    // đây là bug của client, và che nó đi sẽ khiến tin nhắn đến sai người.
    if (!isMember(found, recipientId)) {
      throw badRequest(
        "RECIPIENT_MISMATCH",
        "recipientId không thuộc cuộc trò chuyện này",
      );
    }

    conversation = found;
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

  // Người gửi chính là req.user, nên gán trực tiếp thay vì populate thêm một
  // query. Nhờ vậy payload realtime có sẵn tên và avatar — trước đây client phải
  // tự bịa `displayName: ""` cho mỗi tin nhắn đến qua socket.
  message.senderId = req.user;

  emitNewMessage(getIo(), conversation, message);

  return res.status(201).json({ message: serializeMessage(message, { viewerId: senderId }) });
};

export const sendGroupMessage = async (req, res) => {
  const { conversationId, content } = req.body;
  const senderId = req.user._id;
  // Do requireMembership gắn vào, đã xác nhận người gửi là thành viên của group.
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

  // Người gửi chính là req.user, nên gán trực tiếp thay vì populate thêm một
  // query. Nhờ vậy payload realtime có sẵn tên và avatar — trước đây client phải
  // tự bịa `displayName: ""` cho mỗi tin nhắn đến qua socket.
  message.senderId = req.user;

  emitNewMessage(getIo(), conversation, message);

  return res.status(201).json({ message: serializeMessage(message, { viewerId: senderId }) });
};
