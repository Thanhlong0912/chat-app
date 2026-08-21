import { z } from "zod";
import { messageContent, objectId } from "./common.js";

/** Chỉ cho phép http(s): `z.string().url()` chấp nhận cả `javascript:` và `data:`. */
const mediaUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "URL phải là http hoặc https");

/**
 * Tệp đính kèm, đầy đủ metadata.
 *
 * Thay cho `imgUrl` — một chuỗi URL trần làm mất `kind` (nên video bị lưu thành
 * ảnh) và mất `publicId` (nên `deleteMessage` không có gì để dọn trên Cloudinary,
 * và mọi tệp đính kèm nằm lại vĩnh viễn sau khi xoá tin nhắn).
 *
 * Các số đo đến từ phản hồi của Cloudinary chứ không phải người dùng gõ vào; vẫn
 * `.optional()` vì Cloudinary không trả đủ mọi field cho mọi loại tệp.
 */
const attachmentInput = z.object({
  url: mediaUrl,
  publicId: z.string().max(255).optional(),
  mimeType: z.string().max(100).optional(),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  originalName: z.string().max(255).optional(),
  kind: z.enum(["image", "video", "file"]).default("image"),
});

/** Trường dùng chung cho mọi đường gửi tin (HTTP và socket). */
const sendFields = {
  // Không bắt buộc: tin nhắn chỉ có ảnh thì không có nội dung. Kiểm tra
  // "phải có nội dung HOẶC tệp" nằm trong messageService.
  content: messageContent.optional(),
  clientMessageId: z.string().min(1).max(64).optional(),
  replyToMessageId: objectId.optional(),
  attachment: attachmentInput.optional(),
  /**
   * @deprecated dùng `attachment`.
   * Giữ lại cho bundle frontend đang mở tab — frontend ở Vercel và backend ở
   * Render không lên bản mới cùng lúc.
   */
  imgUrl: mediaUrl.optional(),
};

/**
 * Chuẩn hoá hai đường vào thành một mảng attachments.
 *
 * Một chỗ duy nhất, dùng chung cho cả HTTP lẫn socket, nên không thể lệch nhau.
 */
export const toAttachments = ({ attachment, imgUrl }) => {
  if (attachment) return [attachment];
  if (imgUrl) return [{ url: imgUrl, kind: "image" }];
  return undefined;
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
