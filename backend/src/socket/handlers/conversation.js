import { CLIENT_EVENTS, conversationRoom } from "../events.js";
import { withMembership } from "../authorize.js";

/**
 * Đăng ký nhận realtime của một conversation.
 *
 * Trước đây event này (tên cũ `join-conversation`, nay đã bỏ) không kiểm tra gì
 * cả, nên bất kỳ user đã đăng nhập nào cũng subscribe được vào luồng tin nhắn của
 * một conversation bất kỳ chỉ bằng cách biết id.
 */
export function registerConversationHandlers(socket) {
  const subscribe = withMembership(async (s, payload, { conversationId, ack }) => {
    await s.join(conversationRoom(conversationId));

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on(CLIENT_EVENTS.CONVERSATION_SUBSCRIBE, (payload, ack) =>
    subscribe(socket, payload, ack),
  );

  socket.on(CLIENT_EVENTS.CONVERSATION_UNSUBSCRIBE, (payload) => {
    // Rời room không cần kiểm tra quyền — bỏ nhận tin thì luôn an toàn.
    if (payload?.conversationId) socket.leave(conversationRoom(payload.conversationId));
  });
}
