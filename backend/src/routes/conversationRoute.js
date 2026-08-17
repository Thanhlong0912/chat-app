import express from "express";
import {
  createConversation,
  getConversations,
  getMessages,
  getMessagesSince,
  markAsSeen,
} from "../controllers/conversationController.js";
import { checkFriendship } from "../middlewares/friendMiddleware.js";
import { requireMembership } from "../middlewares/membershipMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  createConversationSchema,
  getMessagesSchema,
  getMessagesSinceSchema,
  markAsSeenSchema,
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

// Phân trang xuôi, dùng để đồng bộ lại sau khi mất kết nối. Đăng ký trước route
// `/messages` là không cần thiết vì path khác nhau, nhưng giữ cạnh nhau cho dễ đọc.
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

export default router;
