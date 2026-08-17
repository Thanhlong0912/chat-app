import { CLIENT_EVENTS, SERVER_EVENTS, conversationRoom } from "../events.js";
import { withMembership } from "../authorize.js";
import { advanceRead } from "../../services/readReceiptService.js";
import { socketReadAdvanceSchema } from "../../schemas/messageSchemas.js";
import { badRequest } from "../../utils/errors.js";

/**
 * Đẩy con trỏ đã đọc qua socket.
 *
 * Dùng lại `advanceRead` với route HTTP `PATCH /seen`, nên hai đường không thể
 * lệch nhau. Đường HTTP vẫn giữ làm dự phòng khi socket không kết nối được.
 */
export function registerReadHandlers(socket) {
  const advance = withMembership(
    async (s, payload, { conversation, conversationId, ack }) => {
      const parsed = socketReadAdvanceSchema.safeParse({ ...payload, conversationId });

      if (!parsed.success) {
        throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
      }

      const { lastReadAt, unreadCount, advanced } = await advanceRead({
        conversation,
        userId: s.user._id,
        lastReadMessageId: parsed.data.lastReadMessageId,
      });

      // Chỉ phát khi con trỏ thực sự tiến — nếu không, mỗi lần mở lại conversation
      // sẽ phát tán một event vô nghĩa cho toàn bộ room.
      if (advanced) {
        s.to(conversationRoom(conversationId)).emit(SERVER_EVENTS.READ_UPDATED, {
          conversationId: String(conversationId),
          userId: String(s.user._id),
          lastReadAt,
        });
      }

      if (typeof ack === "function") {
        ack({ ok: true, lastReadAt, unreadCount });
      }
    },
    { full: true },
  );

  socket.on(CLIENT_EVENTS.READ_ADVANCE, (payload, ack) => advance(socket, payload, ack));
}
