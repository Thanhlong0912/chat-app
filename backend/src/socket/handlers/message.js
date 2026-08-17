import { CLIENT_EVENTS } from "../events.js";
import { withMembership } from "../authorize.js";
import { createMessage } from "../../services/messageService.js";
import { socketSendMessageSchema } from "../../schemas/messageSchemas.js";
import { badRequest } from "../../utils/errors.js";

/**
 * Gửi tin nhắn qua socket, có ack.
 *
 * Ack là thứ khiến gửi lạc quan hoạt động được: client vẽ tin nhắn ngay với
 * `clientMessageId`, rồi đối chiếu khi ack (hoặc bản broadcast) về. Nếu mất kết
 * nối giữa lúc gửi, client retry cùng `clientMessageId` và `createMessage` trả về
 * đúng tin nhắn đã tạo thay vì tạo bản thứ hai.
 */
export function registerMessageHandlers(socket) {
  const send = withMembership(
    async (s, payload, { conversation, conversationId, ack }) => {
      const parsed = socketSendMessageSchema.safeParse({ ...payload, conversationId });

      if (!parsed.success) {
        throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
      }

      const { serialized, duplicate } = await createMessage({
        conversation,
        sender: s.user,
        content: parsed.data.content,
        clientMessageId: parsed.data.clientMessageId,
        replyToMessageId: parsed.data.replyToMessageId,
        attachments: parsed.data.imgUrl
          ? [{ url: parsed.data.imgUrl, kind: "image" }]
          : undefined,
      });

      if (typeof ack === "function") {
        ack({ ok: true, message: serialized, duplicate });
      }
    },
    // Cần document Mongoose thật để cập nhật lastMessage và unreadCounts.
    { full: true },
  );

  socket.on(CLIENT_EVENTS.MESSAGE_SEND, (payload, ack) => send(socket, payload, ack));
}
