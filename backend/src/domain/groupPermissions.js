/**
 * Model quyền của group chat. Thuần logic, không I/O — nên test được trực tiếp.
 *
 * Chỉ áp dụng cho conversation `type: "group"`. Trong direct chat hai người là
 * ngang hàng, không có vai trò nào cả.
 */
export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
};

export const ROLE_VALUES = Object.values(ROLES);

/** Bậc quyền, dùng để so sánh "cao hơn / ngang bằng". */
const RANK = {
  [ROLES.OWNER]: 3,
  [ROLES.ADMIN]: 2,
  [ROLES.MEMBER]: 1,
};

export const ACTIONS = {
  SEND: "send",
  LEAVE: "leave",
  EDIT_OWN: "edit:own",
  DELETE_OWN: "delete:own",
  MEMBER_ADD: "member:add",
  MEMBER_REMOVE: "member:remove",
  GROUP_UPDATE: "group:update",
  MEMBER_SET_ROLE: "member:setRole",
  OWNER_TRANSFER: "owner:transfer",
  CONVERSATION_DELETE: "conversation:delete",
  MESSAGE_DELETE_ANY: "message:delete:any",
};

const isOwner = (role) => role === ROLES.OWNER;
const isAdminOrAbove = (role) => RANK[role] >= RANK[ROLES.ADMIN];

/**
 * Vai trò của một user trong conversation.
 *
 * Có fallback về `group.createdBy` cho các document tạo trước khi field `role`
 * tồn tại. Nhờ vậy ứng dụng đã đúng *trước khi* script backfill chạy — backfill
 * chỉ là tối ưu, không phải điều kiện tiên quyết để deploy.
 */
export function getRole(conversation, userIdOrParticipant) {
  if (!conversation) return null;

  // Direct chat: không có thứ bậc.
  if (conversation.type !== "group") return ROLES.MEMBER;

  const participant =
    userIdOrParticipant && typeof userIdOrParticipant === "object" && userIdOrParticipant.userId
      ? userIdOrParticipant
      : findParticipant(conversation, userIdOrParticipant);

  if (!participant) return null;

  if (participant.role) return participant.role;

  const createdBy = conversation.group?.createdBy;
  const participantId = participant.userId?._id ?? participant.userId;

  return createdBy && String(createdBy) === String(participantId) ? ROLES.OWNER : ROLES.MEMBER;
}

export function findParticipant(conversation, userId) {
  if (!conversation?.participants) return null;

  return (
    conversation.participants.find((p) => {
      const id = p.userId?._id ?? p.userId;
      return String(id) === String(userId);
    }) ?? null
  );
}

export function isMember(conversation, userId) {
  return Boolean(findParticipant(conversation, userId));
}

/**
 * `actorRole` có được thực hiện `action` hay không.
 *
 * `targetRole` chỉ cần cho các hành động nhắm vào một thành viên khác
 * (`member:remove`, `member:setRole`).
 */
export function can(actorRole, action, { targetRole } = {}) {
  if (!actorRole || !RANK[actorRole]) return false;

  switch (action) {
    // Ai cũng làm được với nội dung của chính mình.
    case ACTIONS.SEND:
    case ACTIONS.LEAVE:
    case ACTIONS.EDIT_OWN:
    case ACTIONS.DELETE_OWN:
      return true;

    case ACTIONS.MEMBER_ADD:
    case ACTIONS.GROUP_UPDATE:
    case ACTIONS.MESSAGE_DELETE_ANY:
      return isAdminOrAbove(actorRole);

    // Owner xoá được mọi người trừ chính mình (đó là `leave`/`owner:transfer`).
    // Admin chỉ xoá được member thường — không xoá được admin khác hay owner.
    case ACTIONS.MEMBER_REMOVE: {
      if (!targetRole || !RANK[targetRole]) return false;
      if (isOwner(targetRole)) return false;
      if (isOwner(actorRole)) return true;
      if (actorRole === ROLES.ADMIN) return targetRole === ROLES.MEMBER;
      return false;
    }

    // Chỉ owner phong/giáng quyền, và không thể tự phong owner cho người khác
    // bằng đường này — chuyển quyền sở hữu là `owner:transfer`.
    case ACTIONS.MEMBER_SET_ROLE: {
      if (!isOwner(actorRole)) return false;
      if (isOwner(targetRole)) return false;
      return true;
    }

    case ACTIONS.OWNER_TRANSFER:
    case ACTIONS.CONVERSATION_DELETE:
      return isOwner(actorRole);

    default:
      // Mặc định từ chối: một action chưa biết không bao giờ được phép.
      return false;
  }
}
