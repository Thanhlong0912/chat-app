import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import {
  ACTIONS,
  ROLES,
  can,
  findParticipant,
  getRole,
} from "../domain/groupPermissions.js";
import { invalidateMembership } from "./membershipService.js";
import { invalidateAudience } from "./audienceService.js";
import { serializeConversation } from "../serializers/conversation.js";
import { serializeMessage } from "../serializers/message.js";
import { getIo } from "../socket/io.js";
import { SERVER_EVENTS, conversationRoom, userRoom } from "../socket/events.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";
import logger from "../utils/logger.js";

/** Giới hạn số thành viên một nhóm. */
export const MAX_GROUP_MEMBERS = 256;

const PARTICIPANT_POPULATE = [
  { path: "participants.userId", select: "displayName avatarUrl" },
  { path: "lastMessage.senderId", select: "displayName avatarUrl" },
];

/**
 * Ghi một tin nhắn hệ thống và phát nó ra như một tin nhắn thường.
 *
 * Một đường code duy nhất cho cả hai việc, và nhờ đó có luôn dấu vết kiểm toán
 * ngay trong luồng chat ("Long đã thêm Mai vào nhóm") mà không cần event riêng.
 */
const recordSystemEvent = async (conversation, { type, actorId, targetIds = [], meta }) => {
  const message = await Message.create({
    conversationId: conversation._id,
    senderId: actorId,
    kind: "system",
    systemEvent: { type, actorId, targetIds, meta },
  });

  conversation.set({
    lastMessageAt: message.createdAt,
    lastMessage: {
      _id: message._id,
      content: null,
      senderId: actorId,
      createdAt: message.createdAt,
    },
  });

  return message;
};

/** Id của mọi thành viên, dạng string, dù đã populate hay chưa. */
const participantIds = (conversation) =>
  (conversation.participants ?? []).map((p) => String(p.userId?._id ?? p.userId));

/**
 * Phát conversation:updated + tin nhắn hệ thống.
 *
 * `conversation:updated` đi tới TỪNG người một, serialize theo góc nhìn của chính
 * họ. Bản trước phát một payload duy nhất cho cả room, serialize không kèm
 * `viewerId` — mà thiếu `viewerId` thì serializer trả `myRole: null`,
 * `unreadCount: 0`, `pinned: false`. Client `upsertConversation` thay nguyên
 * object, nên chỉ một thao tác nhóm bất kỳ là mọi thành viên (kể cả chủ nhóm) mất
 * sạch vai trò và số chưa đọc cho tới khi tải lại trang — và menu "..." trên tin
 * nhắn nhóm, vốn đọc `myRole`, rỗng ruột theo.
 *
 * Tin nhắn hệ thống thì vẫn phát cho cả room: payload của nó không có field nào
 * phụ thuộc người xem.
 */
const broadcast = async (conversation, systemMessage) => {
  const io = getIo();
  if (!io) return;

  await conversation.populate(PARTICIPANT_POPULATE);

  const room = conversationRoom(conversation._id);

  participantIds(conversation).forEach((memberId) => {
    io.to(userRoom(memberId)).emit(SERVER_EVENTS.CONVERSATION_UPDATED, {
      conversation: serializeConversation(conversation, { viewerId: memberId }),
    });
  });

  if (systemMessage) {
    io.to(room).emit(SERVER_EVENTS.MESSAGE_NEW, {
      message: serializeMessage(systemMessage),
      conversation: {
        _id: String(conversation._id),
        lastMessage: {
          _id: String(systemMessage._id),
          content: null,
          senderId: String(systemMessage.senderId),
          createdAt: systemMessage.createdAt,
        },
        lastMessageAt: conversation.lastMessageAt,
      },
      unreadCounts: Object.fromEntries(conversation.unreadCounts ?? []),
    });
  }
};

/** Quyền và cache thành viên đều phải làm mới sau mỗi thay đổi. */
const invalidate = (conversation, affectedUserIds = []) => {
  invalidateMembership(String(conversation._id));

  const memberIds = (conversation.participants ?? []).map((p) =>
    String(p.userId?._id ?? p.userId),
  );

  // Audience là hai chiều: đổi thành viên thì audience của cả nhóm cùng đổi.
  [...memberIds, ...affectedUserIds.map(String)].forEach((id) =>
    invalidateAudience(id, memberIds),
  );
};

