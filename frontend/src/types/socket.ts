import type { Conversation, Message } from "./chat";

/**
 * Hợp đồng socket, bản song ánh của `backend/src/socket/events.js`.
 *
 * Hai file được giữ đồng bộ bằng `src/types/socket.contract.test.ts`: test đó đọc
 * file backend dưới dạng text, rút tên event ra và so khớp với các mảng runtime ở
 * dưới. Nhờ vậy không cần một package dùng chung (vốn đòi build step ở cả hai bên
 * và Render phải deploy kèm thư mục ngang cấp), mà CI vẫn đỏ ngay khi một bên đổi
 * tên event.
 */

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export type PresenceStatus = "online" | "away" | "offline";

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
}

export interface PresenceUpdatePayload {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

export interface ConnectionReadyPayload {
  conversationIds: string[];
}

/** `lastMessage` trong payload realtime chưa được populate người gửi. */
export interface MessageNewPayload {
  message: Message;
  conversation: {
    _id: string;
    lastMessage: {
      _id: string | null;
      content: string | null;
      senderId: string | null;
      createdAt: string | null;
    } | null;
    lastMessageAt: string | null;
  };
  unreadCounts: Record<string, number>;
}

export interface MessageDeletedPayload {
  conversationId: string;
  messageId: string;
  deletedAt: string;
}

export interface ReadUpdatedPayload {
  conversationId: string;
  userId: string;
  lastReadAt: string;
  unreadCounts?: Record<string, number>;
}

export interface TypingUpdatePayload {
  conversationId: string;
  userId: string;
  displayName: string;
  isTyping: boolean;
}

export interface ConversationRemovedPayload {
  conversationId: string;
  reason: "left" | "removed" | "deleted";
}

/** Kết quả ack dùng chung. Handler socket trả về mã lỗi thay vì HTTP status. */
export type Ack<T = unknown> = ({ ok: true } & T) | { ok: false; code: string };

export interface SendMessageInput {
  conversationId: string;
  content?: string;
  clientMessageId?: string;
  replyToMessageId?: string;
  imgUrl?: string;
}

export interface SyncCursor {
  conversationId: string;
  cursor?: string;
}

export interface SyncedConversation {
  conversationId: string;
  messages?: Message[];
  truncated?: boolean;
  nextCursor?: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  "connection:ready": (payload: ConnectionReadyPayload) => void;
  "message:new": (payload: MessageNewPayload) => void;
  "message:updated": (payload: { message: Message }) => void;
  "message:deleted": (payload: MessageDeletedPayload) => void;
  "conversation:created": (payload: { conversation: Conversation }) => void;
  "conversation:updated": (payload: { conversation: Conversation }) => void;
  "conversation:removed": (payload: ConversationRemovedPayload) => void;
  "read:updated": (payload: ReadUpdatedPayload) => void;
  "typing:update": (payload: TypingUpdatePayload) => void;
  "presence:snapshot": (payload: { users: PresenceEntry[] }) => void;
  "presence:update": (payload: PresenceUpdatePayload) => void;
  "auth:reauth": (payload: Record<string, never>) => void;
}

export interface ClientToServerEvents {
  "conversation:subscribe": (
    payload: { conversationId: string },
    ack?: (res: Ack) => void,
  ) => void;
  "conversation:unsubscribe": (payload: { conversationId: string }) => void;
  "message:send": (
    payload: SendMessageInput,
    ack?: (res: Ack<{ message: Message; duplicate: boolean }>) => void,
  ) => void;
  "message:edit": (
    payload: { messageId: string; content: string },
    ack?: (res: Ack<{ message: Message }>) => void,
  ) => void;
  "message:delete": (payload: { messageId: string }, ack?: (res: Ack) => void) => void;
  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;
  "read:advance": (
    payload: { conversationId: string; lastReadMessageId?: string },
    ack?: (res: Ack<{ lastReadAt: string; unreadCount: number }>) => void,
  ) => void;
  "presence:away": (payload: { away: boolean }) => void;
  "presence:heartbeat": () => void;
  "sync:since": (
    payload: { cursors: SyncCursor[] },
    ack?: (res: Ack<{ conversations: SyncedConversation[] }>) => void,
  ) => void;
  "auth:token": (payload: { token: string }, ack?: (res: Ack) => void) => void;
}

// ---------------------------------------------------------------------------
// Bản runtime, để contract test so khớp được với backend
// ---------------------------------------------------------------------------

export const SERVER_EVENT_NAMES = [
  "connection:ready",
  "message:new",
  "message:updated",
  "message:deleted",
  "conversation:created",
  "conversation:updated",
  "conversation:removed",
  "read:updated",
  "typing:update",
  "presence:snapshot",
  "presence:update",
  "auth:reauth",
] as const satisfies readonly (keyof ServerToClientEvents)[];

export const CLIENT_EVENT_NAMES = [
  "conversation:subscribe",
  "conversation:unsubscribe",
  "message:send",
  "message:edit",
  "message:delete",
  "typing:start",
  "typing:stop",
  "read:advance",
  "presence:away",
  "presence:heartbeat",
  "sync:since",
  "auth:token",
] as const satisfies readonly (keyof ClientToServerEvents)[];

/** Tên cũ, còn được phát song song đúng một release rồi bỏ ở Phase 9. */
export const LEGACY_EVENT_NAMES = [
  "join-conversation",
  "new-message",
  "read-message",
  "new-group",
  "online-users",
] as const;
