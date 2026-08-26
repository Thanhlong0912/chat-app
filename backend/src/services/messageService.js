import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message, { MAX_REACTIONS_PER_MESSAGE } from "../models/Message.js";
import { serializeMessage } from "../serializers/message.js";
import { serializeConversation } from "../serializers/conversation.js";
import {
  emitNewMessage,
  updateConversationAfterCreateMessage,
} from "../utils/messageHelper.js";
import { getIo } from "../socket/io.js";
import { SERVER_EVENTS, conversationRoom, userRoom } from "../socket/events.js";
import { loadMembership } from "./membershipService.js";
import { ACTIONS, can } from "../domain/groupPermissions.js";
import { destroyImage } from "../middlewares/uploadMiddleware.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

/**
 * Nơi DUY NHẤT một tin nhắn được ghi.
 *
 * Cả controller HTTP và socket handler đều là adapter mỏng gọi vào đây, nên logic
 * cập nhật conversation, phát realtime và chống trùng chỉ tồn tại một bản.
 */

const REPLY_SNAPSHOT_LENGTH = 140;

/**
 * @param {object} args
 * @param {object} args.conversation  document đã xác thực quyền
 * @param {object} args.sender        req.user / socket.user
 * @param {string} [args.content]
 * @param {string} [args.clientMessageId]
 * @param {string} [args.replyToMessageId]
 * @param {Array}  [args.attachments]
 * @param {string} [args.kind]
 * @returns {Promise<{message: object, serialized: object, duplicate: boolean}>}
 */
