export type ConversationType = "direct" | "group";

export type GroupRole = "owner" | "admin" | "member";

export type MessageKind = "text" | "image" | "video" | "file" | "system";

export interface Participant {
  _id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  joinedAt: string | null;
  role: GroupRole | null;
  /** Con trỏ "đã đọc tới đâu" — nguồn dữ liệu cho read receipt từng tin nhắn. */
  lastReadAt: string | null;
}

export interface Group {
  name: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  createdBy: string | null;
}

export interface MessageSender {
  _id: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface LastMessage {
  _id: string | null;
  content: string | null;
  createdAt: string | null;
  sender: MessageSender | null;
}

export interface Conversation {
  _id: string;
  type: ConversationType;
  group: Group | null;
  participants: Participant[];
  lastMessage: LastMessage | null;
  lastMessageAt: string | null;
  unreadCounts: Record<string, number>;
  /** Số chưa đọc của chính người đang xem, do server tính. */
  unreadCount: number;
  myRole: GroupRole | null;
  /** @deprecated thay bằng `participants[].lastReadAt` */
  seenBy: string[];
  /** Riêng của người đang xem — không phải trạng thái của cả cuộc trò chuyện. */
  pinned: boolean;
  archived: boolean;
  /** Do server lọc: mốc đã qua trả về `null`, client không tự so sánh đồng hồ. */
  mutedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationResponse {
  conversations: Conversation[];
}

export interface Attachment {
  url: string;
  /** Cloudinary public_id — server cần nó để xoá được tệp khi xoá tin nhắn. */
  publicId?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  /** Giây, chỉ video mới có. */
  duration?: number | null;
  originalName?: string | null;
  kind: "image" | "video" | "file";
}

export interface ReplyToSnapshot {
  messageId: string;
  senderId: string | null;
  contentSnapshot: string | null;
  kindSnapshot: MessageKind | null;
}

/** Bộ biểu cảm cố định, khớp `REACTION_EMOJIS` ở backend. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * Biểu cảm đã được server gom theo emoji.
 *
 * `reactedByMe` chỉ có trong response HTTP và trong state của client — bản
 * broadcast qua socket cố tình bỏ nó, vì đó là giá trị theo từng người xem và một
 * payload dùng chung sẽ gán cờ của người vừa bấm cho cả room.
 */
export interface ReactionGroup {
  emoji: ReactionEmoji;
  count: number;
  reactedByMe: boolean;
}

export interface SystemEvent {
  type: string;
  actorId: string | null;
  targetIds: string[];
  meta?: unknown;
}

/**
 * Trạng thái gửi, chỉ tồn tại phía client.
 *
 * `undefined` nghĩa là tin nhắn đã được server xác nhận. `sending` là tin nhắn lạc
 * quan đang chờ ack; `failed` là gửi không thành công và người dùng có thể thử lại.
 */
export type MessageStatus = "sending" | "failed";

export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  sender: MessageSender | null;
  kind: MessageKind;
  content: string | null;
  attachments: Attachment[];
  /** Tin nhắn đã xoá luôn là mảng rỗng — server không trả biểu cảm của bia mộ. */
  reactions: ReactionGroup[];
  replyTo: ReplyToSnapshot | null;
  systemEvent?: SystemEvent | null;
  createdAt: string;
  updatedAt?: string | null;
  editedAt: string | null;
  deleted: boolean;
  clientMessageId: string | null;
  isOwn?: boolean;
  /** Chỉ có ở tin nhắn lạc quan chưa được server xác nhận. */
  status?: MessageStatus;
}
