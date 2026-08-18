import { z } from "zod";

export const updateMeSchema = {
  body: z
    .object({
      displayName: z.string().trim().min(1, "Tên hiển thị không được để trống").max(50),
      // `nullable` để client xoá được bio / số điện thoại.
      bio: z.string().trim().max(500).nullable(),
      phone: z
        .string()
        .trim()
        .regex(/^[0-9+\-\s()]{6,20}$/, "Số điện thoại không hợp lệ")
        .nullable(),
      preferences: z.object({
        inAppNotifications: z.boolean(),
        browserNotifications: z.boolean(),
        showPresence: z.boolean(),
        enterToSend: z.boolean(),
      }).partial(),
    })
    // Tất cả đều tuỳ chọn: form gửi lên phần nào thì cập nhật phần đó.
    .partial(),
};
