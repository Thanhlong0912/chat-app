export type ConversationType = "direct" | "group";

export type GroupRole = "owner" | "admin" | "member";

export type MessageKind = "text" | "image" | "file" | "system";

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
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationResponse {
  conversations: Conversation[];
}

export interface Attachment {
  url: string;
  mimeType?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
  kind: "image" | "video" | "file";
}

export interface ReplyToSnapshot {
  messageId: string;
  senderId: string | null;
  contentSnapshot: string | null;
  kindSnapshot: MessageKind | null;
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
