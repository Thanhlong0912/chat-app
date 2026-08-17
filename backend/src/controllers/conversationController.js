import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { getIo } from "../socket/io.js";
import { ROLES } from "../domain/groupPermissions.js";
import { decodeCursor, encodeCursor, newerThan, olderThan } from "../utils/cursor.js";
import { advanceRead } from "../services/readReceiptService.js";
import { serializeMessages } from "../serializers/message.js";
import {
  serializeConversation,
  serializeConversations,
} from "../serializers/conversation.js";
import { badRequest } from "../utils/errors.js";

export const createConversation = async (req, res) => {
  const { type, name, memberIds } = req.body;
  const userId = req.user._id;

  if (
    !type ||
    (type === "group" && !name) ||
    !memberIds ||
    !Array.isArray(memberIds) ||
    memberIds.length === 0
  ) {
    throw badRequest("INVALID_CONVERSATION", "Tên nhóm và danh sách thành viên là bắt buộc");
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
    // FIXME(Phase 6): chưa validate memberIds là ObjectId hợp lệ, chưa dedupe,
    // chưa loại chính mình, chưa giới hạn số thành viên.
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

  if (type === "group") {
    memberIds.forEach((memberId) => {
      io?.to(memberId).emit("new-group", formatted);
    });
  }

  if (type === "direct") {
    // FIXME(Phase 6): `userId` là ObjectId còn room được tạo từ `_id.toString()`,
    // nên người tạo không bao giờ nhận được event này.
    io?.to(userId).emit("new-group", formatted);
    io?.to(memberIds[0]).emit("new-group", formatted);
  }

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
