import { z } from "zod";
import { conversationIdParam, objectId } from "./common.js";

const MAX_GROUP_MEMBERS = 256;

export const createConversationSchema = {
  body: z
    .object({
      type: z.enum(["direct", "group"]),
      name: z.string().trim().min(1).max(100).optional(),
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
    cursor: z.string().optional(),
  }),
};

export const conversationIdParamSchema = {
  params: conversationIdParam,
};
