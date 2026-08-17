import express from "express";

import {
  sendDirectMessage,
  sendGroupMessage,
} from "../controllers/messageController.js";
import { checkFriendship } from "../middlewares/friendMiddleware.js";
import { requireMembership } from "../middlewares/membershipMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
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

export default router;
