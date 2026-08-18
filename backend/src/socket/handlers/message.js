import { CLIENT_EVENTS } from "../events.js";
import { withErrorHandling, withMembership } from "../authorize.js";
import {
  createMessage,
  deleteMessage,
  editMessage,
} from "../../services/messageService.js";
import {
  socketDeleteMessageSchema,
  socketEditMessageSchema,
  socketSendMessageSchema,
} from "../../schemas/messageSchemas.js";
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

  /*
   * Sửa và xoá KHÔNG dùng `withMembership`.
   *
   * Wrapper đó lấy conversationId từ payload, nhưng ở đây client chỉ gửi messageId
   * — id conversation chưa biết cho tới khi nạp được tin nhắn. Service tự nạp rồi
   * mới kiểm tra quyền thành viên, nên đường này vẫn đóng kín.
   */
  const edit = withErrorHandling(async (s, payload, { ack }) => {
    const parsed = socketEditMessageSchema.safeParse(payload);

    if (!parsed.success) {
      throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
    }

    const message = await editMessage({
      messageId: parsed.data.messageId,
      actor: s.user,
      content: parsed.data.content,
    });

    if (typeof ack === "function") ack({ ok: true, message });
  });

  const remove = withErrorHandling(async (s, payload, { ack }) => {
    const parsed = socketDeleteMessageSchema.safeParse(payload);

    if (!parsed.success) {
      throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
    }

    await deleteMessage({ messageId: parsed.data.messageId, actor: s.user });

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on(CLIENT_EVENTS.MESSAGE_EDIT, (payload, ack) => edit(socket, payload, ack));
  socket.on(CLIENT_EVENTS.MESSAGE_DELETE, (payload, ack) => remove(socket, payload, ack));
}
