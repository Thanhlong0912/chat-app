import express from "express";
import {
  createConversation,
  getConversations,
  getMessages,
  markAsSeen,
} from "../controllers/conversationController.js";
import { checkFriendship } from "../middlewares/friendMiddleware.js";
import { requireMembership } from "../middlewares/membershipMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  conversationIdParamSchema,
  createConversationSchema,
  getMessagesSchema,
} from "../schemas/conversationSchemas.js";

const router = express.Router();

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
router.patch(
  "/:conversationId/seen",
  validate(conversationIdParamSchema),
  requireMembership(),
  markAsSeen,
);

export default router;
