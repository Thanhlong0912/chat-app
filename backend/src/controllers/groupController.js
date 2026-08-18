import {
  addMembers,
  deleteGroup,
  leaveGroup,
  removeMember,
  setMemberRole,
  transferOwnership,
  updateGroupAvatar,
  updateGroupInfo,
} from "../services/groupService.js";
import { destroyImage, uploadImageFromBuffer } from "../middlewares/uploadMiddleware.js";
import { serializeConversation } from "../serializers/conversation.js";
import { badRequest } from "../utils/errors.js";

/**
 * Adapter HTTP mỏng trên `groupService`.
 *
 * Toàn bộ quy tắc quyền và các bất biến (luôn đúng một owner, owner phải chuyển
 * quyền trước khi rời, v.v.) nằm trong service — nhờ vậy đường socket sau này dùng
 * lại được mà không phải nhân bản logic.
 *
 * `req.conversation` và `req.membership` do `requireMembership` gắn vào.
 */

const respond = (res, conversation, viewerId) =>
  res.status(200).json({ conversation: serializeConversation(conversation, { viewerId }) });

/** Chi tiết một conversation, cho panel thông tin nhóm. */
export const getConversation = async (req, res) => {
  const conversation = req.conversation;

  await conversation.populate([
    { path: "participants.userId", select: "displayName avatarUrl" },
    { path: "lastMessage.senderId", select: "displayName avatarUrl" },
  ]);

  return respond(res, conversation, req.user._id);
};

export const patchGroupInfo = async (req, res) => {
  const { name, description } = req.body;

  if (name === undefined && description === undefined) {
    throw badRequest("NOTHING_TO_UPDATE", "Không có thông tin nào để cập nhật");
  }

  const conversation = await updateGroupInfo({
    conversation: req.conversation,
    actor: req.user,
    name,
    description,
  });

  return respond(res, conversation, req.user._id);
};

export const putGroupAvatar = async (req, res) => {
  if (!req.file) {
    throw badRequest("NO_FILE", "Chưa chọn tệp nào");
  }

  const result = await uploadImageFromBuffer(req.file.buffer, {
    folder: "moji_chat/groups",
  });

  const { conversation, previousAvatarId } = await updateGroupAvatar({
    conversation: req.conversation,
    actor: req.user,
    avatarUrl: result.secure_url,
    avatarId: result.public_id,
  });

  // Dọn ảnh cũ sau khi ảnh mới đã lưu thành công.
  await destroyImage(previousAvatarId);

  return respond(res, conversation, req.user._id);
};

export const deleteGroupAvatar = async (req, res) => {
  const { conversation, previousAvatarId } = await updateGroupAvatar({
    conversation: req.conversation,
    actor: req.user,
    avatarUrl: null,
    avatarId: null,
  });

  await destroyImage(previousAvatarId);

  return respond(res, conversation, req.user._id);
};

export const postMembers = async (req, res) => {
  const { conversation, added } = await addMembers({
    conversation: req.conversation,
    actor: req.user,
    memberIds: req.body.memberIds,
  });

  return res.status(200).json({
    conversation: serializeConversation(conversation, { viewerId: req.user._id }),
    added,
  });
};

export const deleteMember = async (req, res) => {
  const conversation = await removeMember({
    conversation: req.conversation,
    actor: req.user,
    targetId: req.params.userId,
  });

  return respond(res, conversation, req.user._id);
};

export const patchMemberRole = async (req, res) => {
  const { role } = req.body;

  const conversation =
    role === "owner"
      ? await transferOwnership({
          conversation: req.conversation,
          actor: req.user,
          targetId: req.params.userId,
        })
      : await setMemberRole({
          conversation: req.conversation,
          actor: req.user,
          targetId: req.params.userId,
          role,
        });

  return respond(res, conversation, req.user._id);
};

export const postTransferOwnership = async (req, res) => {
  const conversation = await transferOwnership({
    conversation: req.conversation,
    actor: req.user,
    targetId: req.body.userId,
  });

  return respond(res, conversation, req.user._id);
};

export const postLeave = async (req, res) => {
  const result = await leaveGroup({ conversation: req.conversation, actor: req.user });

  if (result.deleted) {
    return res.status(200).json({ deleted: true });
  }

  return res.status(200).json({
    deleted: false,
    conversation: serializeConversation(result.conversation, { viewerId: req.user._id }),
  });
};

export const deleteConversation = async (req, res) => {
  await deleteGroup({ conversation: req.conversation, actor: req.user });

  return res.status(200).json({ deleted: true });
};