export async function createMessage({
  conversation,
  sender,
  content,
  clientMessageId,
  replyToMessageId,
  attachments,
  kind,
}) {
  if (!content?.trim() && !attachments?.length) {
    throw badRequest("EMPTY_MESSAGE", "Tin nhắn phải có nội dung hoặc tệp đính kèm");
  }

  const replyTo = await buildReplySnapshot(conversation, replyToMessageId);

  const payload = {
    conversationId: conversation._id,
    senderId: sender._id,
    /*
     * `kind` của tin nhắn theo `kind` của tệp đính kèm đầu tiên.
     *
     * Bản trước cứng nhắc gán "image" cho mọi tin có đính kèm, nên một video được
     * lưu là tin nhắn ảnh và client vẽ nó bằng thẻ <img> — ra một khung trống.
     */
    kind: kind ?? (attachments?.length ? (attachments[0].kind ?? "image") : "text"),
    content: content?.trim() || null,
    ...(attachments?.length ? { attachments } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
  };

  let message;
  let duplicate = false;

  try {
    message = await Message.create(payload);
  } catch (error) {
    /*
     * Trùng `clientMessageId` không phải lỗi — đó là client gửi lại.
     *
     * Đây là thứ khiến gửi lạc quan an toàn khi mất kết nối: client retry cùng một
     * clientMessageId, và server trả về đúng tin nhắn đã tạo thay vì tạo bản thứ
     * hai hoặc báo lỗi. Chỉ có thể làm được nhờ partial unique index
     * {conversationId, clientMessageId}.
     */
    const isDuplicate = error?.code === 11000 && clientMessageId;

    if (!isDuplicate) throw error;

    message = await Message.findOne({
      conversationId: conversation._id,
      clientMessageId,
    });

    // Cực hiếm: index báo trùng nhưng không tìm lại được (ví dụ vừa bị xoá).
    if (!message) throw error;

    duplicate = true;
  }

  // Người gửi đã có trong bộ nhớ, gán trực tiếp để payload realtime có tên và
  // avatar mà không cần thêm một query populate.
  message.senderId = sender;

  const serialized = serializeMessage(message, { viewerId: sender._id });

  // Bản trùng thì conversation đã được cập nhật ở lần gửi đầu — cập nhật lại sẽ
  // tăng số chưa đọc lên lần thứ hai cho một tin nhắn duy nhất.
  if (!duplicate) {
    updateConversationAfterCreateMessage(conversation, message, sender._id);
    await conversation.save();

    emitNewMessage(getIo(), conversation, message);
  }

  return { message, serialized, duplicate };
}

/**
 * Ảnh chụp của tin nhắn được trả lời.
 *
 * Phải kiểm tra tin nhắn gốc thuộc CÙNG conversation — nếu không, một reply có thể
 * dùng để rút 140 ký tự nội dung từ một conversation khác.
 */
async function buildReplySnapshot(conversation, replyToMessageId) {
  if (!replyToMessageId) return null;

  if (!mongoose.isValidObjectId(replyToMessageId)) {
    throw badRequest("INVALID_ID", "replyToMessageId không hợp lệ");
  }

  const parent = await Message.findOne({
    _id: replyToMessageId,
    conversationId: conversation._id,
  })
    .select("_id senderId content kind deletedAt")
    .lean();

  if (!parent) {
    throw badRequest(
      "REPLY_TARGET_NOT_IN_CONVERSATION",
      "Không thể trả lời một tin nhắn ngoài cuộc trò chuyện này",
    );
  }

  return {
    messageId: parent._id,
    senderId: parent.senderId,
    // Tin nhắn gốc đã xoá thì không trích nội dung.
    contentSnapshot: parent.deletedAt
      ? null
      : (parent.content ?? "").slice(0, REPLY_SNAPSHOT_LENGTH) || null,
    kindSnapshot: parent.kind ?? "text",
  };
}

/**
 * Cửa sổ thời gian được phép sửa tin nhắn.
 *
 * Có giới hạn là có chủ đích: nếu sửa được vô thời hạn thì một cuộc trò chuyện có
 * thể bị viết lại nhiều tháng sau, và người đối diện không có cách nào biết nội
 * dung họ đã đọc từng là gì.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Nạp tin nhắn và conversation của nó, có kiểm tra quyền thành viên. */
const loadMessageForMutation = async (messageId, userId) => {
  if (!mongoose.isValidObjectId(messageId)) {
    throw badRequest("INVALID_ID", "messageId không hợp lệ");
  }

  const message = await Message.findById(messageId);

  if (!message) {
    throw notFound("MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn");
  }

  // Phải là thành viên của conversation chứa tin nhắn đó — nếu không, chỉ cần biết
  // id tin nhắn là sửa/xoá được tin của người lạ.
  const { conversation, role } = await loadMembership(userId, message.conversationId);

  return { message, conversation, role };
};

/**
 * Sửa nội dung một tin nhắn.
 *
 * Chỉ người gửi, chỉ tin nhắn văn bản, và chỉ trong cửa sổ cho phép.
 */
export async function editMessage({ messageId, actor, content }) {
  const { message, conversation } = await loadMessageForMutation(messageId, actor._id);

  if (String(message.senderId) !== String(actor._id)) {
    throw forbidden("NOT_MESSAGE_SENDER", "Bạn chỉ sửa được tin nhắn của mình");
  }

  if (message.deletedAt) {
    throw badRequest("MESSAGE_DELETED", "Tin nhắn đã bị xoá");
  }

  if (message.kind !== "text") {
    throw badRequest("NOT_EDITABLE", "Chỉ sửa được tin nhắn văn bản");
  }

  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw badRequest("EDIT_WINDOW_EXPIRED", "Đã quá thời gian cho phép sửa tin nhắn");
  }

  message.content = content.trim();
  message.editedAt = new Date();
  await message.save();

  // Nếu đây là tin nhắn cuối, phần xem trước ở sidebar cũng phải đổi theo.
  if (String(conversation.lastMessage?._id) === String(message._id)) {
    conversation.set("lastMessage.content", message.content);
    await conversation.save();
  }

  message.senderId = actor;
  const serialized = serializeMessage(message, { viewerId: actor._id });

  getIo()
    ?.to(conversationRoom(message.conversationId))
    .emit(SERVER_EVENTS.MESSAGE_UPDATED, { message: serializeMessage(message) });

  return serialized;
}

/**
 * Xoá mềm một tin nhắn.
 *
 * Cố tình KHÔNG xoá bản ghi: chuỗi trả lời tham chiếu tới nó, và một khoảng trống
 * giữa luồng khó hiểu hơn nhiều so với một bia mộ. `serializeMessage` chịu trách
 * nhiệm không để nội dung đã xoá lọt ra ngoài.
 */
