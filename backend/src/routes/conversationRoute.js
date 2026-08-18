import express from "express";
import {
  createConversation,
  getConversations,
  getMessages,
  getMessagesSince,
  markAsSeen,
} from "../controllers/conversationController.js";
import {
  deleteConversation,
  deleteGroupAvatar,
  deleteMember,
  getConversation,
  patchGroupInfo,
  patchMemberRole,
  postLeave,
  postMembers,
  postTransferOwnership,
  putGroupAvatar,
} from "../controllers/groupController.js";
import { checkFriendship } from "../middlewares/friendMiddleware.js";
import { requireMembership } from "../middlewares/membershipMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { uploadAvatar } from "../middlewares/uploadMiddleware.js";
import {
  createConversationSchema,
  getMessagesSchema,
  getMessagesSinceSchema,
  markAsSeenSchema,
} from "../schemas/conversationSchemas.js";
import {
  addMembersSchema,
  memberParamSchema,
  setMemberRoleSchema,
  transferOwnershipSchema,
  updateGroupInfoSchema,
} from "../schemas/groupSchemas.js";
import { conversationIdParamSchema } from "../schemas/conversationSchemas.js";

const router = express.Router();

/** Chỉ owner và admin được sửa nhóm. */
const groupAdmin = () =>
  requireMembership({ types: ["group"], roles: ["owner", "admin"] });

/** Owner mới được làm những việc không thể hoàn tác. */
const groupOwner = () => requireMembership({ types: ["group"], roles: ["owner"] });

/** Bất kỳ thành viên nào của nhóm. */
const groupMember = () => requireMembership({ types: ["group"] });

router.post("/", validate(createConversationSchema), checkFriendship, createConversation);
router.get("/", getConversations);

// requireMembership đóng hai lỗ IDOR: trước đây cả hai route này lấy
// conversationId thẳng từ URL và không hề kiểm tra người gọi có thuộc
// conversation đó hay không — nên đọc được toàn bộ lịch sử tin nhắn của bất kỳ
// conversation nào, và tự thêm mình vào `seenBy` của nó.
router.get(
  "/:conversationId/messages",
  validate(getMessagesSchema),
  requireMembership(),
  getMessages,
);

// Phân trang xuôi, dùng để đồng bộ lại sau khi mất kết nối.
router.get(
  "/:conversationId/messages/since",
  validate(getMessagesSinceSchema),
  requireMembership(),
  getMessagesSince,
);

router.patch(
  "/:conversationId/seen",
  validate(markAsSeenSchema),
  requireMembership(),
  markAsSeen,
);

// --- Quản lý nhóm -----------------------------------------------------------
// Quyền được ép ở SERVER, qua `roles` của requireMembership cộng với các kiểm tra
// chi tiết hơn trong groupService (ví dụ admin không xoá được admin khác). Client
// không bao giờ là nơi quyết định.

router.get(
  "/:conversationId",
  validate(conversationIdParamSchema),
  requireMembership(),
  getConversation,
);

router.patch(
  "/:conversationId/group",
  validate(updateGroupInfoSchema),
  groupAdmin(),
  patchGroupInfo,
);

router.post(
  "/:conversationId/group/avatar",
  validate(conversationIdParamSchema),
  groupAdmin(),
  uploadAvatar.single("file"),
  putGroupAvatar,
);

router.delete(
  "/:conversationId/group/avatar",
  validate(conversationIdParamSchema),
  groupAdmin(),
  deleteGroupAvatar,
);

router.post(
  "/:conversationId/members",
  validate(addMembersSchema),
  groupAdmin(),
  // Chỉ thêm được bạn bè vào nhóm.
  checkFriendship,
  postMembers,
);

// Không dùng `groupAdmin()` ở đây: quyền phụ thuộc vào vai trò của NGƯỜI BỊ XOÁ
// (admin xoá được member nhưng không xoá được admin khác), nên việc kiểm tra nằm
// trong service nơi biết cả hai vai trò.
router.delete(
  "/:conversationId/members/:userId",
  validate(memberParamSchema),
  groupMember(),
  deleteMember,
);

router.patch(
  "/:conversationId/members/:userId/role",
  validate(setMemberRoleSchema),
  groupOwner(),
  patchMemberRole,
);

router.post(
  "/:conversationId/transfer-ownership",
  validate(transferOwnershipSchema),
  groupOwner(),
  postTransferOwnership,
);

router.post(
  "/:conversationId/leave",
  validate(conversationIdParamSchema),
  groupMember(),
  postLeave,
);

router.delete(
  "/:conversationId",
  validate(conversationIdParamSchema),
  groupOwner(),
  deleteConversation,
);

export default router;
