import express from "express";

import {
  patchMessage,
  removeMessage,
  sendDirectMessage,
  sendGroupMessage,
} from "../controllers/messageController.js";
import { checkFriendship } from "../middlewares/friendMiddleware.js";
import { requireMembership } from "../middlewares/membershipMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  editMessageSchema,
  messageIdParamSchema,
  sendDirectMessageSchema,
  sendGroupMessageSchema,
} from "../schemas/messageSchemas.js";

const router = express.Router();

router.post(
  "/direct",
  validate(sendDirectMessageSchema),
  checkFriendship,
  sendDirectMessage,
);

// Thay cho checkGroupMembership: cùng logic, nhưng dùng chung một primitive và
// kèm ràng buộc loại conversation.
router.post(
  "/group",
  validate(sendGroupMessageSchema),
  requireMembership({ source: "body", types: ["group"] }),
  sendGroupMessage,
);

/*
 * Sửa và xoá không dùng `requireMembership` ở tầng route: id conversation chưa
 * biết cho tới khi nạp được tin nhắn. Service tự nạp tin nhắn rồi mới kiểm tra
 * quyền thành viên của conversation chứa nó — nếu không, chỉ cần biết id tin nhắn
 * là sửa/xoá được tin của người lạ.
 */
router.patch("/:messageId", validate(editMessageSchema), patchMessage);
router.delete("/:messageId", validate(messageIdParamSchema), removeMessage);

export default router;
