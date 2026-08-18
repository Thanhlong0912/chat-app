/**
 * Tên các socket event, khai báo một chỗ duy nhất.
 *
 * Phía frontend có bản song ánh ở `frontend/src/types/socket.ts` kèm kiểu của
 * payload, và một contract test đọc CHÍNH file này dưới dạng text rồi so khớp tập
 * tên. Cách đó tránh phải dựng một package dùng chung (cần build step ở cả hai
 * bên, và Render phải deploy kèm thư mục ngang cấp) mà vẫn khiến CI đỏ ngay khi
 * một bên đổi tên event.
 *
 * Quy ước: `miền:hành-động`. Các alias tên cũ (`new-message`, `online-users`, …)
 * đã được bỏ — xem ghi chú triển khai trong commit của Phase 9.
 */

/** Client → Server. */
export const CLIENT_EVENTS = Object.freeze({
  CONVERSATION_SUBSCRIBE: "conversation:subscribe",
  CONVERSATION_UNSUBSCRIBE: "conversation:unsubscribe",
  MESSAGE_SEND: "message:send",
  MESSAGE_EDIT: "message:edit",
  MESSAGE_DELETE: "message:delete",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  READ_ADVANCE: "read:advance",
  PRESENCE_AWAY: "presence:away",
  PRESENCE_HEARTBEAT: "presence:heartbeat",
  SYNC_SINCE: "sync:since",
  AUTH_TOKEN: "auth:token",
});

/** Server → Client. */
export const SERVER_EVENTS = Object.freeze({
  CONNECTION_READY: "connection:ready",
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  CONVERSATION_CREATED: "conversation:created",
  CONVERSATION_UPDATED: "conversation:updated",
  CONVERSATION_REMOVED: "conversation:removed",
  READ_UPDATED: "read:updated",
  TYPING_UPDATE: "typing:update",
  PRESENCE_SNAPSHOT: "presence:snapshot",
  PRESENCE_UPDATE: "presence:update",
  AUTH_REAUTH: "auth:reauth",
});

/** Room riêng của một user, để gửi event nhắm đúng một người. */
export const userRoom = (userId) => `u:${userId}`;

/** Room của một conversation. */
export const conversationRoom = (conversationId) => String(conversationId);
