import { getRole } from "../domain/groupPermissions.js";

/**
 * Chuyển Conversation document thành hình dạng gửi ra ngoài.
 *
 * Thay cho hai khối map gần như giống nhau từng chữ trước đây nằm trong
 * `createConversation` và `getConversations` — và đã trôi khỏi nhau, khiến
 * `unreadCounts` đúng ở một chỗ và mất ở chỗ kia.
 */

/** Mongoose Map → object thuần. */
const mapToObject = (value) => {
  if (!value) return {};
  // Map (cả native lẫn Mongoose) không serialize được bằng JSON.stringify:
  // `{...doc.toObject()}` để lại một Map và JSON biến nó thành `{}`.
  if (typeof value.entries === "function") return Object.fromEntries(value.entries());
  return { ...value };
};

/** Đọc một khoá trong Mongoose Map. Truy cập bằng `[]` trả về undefined. */
const readCount = (counts, userId) => {
  if (!counts) return 0;
  if (typeof counts.get === "function") return counts.get(String(userId)) ?? 0;
  return counts[String(userId)] ?? 0;
};

/**
 * `mutedUntil` của chính người đang xem, đã bỏ qua mốc đã hết hạn.
 *
 * Lọc hết hạn ở ĐÂY chứ không để client tự so sánh: đồng hồ máy client có thể sai
 * lệch hàng giờ, và một chiếc máy chạy sớm sẽ tự bật lại thông báo mà người dùng
 * vẫn tưởng đang tắt. Server là nguồn thời gian duy nhất.
 */
const readMutedUntil = (plain, viewerId) => {
  const participant = (plain.participants ?? []).find(
    (p) => String(p.userId?._id ?? p.userId) === String(viewerId),
  );

  const until = participant?.mutedUntil;
  if (!until) return null;

  return new Date(until).getTime() > Date.now() ? until : null;
};

const shapeParticipant = (p) => {
  const user = p.userId;
  const populated = user && typeof user === "object" && user.displayName !== undefined;

  return {
    _id: String(populated ? user._id : user),
    displayName: populated ? user.displayName : null,
    avatarUrl: populated ? (user.avatarUrl ?? null) : null,
    joinedAt: p.joinedAt ?? null,
    role: p.role ?? null,
    lastReadAt: p.lastReadAt ?? null,
  };
};

const shapeLastMessage = (lastMessage) => {
  if (!lastMessage) return null;

  const sender = lastMessage.senderId;
  const populated = sender && typeof sender === "object" && sender.displayName !== undefined;

  return {
    _id: lastMessage._id ? String(lastMessage._id) : null,
    content: lastMessage.content ?? null,
    createdAt: lastMessage.createdAt ?? null,
    sender: sender
      ? {
          _id: String(populated ? sender._id : sender),
          displayName: populated ? sender.displayName : null,
          avatarUrl: populated ? (sender.avatarUrl ?? null) : null,
        }
      : null,
  };
};

export function serializeConversation(doc, { viewerId } = {}) {
  if (!doc) return null;

  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;

  return {
    _id: String(plain._id),
    type: plain.type,
    participants: (plain.participants ?? []).map(shapeParticipant),
    group: plain.group
      ? {
          name: plain.group.name ?? null,
          description: plain.group.description ?? null,
          avatarUrl: plain.group.avatarUrl ?? null,
          createdBy: plain.group.createdBy ? String(plain.group.createdBy) : null,
        }
      : null,
    lastMessage: shapeLastMessage(plain.lastMessage),
    lastMessageAt: plain.lastMessageAt ?? null,
    unreadCounts: mapToObject(plain.unreadCounts),
    // Giá trị vô hướng cho người đang xem, để client không phải tự tra Map bằng
    // chính id của mình (và nhận undefined dưới một kiểu khai báo là number).
    unreadCount: viewerId ? readCount(plain.unreadCounts, viewerId) : 0,
    myRole: viewerId ? getRole(plain, viewerId) : null,
    // @deprecated — thay bằng participant.lastReadAt. Còn ghi thêm một release.
    seenBy: (plain.seenBy ?? []).map((u) => String(u?._id ?? u)),
    /*
     * Ghim / lưu trữ / tắt thông báo đều là trạng thái THEO TỪNG NGƯỜI, nên chúng
     * được rút gọn thành boolean cho đúng người đang xem thay vì trả cả mảng id.
     * Trả mảng sẽ để lộ ai đã ghim hay lưu trữ cuộc trò chuyện — thông tin riêng
     * tư của người khác mà client không có lý do gì để biết.
     */
    pinned: viewerId ? (plain.pinnedBy ?? []).some((id) => String(id) === String(viewerId)) : false,
    archived: viewerId
      ? (plain.archivedBy ?? []).some((id) => String(id) === String(viewerId))
      : false,
    mutedUntil: viewerId ? readMutedUntil(plain, viewerId) : null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

export const serializeConversations = (docs, options) =>
  (docs ?? []).map((doc) => serializeConversation(doc, options));

export default serializeConversation;
