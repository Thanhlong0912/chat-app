import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { getIo } from "../socket/io.js";
import {
  LEGACY_EVENTS,
  SERVER_EVENTS,
  conversationRoom,
  userRoom,
} from "../socket/events.js";
import { ROLES } from "../domain/groupPermissions.js";
import { announcePresenceAmong } from "../socket/handlers/presence.js";
import { MAX_GROUP_MEMBERS } from "../services/groupService.js";
import { decodeCursor, encodeCursor, newerThan, olderThan } from "../utils/cursor.js";
import { advanceRead } from "../services/readReceiptService.js";
import { updateConversationSettings } from "../services/conversationSettingsService.js";
import { serializeMessages } from "../serializers/message.js";
import {
  serializeConversation,
  serializeConversations,
} from "../serializers/conversation.js";
import { badRequest } from "../utils/errors.js";

/**
 * Ghim / lưu trữ / tắt thông báo cho chính người gọi.
 *
 * `req.conversation` do `requireMembership` gắn vào, nên tới đây đã chắc chắn
 * người gọi là thành viên — không ai ghim được cuộc trò chuyện họ không tham gia.
 */
export const patchConversationSettings = async (req, res) => {
  const conversation = await updateConversationSettings({
    conversation: req.conversation,
    userId: req.user._id,
    pinned: req.body.pinned,
    archived: req.body.archived,
    muteMinutes: req.body.muteMinutes,
  });

  return res.status(200).json({ conversation });
};

export const createConversation = async (req, res) => {
  const { type, name } = req.body;
  const userId = req.user._id;

  // Đã qua validate(createConversationSchema): type hợp lệ, memberIds là mảng
  // ObjectId đã dedupe, nhóm có tên, direct có đúng một người nhận.
  // Loại chính mình ra: có mình trong memberIds sẽ tạo participant trùng.
  const memberIds = req.body.memberIds.filter((id) => String(id) !== String(userId));

  if (memberIds.length === 0) {
    throw badRequest("NO_OTHER_MEMBERS", "Cần ít nhất một người khác trong cuộc trò chuyện");
  }

  if (memberIds.length + 1 > MAX_GROUP_MEMBERS) {
    throw badRequest("GROUP_FULL", `Nhóm chỉ có tối đa ${MAX_GROUP_MEMBERS} thành viên`);
  }

  let conversation;

  if (type === "direct") {
    const participantId = memberIds[0];

    // `$size: 2` là bắt buộc: không có nó, `$all` sẽ khớp cả một group có chứa
    // đúng hai người này, và tin nhắn 1-1 sẽ chạy vào group đó.
    conversation = await Conversation.findOne({
      type: "direct",
      participants: { $size: 2 },
      "participants.userId": { $all: [userId, participantId] },
    });

    if (!conversation) {
      conversation = new Conversation({
        type: "direct",
        participants: [{ userId }, { userId: participantId }],
        lastMessageAt: new Date(),
      });

      await conversation.save();
    }
  }

  if (type === "group") {
    conversation = new Conversation({
      type: "group",
      participants: [
        { userId, role: ROLES.OWNER },
        ...memberIds.map((id) => ({ userId: id, role: ROLES.MEMBER })),
      ],
      group: { name, createdBy: userId },
      lastMessageAt: new Date(),
    });

    await conversation.save();
  }

  if (!conversation) {
    throw badRequest("INVALID_CONVERSATION_TYPE", "Conversation type không hợp lệ");
  }

  await conversation.populate([
    { path: "participants.userId", select: "displayName avatarUrl" },
    { path: "lastMessage.senderId", select: "displayName avatarUrl" },
  ]);

  // Qua serializer nên `unreadCounts` không còn bị mất: spread của `toObject()`
  // để lại một Map thuần và JSON.stringify biến Map thành `{}`.
  const formatted = serializeConversation(conversation, { viewerId: userId });

  const io = getIo();
  const room = conversationRoom(conversation._id);

  /*
   * Gửi cho TẤT CẢ thành viên, kể cả người tạo.
   *
   * Bản cũ truyền thẳng `userId` (một ObjectId) vào `io.to()`, trong khi room được
   * đặt tên bằng `user._id.toString()` — hai giá trị này không bằng nhau với
   * socket.io, nên người tạo không bao giờ nhận được event về conversation vừa tạo,
   * và với nhóm thì cũng chỉ có người khác nhận được.
   */
  const everyone = [String(userId), ...memberIds.map(String)];

  everyone.forEach((memberId) => {
    // Cho socket của họ vào room ngay, nếu không phải chờ tải lại trang mới nhận
    // được tin nhắn realtime của conversation này.
    io?.in(userRoom(memberId)).socketsJoin(room);

    io?.to(userRoom(memberId)).emit(SERVER_EVENTS.CONVERSATION_CREATED, {
      conversation: serializeConversation(conversation, { viewerId: memberId }),
    });

    // Alias tương thích cho bundle frontend đang mở tab; bỏ ở Phase 9.
    io?.to(userRoom(memberId)).emit(LEGACY_EVENTS.NEW_GROUP, formatted);
  });

  /*
   * Một conversation mới cũng làm audience thay đổi.
   *
   * Audience = bạn bè ∪ thành viên các conversation chung, và tập đó được cache 5
   * phút. Không xoá cache ở đây thì dấu online trong cuộc trò chuyện vừa mở ra
   * đứng im màu xám cho tới khi cache hết hạn.
   */
  await announcePresenceAmong(everyone);

  return res.status(201).json({ conversation: formatted });
};

