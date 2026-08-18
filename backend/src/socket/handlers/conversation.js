import { CLIENT_EVENTS, LEGACY_EVENTS, conversationRoom } from "../events.js";
import { withMembership } from "../authorize.js";

/**
 * Đăng ký nhận realtime của một conversation.
 *
 * Trước đây event này (tên cũ `join-conversation`) không kiểm tra gì cả, nên bất
 * kỳ user đã đăng nhập nào cũng subscribe được vào luồng tin nhắn của một
 * conversation bất kỳ chỉ bằng cách biết id.
 */
export function registerConversationHandlers(socket) {
  const subscribe = withMembership(async (s, payload, { conversationId, ack }) => {
    await s.join(conversationRoom(conversationId));

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on(CLIENT_EVENTS.CONVERSATION_SUBSCRIBE, (payload, ack) =>
    subscribe(socket, payload, ack),
  );

  // Alias tương thích: bundle frontend đang mở tab vẫn phát tên event cũ. Nay đã
  // được kiểm tra quyền. Bỏ ở Phase 9.
  socket.on(LEGACY_EVENTS.JOIN_CONVERSATION, (payload, ack) =>
    subscribe(socket, payload, ack),
  );

  socket.on(CLIENT_EVENTS.CONVERSATION_UNSUBSCRIBE, (payload) => {
    const conversationId = typeof payload === "string" ? payload : payload?.conversationId;

    // Rời room không cần kiểm tra quyền — bỏ nhận tin thì luôn an toàn.
    if (conversationId) socket.leave(conversationRoom(conversationId));
  });
}