/**
 * Bỏ một người khỏi mảng participants.
 *
 * Gán lại mảng đã lọc thay vì dùng `DocumentArray.pull`: participantSchema khai báo
 * `_id: false`, mà `pull` khớp phần tử theo `_id`, nên hành vi của nó ở đây không
 * hiển nhiên. Lọc theo string id thì rõ ràng và luôn đúng.
 */
const dropParticipant = (conversation, userId) => {
  const target = String(userId);

  conversation.participants = conversation.participants.filter(
    (p) => String(p.userId?._id ?? p.userId) !== target,
  );
  conversation.unreadCounts.delete(target);
};

const assertGroup = (conversation) => {
  if (conversation.type !== "group") {
    throw badRequest("WRONG_CONVERSATION_TYPE", "Thao tác này chỉ áp dụng cho nhóm chat");
  }
};

const requirePermission = (conversation, actorId, action, targetRole) => {
  const actorRole = getRole(conversation, actorId);

  if (!can(actorRole, action, { targetRole })) {
    throw forbidden("INSUFFICIENT_ROLE", "Bạn không có quyền thực hiện việc này");
  }

  return actorRole;
};

// ---------------------------------------------------------------------------
// Thông tin nhóm
// ---------------------------------------------------------------------------

export async function updateGroupInfo({ conversation, actor, name, description }) {
  assertGroup(conversation);
  requirePermission(conversation, actor._id, ACTIONS.GROUP_UPDATE);

  const previousName = conversation.group?.name;

  if (name !== undefined) conversation.set("group.name", name);
  if (description !== undefined) conversation.set("group.description", description);

  const renamed = name !== undefined && name !== previousName;

  const systemMessage = renamed
    ? await recordSystemEvent(conversation, {
        type: "group_renamed",
        actorId: actor._id,
        meta: { from: previousName, to: name },
      })
    : null;

  await conversation.save();
  invalidate(conversation);
  await broadcast(conversation, systemMessage);

  return conversation;
}

export async function updateGroupAvatar({ conversation, actor, avatarUrl, avatarId }) {
  assertGroup(conversation);
  requirePermission(conversation, actor._id, ACTIONS.GROUP_UPDATE);

  const previousAvatarId = conversation.group?.avatarId;

  conversation.set("group.avatarUrl", avatarUrl ?? null);
  conversation.set("group.avatarId", avatarId ?? null);

  const systemMessage = await recordSystemEvent(conversation, {
    type: "group_avatar_changed",
    actorId: actor._id,
  });

  await conversation.save();
  await broadcast(conversation, systemMessage);

  // Trả về id ảnh cũ để controller dọn asset trên Cloudinary.
  return { conversation, previousAvatarId };
}

// ---------------------------------------------------------------------------
// Thành viên
// ---------------------------------------------------------------------------

