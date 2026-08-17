import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { getIo } from "../socket/io.js";
import { ROLES } from "../domain/groupPermissions.js";
import { badRequest } from "../utils/errors.js";

export const createConversation = async (req, res) => {
  const { type, name, memberIds } = req.body;
  const userId = req.user._id;

  if (
    !type ||
    (type === "group" && !name) ||
    !memberIds ||
    !Array.isArray(memberIds) ||
    memberIds.length === 0
  ) {
    throw badRequest("INVALID_CONVERSATION", "Tên nhóm và danh sách thành viên là bắt buộc");
  }

  let conversation;

  if (type === "direct") {
    const participantId = memberIds[0];

    // FIXME(Phase 2): thiếu `participants: { $size: 2 }`, nên query này có thể
    // khớp một group có cả hai người. `messageController` đã làm đúng.
    conversation = await Conversation.findOne({
      type: "direct",
      "participants.userId": { $all: [userId, participantId] },
    });

    if (!conversation) {
      conversation = new Conversation({
        type: "direct",
        participants: [{ userId }, { userId: participantId }],
        lastMessageAt: new Date(),
      });

      await conversation.save();
    }
  }

  if (type === "group") {
    // FIXME(Phase 6): chưa validate memberIds là ObjectId hợp lệ, chưa dedupe,
    // chưa loại chính mình, chưa giới hạn số thành viên.
    conversation = new Conversation({
      type: "group",
      participants: [
        { userId, role: ROLES.OWNER },
        ...memberIds.map((id) => ({ userId: id, role: ROLES.MEMBER })),
      ],
      group: { name, createdBy: userId },
      lastMessageAt: new Date(),
    });

    await conversation.save();
  }

  if (!conversation) {
    throw badRequest("INVALID_CONVERSATION_TYPE", "Conversation type không hợp lệ");
  }

  await conversation.populate([
    { path: "participants.userId", select: "displayName avatarUrl" },
    { path: "seenBy", select: "displayName avatarUrl" },
    { path: "lastMessage.senderId", select: "displayName avatarUrl" },
  ]);

  const participants = (conversation.participants || []).map((p) => ({
    _id: p.userId?._id,
    displayName: p.userId?.displayName,
    avatarUrl: p.userId?.avatarUrl ?? null,
    joinedAt: p.joinedAt,
  }));

  // FIXME(Phase 2): spread của toObject() để lại `unreadCounts` là Map thuần,
  // và JSON.stringify biến Map thành {} — nên field này bị mất trong response.
  const formatted = { ...conversation.toObject(), participants };

  const io = getIo();

  if (type === "group") {
    memberIds.forEach((memberId) => {
      io?.to(memberId).emit("new-group", formatted);
    });
  }

  if (type === "direct") {
    // FIXME(Phase 6): `userId` là ObjectId còn room được tạo từ `_id.toString()`,
    // nên người tạo không bao giờ nhận được event này.
    io?.to(userId).emit("new-group", formatted);
    io?.to(memberIds[0]).emit("new-group", formatted);
  }

  return res.status(201).json({ conversation: formatted });
};

export const getConversations = async (req, res) => {
  const userId = req.user._id;

  const conversations = await Conversation.find({ "participants.userId": userId })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .populate({ path: "participants.userId", select: "displayName avatarUrl" })
    .populate({ path: "lastMessage.senderId", select: "displayName avatarUrl" })
    .populate({ path: "seenBy", select: "displayName avatarUrl" });

  const formatted = conversations.map((convo) => {
    const participants = (convo.participants || []).map((p) => ({
      _id: p.userId?._id,
      displayName: p.userId?.displayName,
      avatarUrl: p.userId?.avatarUrl ?? null,
      joinedAt: p.joinedAt,
    }));

    return {
      ...convo.toObject(),
      // Gán lại để Map không bị serialize thành {} như trong createConversation.
      unreadCounts: convo.unreadCounts || {},
      participants,
    };
  });

  return res.status(200).json({ conversations: formatted });
};

export const getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const { limit = 50, cursor } = req.query;

  const query = { conversationId };

  // FIXME(Phase 2): cursor chỉ dựa trên timestamp, nên các tin nhắn trùng
  // millisecond có thể bị bỏ qua hoặc trả về hai lần. `limit` cũng chưa chặn trên.
  if (cursor) {
    query.createdAt = { $lt: new Date(cursor) };
  }

  let messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(limit) + 1);

  let nextCursor = null;

  if (messages.length > Number(limit)) {
    const nextMessage = messages[messages.length - 1];
    nextCursor = nextMessage.createdAt.toISOString();
    messages.pop();
  }

  messages = messages.reverse();

  return res.status(200).json({ messages, nextCursor });
};

export const markAsSeen = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id.toString();

  // requireMembership đã load và xác minh quyền, nên không cần query lại.
  const conversation = req.conversation;

  const last = conversation.lastMessage;

  if (!last) {
    return res.status(200).json({ message: "Không có tin nhắn để mark as seen" });
  }

  if (last.senderId.toString() === userId) {
    return res.status(200).json({ message: "Sender không cần mark as seen" });
  }

  const updated = await Conversation.findByIdAndUpdate(
    conversationId,
    {
      $addToSet: { seenBy: userId },
      $set: { [`unreadCounts.${userId}`]: 0 },
    },
    { returnDocument: "after" },
  );

  getIo()?.to(conversationId).emit("read-message", {
    conversation: updated,
    lastMessage: {
      _id: updated?.lastMessage._id,
      content: updated?.lastMessage.content,
      createdAt: updated?.lastMessage.createdAt,
      sender: { _id: updated?.lastMessage.senderId },
    },
  });

  return res.status(200).json({
    message: "Marked as seen",
    seenBy: updated?.seenBy ?? [],
    // `unreadCounts` là Mongoose Map — phải dùng .get(), truy cập bằng [] trả undefined.
    myUnreadCount: updated?.unreadCounts?.get(userId) ?? 0,
  });
};
