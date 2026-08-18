import { z } from "zod";
import { conversationIdParam, objectId } from "./common.js";
import { ROLES } from "../domain/groupPermissions.js";
import { MAX_GROUP_MEMBERS } from "../services/groupService.js";

export const updateGroupInfoSchema = {
  params: conversationIdParam,
  body: z.object({
    name: z.string().trim().min(1, "Tên nhóm không được để trống").max(100).optional(),
    // `nullable` để client xoá được phần mô tả.
    description: z.string().trim().max(500).nullable().optional(),
  }),
};

export const addMembersSchema = {
  params: conversationIdParam,
  body: z.object({
    memberIds: z
      .array(objectId)
      .min(1, "Cần ít nhất một thành viên")
      .max(MAX_GROUP_MEMBERS)
      // Loại trùng ngay ở tầng validate; service cũng bỏ qua người đã ở trong nhóm.
      .transform((ids) => [...new Set(ids)]),
  }),
};

export const memberParamSchema = {
  params: conversationIdParam.extend({ userId: objectId }),
};

export const setMemberRoleSchema = {
  params: conversationIdParam.extend({ userId: objectId }),
  body: z.object({
    // "owner" được chấp nhận ở đây và được chuyển sang luồng chuyển quyền sở hữu,
    // để client chỉ cần một endpoint.
    role: z.enum([ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER]),
  }),
};

export const transferOwnershipSchema = {
  params: conversationIdParam,
  body: z.object({ userId: objectId }),
};
