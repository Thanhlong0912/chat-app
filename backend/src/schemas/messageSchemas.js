import { z } from "zod";
import { messageContent, objectId } from "./common.js";

/** Trường dùng chung cho mọi đường gửi tin (HTTP và socket). */
const sendFields = {
  // Không bắt buộc: tin nhắn chỉ có ảnh thì không có nội dung. Kiểm tra
  // "phải có nội dung HOẶC tệp" nằm trong messageService.
  content: messageContent.optional(),
  clientMessageId: z.string().min(1).max(64).optional(),
  replyToMessageId: objectId.optional(),
  imgUrl: z.string().url().optional(),
};

export const sendDirectMessageSchema = {
  body: z.object({
    recipientId: objectId,
    conversationId: objectId.optional(),
    ...sendFields,
  }),
};

export const sendGroupMessageSchema = {
  body: z.object({
    conversationId: objectId,
    ...sendFields,
  }),
};

export const messageIdParamSchema = {
  params: z.object({ messageId: objectId }),
};

export const editMessageSchema = {
  params: z.object({ messageId: objectId }),
  body: z.object({ content: messageContent }),
};

/** Payload của socket `message:edit` / `message:delete`. */
export const socketEditMessageSchema = z.object({
  messageId: objectId,
  content: messageContent,
});

export const socketDeleteMessageSchema = z.object({
  messageId: objectId,
});

/** Payload của socket `message:send`. Validate bằng zod như route HTTP. */
export const socketSendMessageSchema = z.object({
  conversationId: objectId,
  ...sendFields,
});

export const socketTypingSchema = z.object({
  conversationId: objectId,
});

export const socketReadAdvanceSchema = z.object({
  conversationId: objectId,
  lastReadMessageId: objectId.optional(),
});

export const socketSyncSinceSchema = z.object({
  cursors: z
    .array(
      z.object({
        conversationId: objectId,
        cursor: z.string().optional(),
      }),
    )
    .max(100),
});
