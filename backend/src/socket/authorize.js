import { loadMembership, loadMembershipCached } from "../services/membershipService.js";
import { isAppError } from "../utils/errors.js";
import logger from "../utils/logger.js";

/**
 * Xác nhận socket này thuộc về một thành viên của conversation.
 *
 * @returns {Promise<{role: string}>}
 * @throws {AppError}
 */
export async function assertMembership(socket, conversationId) {
  return loadMembershipCached(socket.user._id, conversationId);
}

/**
 * Bọc một socket handler bằng kiểm tra membership.
 *
 * Socket event không có response status như HTTP, nên lỗi được trả qua ack
 * callback dạng `{ok: false, code}`. Nếu client không truyền ack thì lỗi chỉ được
 * log — nhưng handler vẫn *không* chạy, nên đây vẫn là một cửa đóng.
 *
 * Handler nhận `(socket, payload, ctx)` với `ctx.role`, `ctx.conversationId`,
 * `ctx.ack`, và `ctx.conversation` khi truyền `{ full: true }`.
 *
 * @param {object}  options
 * @param {boolean} options.full
 *   `false` (mặc định) chỉ cần biết vai trò, dùng cache 30s — phù hợp với các
 *   event tần suất cao như typing. `true` load hẳn document, cho những handler
 *   thực sự cần ghi vào conversation (ví dụ gửi tin nhắn); khi đó không dùng cache
 *   vì ta cần một document Mongoose còn "sống" để save.
 */
export function withMembership(handler, { key = "conversationId", full = false } = {}) {
  return async (socket, payload, ack) => {
    // Cho phép client gửi trực tiếp một string id thay vì object, để tương thích
    // với event `join-conversation` cũ.
    const conversationId = typeof payload === "string" ? payload : payload?.[key];

    try {
      if (!conversationId) {
        return respond(ack, { ok: false, code: "MISSING_CONVERSATION_ID" });
      }

      const context = full
        ? await loadMembership(socket.user._id, conversationId)
        : await assertMembership(socket, conversationId);

      return await handler(socket, payload, {
        role: context.role,
        conversation: context.conversation,
        conversationId,
        ack,
      });
    } catch (error) {
      const code = isAppError(error) ? error.code : "INTERNAL_ERROR";

      if (!isAppError(error)) {
        logger.error(`Lỗi socket handler cho ${socket.user?._id}`, error);
      } else {
        logger.warn(
          `Socket ${socket.id} bị từ chối ${conversationId}: ${code}`,
        );
      }

      return respond(ack, { ok: false, code });
    }
  };
}

const respond = (ack, payload) => {
  if (typeof ack === "function") ack(payload);
  return payload;
};

/**
 * Bọc handler không cần membership, chỉ để lỗi không làm sập cả socket.
 */
export function withErrorHandling(handler) {
  return async (socket, payload, ack) => {
    try {
      return await handler(socket, payload, { ack });
    } catch (error) {
      const code = isAppError(error) ? error.code : "INTERNAL_ERROR";
      if (!isAppError(error)) {
        logger.error(`Lỗi socket handler cho ${socket.user?._id}`, error);
      }
      return respond(ack, { ok: false, code });
    }
  };
}