export async function deleteMessage({ messageId, actor }) {
  const { message, conversation, role } = await loadMessageForMutation(messageId, actor._id);

  if (message.deletedAt) {
    // Xoá lại một tin đã xoá là no-op, không phải lỗi — client có thể retry.
    return serializeMessage(message, { viewerId: actor._id });
  }

  const isSender = String(message.senderId) === String(actor._id);
  // Quản trị nhóm xoá được tin của người khác; trong chat 1-1 thì không có vai trò
  // nào cao hơn, nên chỉ người gửi mới xoá được.
  const canModerate =
    conversation.type === "group" && can(role, ACTIONS.MESSAGE_DELETE_ANY);

  if (!isSender && !canModerate) {
    throw forbidden("CANNOT_DELETE_MESSAGE", "Bạn không có quyền xoá tin nhắn này");
  }

  // Dọn tệp trên Cloudinary trước khi mất tham chiếu tới publicId. Giữ cả `kind`:
  // `destroy` mặc định resource_type "image", nên không truyền "video" thì video
  // không bao giờ bị xoá thật.
  const assets = (message.attachments ?? [])
    .filter((a) => a.publicId)
    .map((a) => ({ publicId: a.publicId, resourceType: a.kind === "video" ? "video" : "image" }));

  message.deletedAt = new Date();
  message.deletedBy = actor._id;
  message.content = null;
  message.attachments = undefined;
  await message.save();

  await Promise.all(assets.map((a) => destroyImage(a.publicId, a.resourceType)));

  // Tin nhắn cuối bị xoá thì phải tính lại phần xem trước, nếu không sidebar vẫn
  // hiển thị nội dung đã bị xoá.
  const wasLastMessage = String(conversation.lastMessage?._id) === String(message._id);

  if (wasLastMessage) {
    const previous = await Message.findOne({
      conversationId: conversation._id,
      deletedAt: null,
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    conversation.set(
      "lastMessage",
      previous
        ? {
            _id: previous._id,
            content: previous.content,
            senderId: previous.senderId,
            createdAt: previous.createdAt,
          }
        : null,
    );

    await conversation.save();
  }

  const io = getIo();
  const room = conversationRoom(message.conversationId);

  io?.to(room).emit(SERVER_EVENTS.MESSAGE_DELETED, {
    conversationId: String(message.conversationId),
    messageId: String(message._id),
    deletedAt: message.deletedAt,
  });

  /*
   * Phát cả conversation:updated khi phần xem trước đổi.
   *
   * `message:deleted` chỉ nói cho client biết về một tin nhắn; nó không chạm tới
   * `lastMessage` của conversation. Thiếu bước này thì sidebar tiếp tục hiển thị
   * nội dung vừa bị xoá cho tới lần tải lại danh sách tiếp theo.
   */
  if (wasLastMessage && io) {
    await conversation.populate({
      path: "lastMessage.senderId",
      select: "displayName avatarUrl",
    });

    // Từng người một, kèm `viewerId` của chính họ: một payload dùng chung sẽ
    // null hoá `myRole` và xoá trắng `unreadCount` của mọi người nhận.
    (conversation.participants ?? []).forEach((p) => {
      const memberId = String(p.userId?._id ?? p.userId);

      io.to(userRoom(memberId)).emit(SERVER_EVENTS.CONVERSATION_UPDATED, {
        conversation: serializeConversation(conversation, { viewerId: memberId }),
      });
    });
  }

  return serializeMessage(message, { viewerId: actor._id });
}

/**
 * Bật/tắt một biểu cảm của người gọi trên một tin nhắn.
 *
 * Là TOGGLE chứ không phải hai endpoint add/remove: thao tác của người dùng là
 * bấm vào một chip, và một client không đồng bộ có thể tưởng mình chưa thả trong
 * khi đã thả rồi. Toggle luôn hội tụ về đúng một trạng thái; add/remove thì lệch.
 *
 * Dùng update operator nguyên tử thay vì load → sửa → save. Thả biểu cảm là thao
 * tác nhiều người bấm cùng lúc trên cùng một document, và vòng đọc-ghi sẽ nuốt
 * mất lượt của người khác: hai người thả cùng lúc, người lưu sau ghi đè bản đọc
 * cũ của mình và lượt của người kia biến mất.
 */
export async function toggleReaction({ messageId, actor, emoji }) {
  const { message, conversation } = await loadMessageForMutation(messageId, actor._id);

  if (message.deletedAt) {
    throw badRequest("MESSAGE_DELETED", "Không thể thả biểu cảm lên tin nhắn đã xoá");
  }

  const filter = { _id: message._id, deletedAt: null };

  /*
   * Thử gỡ trước. `modifiedCount` cho biết người này đã thả emoji đó hay chưa —
   * không cần đọc riêng một lượt, nên không có khoảng hở giữa kiểm tra và ghi.
   *
   * `timestamps: false` là BẮT BUỘC, không phải tối ưu. Schema bật `timestamps`,
   * nên Mongoose tự thêm `$set: {updatedAt}` vào mọi update — khiến
   * `modifiedCount` luôn là 1 kể cả khi `$pull` không khớp gì, và toggle không bao
   * giờ vào được nhánh thả. Tắt đi cũng đúng về mặt ngữ nghĩa: thả biểu cảm không
   * phải là sửa tin nhắn, nên không nên đụng vào `updatedAt`.
   */
  const pulled = await Message.updateOne(
    filter,
    { $pull: { reactions: { emoji, userId: actor._id } } },
    { timestamps: false },
  );

  const active = pulled.modifiedCount === 0;

  if (active) {
    const pushed = await Message.updateOne(
      {
        ...filter,
        // Trần được ép trong CHÍNH câu lệnh ghi, không phải bằng một lượt đọc
        // trước đó — nếu không, đủ nhiều lượt thả đồng thời vẫn vượt qua được.
        $expr: {
          $lt: [{ $size: { $ifNull: ["$reactions", []] } }, MAX_REACTIONS_PER_MESSAGE],
        },
      },
      { $push: { reactions: { emoji, userId: actor._id, createdAt: new Date() } } },
      // Cùng lý do: nếu không tắt, `modifiedCount` là 1 ngay cả khi guard `$expr`
      // chặn lượt thả, nên vượt trần sẽ trôi qua im lặng.
      { timestamps: false },
    );

    if (pushed.modifiedCount === 0) {
      throw badRequest("TOO_MANY_REACTIONS", "Tin nhắn này đã đạt giới hạn biểu cảm");
    }
  }

  const updated = await Message.findById(message._id).select("reactions").lean();

  /*
   * Payload phát đi KHÔNG mang `reactedByMe`.
   *
   * Đó là giá trị theo từng người xem, và một bản broadcast dùng chung sẽ gán cờ
   * của người vừa bấm cho tất cả mọi người trong room — đúng lỗi mà `deleteMessage`
   * phải phát từng người một để tránh. Ở đây rẻ hơn nhiều: gửi kèm `actorId` và
   * `active`, rồi client tự đặt cờ cho chính mình. Một lượt broadcast, không phải
   * N lượt.
   */
  const counts = countReactions(updated?.reactions ?? []);

  getIo()
    ?.to(conversationRoom(message.conversationId))
    .emit(SERVER_EVENTS.REACTION_UPDATED, {
      conversationId: String(message.conversationId),
      messageId: String(message._id),
      reactions: counts,
      actorId: String(actor._id),
      emoji,
      active,
    });

  return {
    conversationId: String(message.conversationId),
    messageId: String(message._id),
    // Người gọi thì biết chắc cờ của mình, nên trả kèm luôn cho đường HTTP.
    reactions: counts.map((group) => ({
      ...group,
      reactedByMe: group.emoji === emoji ? active : hasReacted(updated?.reactions, group.emoji, actor._id),
    })),
    active,
    conversationType: conversation.type,
  };
}

/** Gom `[{emoji, userId}]` thành `[{emoji, count}]`, giữ thứ tự thả đầu tiên. */
const countReactions = (reactions) => {
  const groups = new Map();

  for (const reaction of reactions) {
    groups.set(reaction.emoji, (groups.get(reaction.emoji) ?? 0) + 1);
  }

  return [...groups].map(([emoji, count]) => ({ emoji, count }));
};

const hasReacted = (reactions, emoji, userId) =>
  (reactions ?? []).some(
    (r) => r.emoji === emoji && String(r.userId) === String(userId),
  );

/**
 * Tìm hoặc tạo conversation 1-1 giữa hai người.
 * `$size: 2` là bắt buộc, nếu không sẽ khớp cả group có đúng hai người này.
 */
export async function findOrCreateDirectConversation(senderId, recipientId) {
  const existing = await Conversation.findOne({
    type: "direct",
    participants: { $size: 2 },
    "participants.userId": { $all: [senderId, recipientId] },
  });

  if (existing) return existing;

  return Conversation.create({
    type: "direct",
    participants: [
      { userId: senderId, joinedAt: new Date() },
      { userId: recipientId, joinedAt: new Date() },
    ],
    lastMessageAt: new Date(),
    unreadCounts: new Map(),
  });
}
