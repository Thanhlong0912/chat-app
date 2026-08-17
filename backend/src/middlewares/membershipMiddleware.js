import { loadMembership } from "../services/membershipService.js";
import { badRequest, forbidden } from "../utils/errors.js";

/**
 * Yêu cầu người gọi là thành viên của conversation, tuỳ chọn kèm ràng buộc về
 * loại conversation và vai trò.
 *
 * Gắn `req.conversation` và `req.membership` cho controller dùng lại, nên
 * controller không phải query lần nữa.
 *
 * @param {object}   opts
 * @param {"params"|"body"|"query"} opts.source  nơi lấy id
 * @param {string}   opts.key                    tên field chứa id
 * @param {string[]} opts.types                  giới hạn loại, ví dụ ["group"]
 * @param {string[]} opts.roles                  giới hạn vai trò, ví dụ ["owner","admin"]
 */
export const requireMembership = ({
  source = "params",
  key = "conversationId",
  types = null,
  roles = null,
} = {}) => {
  return async (req, res, next) => {
    const conversationId = req[source]?.[key];

    if (!conversationId) {
      throw badRequest("MISSING_CONVERSATION_ID", `Thiếu ${key}`);
    }

    const { conversation, participant, role } = await loadMembership(
      req.user._id,
      conversationId,
    );

    if (types && !types.includes(conversation.type)) {
      throw badRequest(
        "WRONG_CONVERSATION_TYPE",
        `Thao tác này chỉ áp dụng cho ${types.join(" hoặc ")}`,
      );
    }

    if (roles && !roles.includes(role)) {
      throw forbidden("INSUFFICIENT_ROLE", "Bạn không có quyền thực hiện việc này");
    }

    req.conversation = conversation;
    req.membership = { participant, role };

    next();
  };
};

export default requireMembership;
