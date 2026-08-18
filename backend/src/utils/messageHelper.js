import { serializeMessage } from "../serializers/message.js";

export const updateConversationAfterCreateMessage = (conversation, message, senderId) => {
  conversation.set({
    lastMessageAt: message.createdAt,
    lastMessage: {
      _id: message._id,
      content: message.content,
      senderId,
      createdAt: message.createdAt,
    },
  });

  /*
   * Tăng dần là đường nhanh cho badge, không phải nguồn sự thật.
   *
   * Nguồn sự thật là participants[].lastReadAt, và `advanceRead` tính lại con số
   * này bằng countDocuments mỗi lần user đọc. Ở đây cố tình chỉ $inc chứ không
   * đếm lại: đếm lại cho từng thành viên trên mỗi tin nhắn gửi đi là O(số thành
   * viên) query cho mỗi tin — quá đắt, trong khi sai lệch (nếu có) sẽ được sửa
   * ngay ở lần đọc kế tiếp.
   */
  conversation.participants.forEach((p) => {
    const memberId = p.userId.toString();
    const isSender = memberId === senderId.toString();
    const prevCount = conversation.unreadCounts.get(memberId) || 0;
    conversation.unreadCounts.set(memberId, isSender ? 0 : prevCount + 1);
  });
};

/** Mongoose Map → object thuần, vì JSON.stringify biến Map thành `{}`. */
const unreadCountsToObject = (unreadCounts) =>
  unreadCounts && typeof unreadCounts.entries === "function"
    ? Object.fromEntries(unreadCounts.entries())
    : (unreadCounts ?? {});

export const emitNewMessage = (io, conversation, message) => {
  // Không có io (ví dụ trong unit test) thì bỏ qua — tin nhắn đã được ghi thành
  // công rồi, không nên vì thế mà fail cả request.
  if (!io) return;

  const payload = {
    // Qua serializer: giữ một hình dạng duy nhất giữa HTTP và socket, và đảm bảo
    // tin nhắn đã xoá không bao giờ rò nội dung ra ngoài.
    message: serializeMessage(message),
    conversation: {
      _id: String(conversation._id),
      lastMessage: conversation.lastMessage
        ? {
            _id: conversation.lastMessage._id ? String(conversation.lastMessage._id) : null,
            content: conversation.lastMessage.content ?? null,
            senderId: conversation.lastMessage.senderId
              ? String(conversation.lastMessage.senderId)
              : null,
            createdAt: conversation.lastMessage.createdAt ?? null,
          }
        : null,
      lastMessageAt: conversation.lastMessageAt,
    },
    // Trước đây gửi thẳng Mongoose Map, và JSON hoá thành {} — nên client nhận
    // được một object rỗng và badge chưa đọc bị xoá sạch mỗi lần có tin mới.
    unreadCounts: unreadCountsToObject(conversation.unreadCounts),
  };

  const room = conversation._id.toString();

  io.to(room).emit("message:new", payload);
};
