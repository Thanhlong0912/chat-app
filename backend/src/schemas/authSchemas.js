import { z } from "zod";
import { password } from "./common.js";

export const signUpSchema = {
  body: z.object({
    username: z
      .string()
      .trim()
      .min(3, "Username phải có ít nhất 3 ký tự")
      .max(32, "Username quá dài")
      .regex(/^[a-zA-Z0-9._-]+$/, "Username chỉ gồm chữ, số và . _ -")
      // Model lowercase username, làm ở đây luôn để check trùng khớp nhau.
      .transform((value) => value.toLowerCase()),
    password,
    email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
    firstName: z.string().trim().min(1, "Thiếu firstName").max(50),
    lastName: z.string().trim().min(1, "Thiếu lastName").max(50),
  }),
};

export const signInSchema = {
  body: z.object({
    // Cố tình KHÔNG áp ràng buộc độ dài/định dạng ở đây: mật khẩu cũ có thể không
    // thoả policy mới, và trả lỗi validate khi đăng nhập vừa vô ích vừa tiết lộ
    // thông tin về policy.
    username: z.string().trim().min(1, "Thiếu username").transform((v) => v.toLowerCase()),
    password: z.string().min(1, "Thiếu password"),
  }),
};