export const getConversations = async (req, res) => {
  const userId = req.user._id;

  const conversations = await Conversation.find({ "participants.userId": userId })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .populate({ path: "participants.userId", select: "displayName avatarUrl" })
    .populate({ path: "lastMessage.senderId", select: "displayName avatarUrl" });

  return res.status(200).json({
    conversations: serializeConversations(conversations, { viewerId: userId }),
  });
};

const SENDER_FIELDS = "displayName avatarUrl";

/**
 * Một trang tin nhắn, lùi dần về quá khứ.
 *
 * Dùng cursor keyset trên `(createdAt, _id)`. Bản trước chỉ dùng `createdAt` và
 * lấy cursor từ phần tử đã bị `pop()`, rồi query `createdAt < cursor` — nên chính
 * phần tử đó bị loại và MỘT tin nhắn bị mất ở mỗi ranh giới trang, trong mọi
 * conversation dài hơn một trang. Ở đây cursor lấy từ phần tử CUỐI CÙNG ĐƯỢC GIỮ,
 * nên phần tử kế tiếp mở đầu trang sau.
 */
export const getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const { limit, cursor } = req.query;

  const query = { conversationId };
  const decoded = decodeCursor(cursor);

  if (decoded) {
    Object.assign(query, olderThan(decoded));
  }

  const docs = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate({ path: "senderId", select: SENDER_FIELDS });

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

  return res.status(200).json({
    // Trả về theo thứ tự cũ → mới cho client render.
    messages: serializeMessages([...page].reverse(), { viewerId: req.user._id }),
    nextCursor,
  });
};

/**
 * Các tin nhắn MỚI HƠN một cursor.
 *
 * Nguyên thuỷ để đồng bộ lại sau khi mất kết nối: client mất mọi tin nhắn gửi
 * trong lúc socket đứt, và phân trang lùi không giúp gì cho việc đó.
 *
 * `truncated` báo rằng khoảng trống lớn hơn một lần trả về, khi đó client nên bỏ
 * cache của conversation và tải lại từ đầu thay vì cố ghép một khoảng thiếu.
 */
const SINCE_LIMIT = 200;

export const getMessagesSince = async (req, res) => {
  const { conversationId } = req.params;
  const { after } = req.query;

  const decoded = decodeCursor(after);

  const query = { conversationId };
  if (decoded) {
    Object.assign(query, newerThan(decoded));
  }

  const docs = await Message.find(query)
    .sort({ createdAt: 1, _id: 1 })
    .limit(SINCE_LIMIT + 1)
    .populate({ path: "senderId", select: SENDER_FIELDS });

  const truncated = docs.length > SINCE_LIMIT;
  const page = truncated ? docs.slice(0, SINCE_LIMIT) : docs;

  return res.status(200).json({
    messages: serializeMessages(page, { viewerId: req.user._id }),
    truncated,
    // Cursor để tiếp tục nếu bị cắt.
    nextCursor: page.length ? encodeCursor(page[page.length - 1]) : null,
  });
};

/**
 * Đánh dấu đã đọc tới một tin nhắn (mặc định là tin cuối).
 *
 * Giữ nguyên tên route `/seen` để client hiện tại không hỏng, nhưng bên dưới nay
 * là con trỏ `lastReadAt` của participant thay vì mảng `seenBy` toàn cục.
 */
export const markAsSeen = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  // requireMembership đã load và xác minh quyền, nên không cần query lại.
  const conversation = req.conversation;

  const { lastReadAt, unreadCount, advanced } = await advanceRead({
    conversation,
    userId,
    lastReadMessageId: req.body?.lastReadMessageId,
  });

  // Chỉ phát event khi con trỏ thực sự tiến — nếu không, mỗi lần mở lại
  // conversation sẽ phát tán một event vô nghĩa cho cả room.
  if (advanced) {
    const fresh = await Conversation.findById(conversationId).populate({
      path: "lastMessage.senderId",
      select: "displayName avatarUrl",
    });

    const payload = {
      conversationId: String(conversationId),
      userId: String(userId),
      lastReadAt,
      unreadCounts: Object.fromEntries(fresh?.unreadCounts ?? []),
    };

    const io = getIo();
    io?.to(String(conversationId)).emit("read:updated", payload);
    // Alias tương thích cho bundle cũ đang mở tab; bỏ ở Phase 9.
    io?.to(String(conversationId)).emit("read-message", {
      conversation: serializeConversation(fresh, { viewerId: userId }),
      lastMessage: serializeConversation(fresh, { viewerId: userId })?.lastMessage,
    });
  }

  return res.status(200).json({
    message: "Marked as seen",
    lastReadAt,
    myUnreadCount: unreadCount,
  });
};
