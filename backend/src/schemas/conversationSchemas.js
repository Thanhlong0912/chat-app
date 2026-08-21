import { z } from "zod";
import { conversationIdParam, objectId } from "./common.js";

const MAX_GROUP_MEMBERS = 256;

export const createConversationSchema = {
  body: z
    .object({
      type: z.enum(["direct", "group"]),
      /*
       * Cố tình KHÔNG có `.min(1)`.
       *
       * `.optional()` chỉ cho phép `undefined`, không cho phép chuỗi rỗng — mà
       * form tạo chat 1-1 không có ô tên nhóm nào để điền nên nó gửi `name: ""`.
       * Với `.min(1)` thì MỌI lần bấm vào một người bạn trong "gửi tin nhắn mới"
       * đều trả 400, store nuốt lỗi thành `null`, và giao diện đứng im như thể cú
       * bấm không được ghi nhận.
       *
       * Ràng buộc "nhóm phải có tên" không mất đi: `.trim()` biến chuỗi toàn
       * khoảng trắng thành `""`, và refine bên dưới bắt đúng trường hợp đó.
       */
      name: z.string().trim().max(100).optional(),
      // Loại trùng lặp ngay ở tầng validate: participants trùng nhau sẽ làm
      // unreadCounts và số thành viên sai lệch.
      memberIds: z
        .array(objectId)
        .min(1, "Cần ít nhất một thành viên")
        .max(MAX_GROUP_MEMBERS, `Tối đa ${MAX_GROUP_MEMBERS} thành viên`)
        .transform((ids) => [...new Set(ids)]),
    })
    .refine((data) => data.type !== "group" || Boolean(data.name), {
      message: "Nhóm phải có tên",
      path: ["name"],
    })
    .refine((data) => data.type !== "direct" || data.memberIds.length === 1, {
      message: "Cuộc trò chuyện 1-1 chỉ có đúng một người nhận",
      path: ["memberIds"],
    }),
};

export const getMessagesSchema = {
  params: conversationIdParam,
  query: z.object({
    // Chặn trên: trước đây `?limit=999999` được nhận thẳng, và `Number(rác)` ra
    // NaN khiến `.limit(NaN)` trả về toàn bộ collection.
    limit: z.coerce.number().int().min(1).max(100).default(50),
    // Cursor là opaque; tính hợp lệ được kiểm tra khi decode để mã lỗi nói rõ
    // "cursor sai" thay vì một lỗi validate chung.
    cursor: z.string().optional(),
  }),
};

export const getMessagesSinceSchema = {
  params: conversationIdParam,
  query: z.object({
    after: z.string().optional(),
  }),
};

export const conversationIdParamSchema = {
  params: conversationIdParam,
};

export const markAsSeenSchema = {
  params: conversationIdParam,
  // Body là tuỳ chọn: không truyền thì đánh dấu tới tin nhắn cuối.
  body: z.object({ lastReadMessageId: objectId.optional() }).optional().default({}),
};