export async function addMembers({ conversation, actor, memberIds }) {
  assertGroup(conversation);
  requirePermission(conversation, actor._id, ACTIONS.MEMBER_ADD);

  const existing = new Set(
    conversation.participants.map((p) => String(p.userId?._id ?? p.userId)),
  );

  // Thêm người đã ở trong nhóm là no-op, không tạo participant trùng.
  const toAdd = [...new Set(memberIds.map(String))].filter((id) => !existing.has(id));

  if (toAdd.length === 0) {
    return { conversation, added: [] };
  }

  if (existing.size + toAdd.length > MAX_GROUP_MEMBERS) {
    throw badRequest(
      "GROUP_FULL",
      `Nhóm chỉ có tối đa ${MAX_GROUP_MEMBERS} thành viên`,
    );
  }

  // Không thêm được user không tồn tại.
  const found = await User.find({ _id: { $in: toAdd } }).select("_id").lean();

  if (found.length !== toAdd.length) {
    throw badRequest("USER_NOT_FOUND", "Một số người dùng không tồn tại");
  }

  toAdd.forEach((id) => {
    conversation.participants.push({
      userId: new mongoose.Types.ObjectId(id),
      role: ROLES.MEMBER,
      joinedAt: new Date(),
    });
    // Người mới chưa đọc gì; bắt đầu từ 0 thay vì để trống.
    conversation.unreadCounts.set(id, 0);
  });

  const systemMessage = await recordSystemEvent(conversation, {
    type: "member_added",
    actorId: actor._id,
    targetIds: toAdd,
  });

  await conversation.save();
  invalidate(conversation, toAdd);

  // Cho socket của người mới vào room ngay, nếu không họ phải tải lại trang mới
  // nhận được tin nhắn realtime của nhóm.
  const io = getIo();
  toAdd.forEach((id) => {
    io?.in(userRoom(id)).socketsJoin(conversationRoom(conversation._id));
  });

  await broadcast(conversation, systemMessage);

  // Người mới cần biết là họ vừa được thêm vào, kể cả khi chưa ở trong room.
  await conversation.populate(PARTICIPANT_POPULATE);
  toAdd.forEach((id) => {
    io?.to(userRoom(id)).emit(SERVER_EVENTS.CONVERSATION_CREATED, {
      conversation: serializeConversation(conversation, { viewerId: id }),
    });
  });

  return { conversation, added: toAdd };
}

export async function removeMember({ conversation, actor, targetId }) {
  assertGroup(conversation);

  const target = findParticipant(conversation, targetId);

  if (!target) {
    throw notFound("NOT_A_MEMBER", "Người này không ở trong nhóm");
  }

  if (String(targetId) === String(actor._id)) {
    // Tự rời nhóm là `leaveGroup`, có xử lý chuyển quyền sở hữu.
    throw badRequest("USE_LEAVE_INSTEAD", "Hãy dùng chức năng rời nhóm");
  }

  const targetRole = getRole(conversation, target);
  requirePermission(conversation, actor._id, ACTIONS.MEMBER_REMOVE, targetRole);

  dropParticipant(conversation, targetId);

  const systemMessage = await recordSystemEvent(conversation, {
    type: "member_removed",
    actorId: actor._id,
    targetIds: [targetId],
  });

  await conversation.save();
  invalidate(conversation, [targetId]);

  const io = getIo();
  const room = conversationRoom(conversation._id);

  // Buộc rời room NGAY. Cache membership có TTL 30s, nên nếu không làm bước này
  // người vừa bị xoá vẫn nhận tin nhắn trong tối đa nửa phút.
  io?.in(userRoom(targetId)).socketsLeave(room);
  io?.to(userRoom(targetId)).emit(SERVER_EVENTS.CONVERSATION_REMOVED, {
    conversationId: String(conversation._id),
    reason: "removed",
  });

  await broadcast(conversation, systemMessage);

  return conversation;
}

export async function setMemberRole({ conversation, actor, targetId, role }) {
  assertGroup(conversation);

  const target = findParticipant(conversation, targetId);

  if (!target) {
    throw notFound("NOT_A_MEMBER", "Người này không ở trong nhóm");
  }

  const targetRole = getRole(conversation, target);
  requirePermission(conversation, actor._id, ACTIONS.MEMBER_SET_ROLE, targetRole);

  if (role === ROLES.OWNER) {
    // Phong owner cho người khác nghĩa là chuyển quyền sở hữu — có đường riêng,
    // vì phải đảm bảo luôn chỉ có đúng một owner.
    throw badRequest("USE_TRANSFER_INSTEAD", "Hãy dùng chức năng chuyển quyền sở hữu");
  }

  target.role = role;

  const systemMessage = await recordSystemEvent(conversation, {
    type: "role_changed",
    actorId: actor._id,
    targetIds: [targetId],
    meta: { role },
  });

  await conversation.save();
  invalidate(conversation, [targetId]);
  await broadcast(conversation, systemMessage);

  return conversation;
}

