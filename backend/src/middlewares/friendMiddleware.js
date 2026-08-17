import Conversation from "../models/Conversation.js";
import Friend from "../models/Friend.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export const checkFriendship = async (req, res, next) => {
  const me = req.user._id.toString();
  const recipientId = req.body?.recipientId ?? null;
  const memberIds = req.body?.memberIds ?? [];

  if (!recipientId && memberIds.length === 0) {
    throw badRequest("MISSING_RECIPIENT", "Cần cung cấp recipientId hoặc memberIds");
  }

  if (recipientId) {
    const [userA, userB] = pair(me, recipientId);

    const isFriend = await Friend.findOne({ userA, userB });

    if (!isFriend) {
      throw forbidden("NOT_FRIENDS", "Bạn chưa kết bạn với người này");
    }

    return next();
  }

  const friendChecks = memberIds.map(async (memberId) => {
    const [userA, userB] = pair(me, memberId);
    const friend = await Friend.findOne({ userA, userB });
    return friend ? null : memberId;
  });

  const results = await Promise.all(friendChecks);
  const notFriends = results.filter(Boolean);

  if (notFriends.length > 0) {
    throw forbidden("NOT_FRIENDS", "Bạn chỉ có thể thêm bạn bè vào nhóm.", { notFriends });
  }

  next();
};

/**
 * Xác nhận người gọi là thành viên của conversation trong `req.body.conversationId`.
 *
 * TODO(Phase 1): thay bằng `requireMembership` dùng chung — logic này đúng nhưng
 * đang bị gắn cứng vào `req.body`, nên các route đọc id từ `req.params` không dùng
 * lại được và hiện đang không kiểm tra quyền gì cả.
 */
export const checkGroupMembership = async (req, res, next) => {
  const { conversationId } = req.body;
  const userId = req.user._id;

  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    throw notFound("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện");
  }

  const isMember = conversation.participants.some(
    (p) => p.userId.toString() === userId.toString(),
  );

  if (!isMember) {
    throw forbidden("NOT_A_MEMBER", "Bạn không ở trong group này.");
  }

  req.conversation = conversation;

  next();
};
