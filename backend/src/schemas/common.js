import mongoose from "mongoose";
import { z } from "zod";

/** ObjectId dạng string, dùng ở mọi chỗ nhận id từ client. */
export const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), { message: "id không hợp lệ" });

export const conversationIdParam = z.object({
  conversationId: objectId,
});

/**
 * Mật khẩu.
 *
 * Chặn trên 72 *byte* vì bcrypt âm thầm cắt ở đó: nếu cho phép dài hơn, hai mật
 * khẩu khác nhau nhưng trùng 72 byte đầu sẽ cùng đăng nhập được. Đo theo byte chứ
 * không theo ký tự, vì tiếng Việt có dấu chiếm nhiều byte hơn một ký tự ASCII.
 */
export const password = z
  .string()
  .min(8, "Mật khẩu phải có ít nhất 8 ký tự")
  .refine((value) => new TextEncoder().encode(value).length <= 72, {
    message: "Mật khẩu quá dài (tối đa 72 byte)",
  });

export const messageContent = z
  .string()
  .trim()
  .min(1, "Thiếu nội dung")
  .max(4000, "Tin nhắn quá dài (tối đa 4000 ký tự)");