export async function transferOwnership({ conversation, actor, targetId }) {
  assertGroup(conversation);
  requirePermission(conversation, actor._id, ACTIONS.OWNER_TRANSFER);

  const target = findParticipant(conversation, targetId);

  if (!target) {
    throw notFound("NOT_A_MEMBER", "Người này không ở trong nhóm");
  }

  const actorParticipant = findParticipant(conversation, actor._id);

  // Đúng một owner tại mọi thời điểm: hạ owner cũ trong cùng một lần lưu.
  actorParticipant.role = ROLES.ADMIN;
  target.role = ROLES.OWNER;
  conversation.set("group.createdBy", target.userId?._id ?? target.userId);

  const systemMessage = await recordSystemEvent(conversation, {
    type: "role_changed",
    actorId: actor._id,
    targetIds: [targetId],
    meta: { role: ROLES.OWNER },
  });

  await conversation.save();
  invalidate(conversation, [targetId]);
  await broadcast(conversation, systemMessage);

  return conversation;
}

/**
 * Rời nhóm.
 *
 * Owner không thể chỉ đơn giản rời đi: nhóm không có owner thì không ai sửa được
 * cài đặt hay quản lý thành viên nữa. Nếu owner là người CUỐI CÙNG thì nhóm được
 * xoá; còn không thì quyền sở hữu tự chuyển cho admin lâu năm nhất (hoặc thành
 * viên lâu năm nhất nếu không có admin).
 */
export async function leaveGroup({ conversation, actor }) {
  assertGroup(conversation);

  const participant = findParticipant(conversation, actor._id);

  if (!participant) {
    throw forbidden("NOT_A_MEMBER", "Bạn không ở trong nhóm này");
  }

  const actorId = String(actor._id);
  const isOwner = getRole(conversation, participant) === ROLES.OWNER;
  const others = conversation.participants.filter(
    (p) => String(p.userId?._id ?? p.userId) !== actorId,
  );

  const io = getIo();
  const room = conversationRoom(conversation._id);

  if (others.length === 0) {
    // Người cuối cùng rời đi: xoá cả conversation và tin nhắn của nó.
    await Message.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });

    invalidate(conversation, [actorId]);

    io?.in(userRoom(actorId)).socketsLeave(room);
    io?.to(userRoom(actorId)).emit(SERVER_EVENTS.CONVERSATION_REMOVED, {
      conversationId: String(conversation._id),
      reason: "deleted",
    });

    return { deleted: true };
  }

  if (isOwner) {
    // Ứng viên: admin lâu năm nhất, nếu không có thì thành viên lâu năm nhất.
    const sorted = [...others].sort(
      (a, b) => new Date(a.joinedAt ?? 0) - new Date(b.joinedAt ?? 0),
    );
    const successor =
      sorted.find((p) => getRole(conversation, p) === ROLES.ADMIN) ?? sorted[0];

    successor.role = ROLES.OWNER;
    conversation.set("group.createdBy", successor.userId?._id ?? successor.userId);

    logger.info(
      `Owner ${actorId} rời nhóm ${conversation._id}, chuyển quyền cho ${successor.userId}`,
    );
  }

  dropParticipant(conversation, actorId);

  const systemMessage = await recordSystemEvent(conversation, {
    type: "member_left",
    actorId: actor._id,
    targetIds: [actorId],
  });

  await conversation.save();
  invalidate(conversation, [actorId]);

  io?.in(userRoom(actorId)).socketsLeave(room);
  io?.to(userRoom(actorId)).emit(SERVER_EVENTS.CONVERSATION_REMOVED, {
    conversationId: String(conversation._id),
    reason: "left",
  });

  await broadcast(conversation, systemMessage);

  return { deleted: false, conversation };
}

export async function deleteGroup({ conversation, actor }) {
  assertGroup(conversation);
  requirePermission(conversation, actor._id, ACTIONS.CONVERSATION_DELETE);

  const memberIds = conversation.participants.map((p) =>
    String(p.userId?._id ?? p.userId),
  );

  await Message.deleteMany({ conversationId: conversation._id });
  await Conversation.deleteOne({ _id: conversation._id });

  invalidate(conversation, memberIds);

  const io = getIo();
  const room = conversationRoom(conversation._id);

  io?.to(room).emit(SERVER_EVENTS.CONVERSATION_REMOVED, {
    conversationId: String(conversation._id),
    reason: "deleted",
  });

  // Dọn room để không còn socket nào treo lại trong đó.
  io?.in(room).socketsLeave(room);

  return { deleted: true };
}
