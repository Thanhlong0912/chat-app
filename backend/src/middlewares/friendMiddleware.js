import Friend from "../models/Friend.js";
import { badRequest, forbidden } from "../utils/errors.js";

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

  // Bỏ qua chính mình: không ai là bạn của chính mình, và client hoàn toàn có thể
  // gửi kèm id của người đang thao tác trong danh sách. Nếu không loại ở đây thì
  // request bị 403 NOT_FRIENDS trước khi controller kịp lọc trùng.
  const others = memberIds.filter((id) => String(id) !== me);

  const friendChecks = others.map(async (memberId) => {
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

// `checkGroupMembership` đã bị bỏ — thay bằng `requireMembership` trong
// middlewares/membershipMiddleware.js, dùng chung logic với tầng socket.
