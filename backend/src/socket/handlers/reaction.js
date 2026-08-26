import { CLIENT_EVENTS } from "../events.js";
import { withErrorHandling } from "../authorize.js";
import { toggleReaction } from "../../services/messageService.js";
import { socketToggleReactionSchema } from "../../schemas/messageSchemas.js";
import { badRequest } from "../../utils/errors.js";

/**
 * Thả / gỡ biểu cảm qua socket.
 *
 * Cùng lý do với `message:edit` và `message:delete`, handler này KHÔNG dùng
 * `withMembership`: payload chỉ có `messageId`, nên id conversation chưa biết cho
 * tới khi nạp được tin nhắn. `toggleReaction` tự nạp tin nhắn rồi mới kiểm tra
 * quyền thành viên của conversation chứa nó — nếu không, chỉ cần đoán được id một
 * tin nhắn là thả được biểu cảm vào cuộc trò chuyện của người lạ.
 */
export function registerReactionHandlers(socket) {
  const toggle = withErrorHandling(async (s, payload, { ack }) => {
    const parsed = socketToggleReactionSchema.safeParse(payload);

    if (!parsed.success) {
      throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
    }

    const result = await toggleReaction({
      messageId: parsed.data.messageId,
      actor: s.user,
      emoji: parsed.data.emoji,
    });

    if (typeof ack === "function") ack({ ok: true, ...result });
  });

  socket.on(CLIENT_EVENTS.REACTION_TOGGLE, (payload, ack) => toggle(socket, payload, ack));
}
