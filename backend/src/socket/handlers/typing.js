import { CLIENT_EVENTS, SERVER_EVENTS, conversationRoom } from "../events.js";
import { withMembership } from "../authorize.js";

/**
 * Chỉ báo "đang nhập".
 *
 * Không bao giờ được lưu xuống DB — đây là trạng thái tức thời, và ghi nó sẽ là
 * một lượt write cho mỗi cụm gõ phím của mỗi người.
 */

/** Bỏ qua các lần phát lại trong khoảng này, để không spam cả room mỗi ký tự. */
const THROTTLE_MS = 2000;

/**
 * Tự hết hạn phía server.
 *
 * Nếu chỉ dựa vào client gửi `typing:stop` thì một tab bị đóng đột ngột (đóng
 * laptop, mất mạng) sẽ để lại chỉ báo "đang nhập…" treo vĩnh viễn cho người khác.
 */
const EXPIRY_MS = 6000;

export function registerTypingHandlers(socket) {
  // key `${conversationId}` -> { lastSentAt, timer }
  const state = new Map();

  const emitTyping = (conversationId, isTyping) => {
    // `socket.to` chứ không phải `io.to`: không dội lại cho chính người đang gõ.
    socket.to(conversationRoom(conversationId)).emit(SERVER_EVENTS.TYPING_UPDATE, {
      conversationId: String(conversationId),
      userId: String(socket.user._id),
      displayName: socket.user.displayName,
      isTyping,
    });
  };

  const clearTimer = (conversationId) => {
    const entry = state.get(conversationId);
    if (entry?.timer) clearTimeout(entry.timer);
  };

  const start = withMembership(async (s, payload, { conversationId }) => {
    const entry = state.get(conversationId) ?? { lastSentAt: 0, timer: null };
    const now = Date.now();

    clearTimer(conversationId);

    // Luôn gia hạn timer hết hạn, nhưng chỉ phát event khi đã qua throttle.
    entry.timer = setTimeout(() => {
      state.delete(conversationId);
      emitTyping(conversationId, false);
    }, EXPIRY_MS);

    if (now - entry.lastSentAt >= THROTTLE_MS) {
      entry.lastSentAt = now;
      emitTyping(conversationId, true);
    }

    state.set(conversationId, entry);
  });

  const stop = withMembership(async (s, payload, { conversationId }) => {
    clearTimer(conversationId);
    state.delete(conversationId);
    emitTyping(conversationId, false);
  });

  socket.on(CLIENT_EVENTS.TYPING_START, (payload, ack) => start(socket, payload, ack));
  socket.on(CLIENT_EVENTS.TYPING_STOP, (payload, ack) => stop(socket, payload, ack));

  // Ngắt kết nối phải dọn cả timer và chỉ báo, nếu không người khác sẽ thấy
  // "đang nhập…" của một người đã rời đi.
  socket.on("disconnect", () => {
    for (const [conversationId, entry] of state) {
      if (entry.timer) clearTimeout(entry.timer);
      emitTyping(conversationId, false);
    }
    state.clear();
  });
}
