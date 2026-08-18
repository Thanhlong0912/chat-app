import type { Socket } from "socket.io-client";
import type { Conversation, Message } from "./chat";
import type { Friend, FriendRequest, User, UserPreferences } from "./user";
import type {
  ClientToServerEvents,
  PresenceStatus,
  SendMessageInput,
  ServerToClientEvents,
} from "./socket";

export interface AuthState {
  accessToken: string | null;
  user: User | null;
  loading: boolean;

  setAccessToken: (accessToken: string) => void;
  setUser: (user: User) => void;
  clearState: () => void;
  signUp: (
    username: string,
    password: string,
    email: string,
    firstName: string,
    lastName: string
  ) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  fetchMe: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface ThemeState {
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (dark: boolean) => void;
}

/** Trạng thái tải của một luồng tin nhắn. */
export type ThreadStatus = "idle" | "loading" | "loaded" | "error";

/**
 * Một luồng tin nhắn, chuẩn hoá.
 *
 * `ids` giữ thứ tự cũ → mới, `byId` giữ nội dung. Chuẩn hoá thay vì một mảng phẳng
 * vì mọi thao tác thực tế đều là tra theo id: đối chiếu tin nhắn lạc quan, sửa,
 * xoá, và chống trùng. Với mảng phẳng, tất cả đều là quét O(n) kèm splice bất biến
 * — và chính đó là nguồn của bug prepend hai lần và bug dupe-guard đọc dữ liệu cũ.
 */
export interface MessageThread {
  ids: string[];
  byId: Record<string, Message>;
  hasMore: boolean;
  nextCursor: string | null;
  status: ThreadStatus;
  error: string | null;
}

export interface PendingMessage {
  conversationId: string;
  status: "sending" | "failed";
  input: SendMessageInput;
}

export interface ChatState {
  conversationsById: Record<string, Conversation>;
  /** Thứ tự hiển thị, luôn được sắp theo `lastMessageAt` giảm dần. */
  conversationOrder: string[];
  messages: Record<string, MessageThread>;
  /** Tin nhắn lạc quan đang chờ xác nhận, khoá theo `clientMessageId`. */
  pending: Record<string, PendingMessage>;
  /** Nội dung đang soạn, giữ theo từng conversation. */
  drafts: Record<string, string>;
  /** Tin nhắn đang được trả lời, theo từng conversation. */
  replyingTo: Record<string, Message | undefined>;
  /** Tin nhắn đang được sửa, theo từng conversation. */
  editingId: Record<string, string | undefined>;
  activeConversationId: string | null;
  /** Chuỗi lọc danh sách cuộc trò chuyện ở sidebar. */
  searchQuery: string;
  convoLoading: boolean;
  creating: boolean;
  error: string | null;

  reset: () => void;
  setActiveConversation: (id: string | null) => void;
  setDraft: (conversationId: string, draft: string) => void;
  setSearchQuery: (query: string) => void;
  clearError: () => void;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId?: string) => Promise<void>;

  /** Gửi tin nhắn, hiển thị lạc quan ngay. */
  sendMessage: (input: SendMessageInput) => Promise<void>;
  /** Thay bản lạc quan bằng bản server đã xác nhận. */
  reconcilePending: (clientMessageId: string, saved: Message) => void;
  retryMessage: (clientMessageId: string) => Promise<void>;
  discardFailedMessage: (clientMessageId: string) => void;

  setReplyingTo: (conversationId: string, message: Message | undefined) => void;
  setEditingId: (conversationId: string, messageId: string | undefined) => void;

  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;

  /** Đồng bộ hoá: thêm hoặc thay tin nhắn đến từ socket/HTTP. */
  upsertMessage: (message: Message) => void;
  removeMessage: (conversationId: string, messageId: string) => void;

  upsertConversation: (conversation: Conversation) => void;
  updateConversation: (
    conversation: Partial<Conversation> & Pick<Conversation, "_id">
  ) => void;
  removeConversation: (conversationId: string) => void;

  applyUnreadCounts: (
    conversationId: string,
    unreadCounts: Record<string, number>
  ) => void;
  markAsSeen: (conversationId?: string) => Promise<void>;
  applyReadReceipt: (
    conversationId: string,
    userId: string,
    lastReadAt: string
  ) => void;

  createConversation: (
    type: "group" | "direct",
    name: string,
    memberIds: string[]
  ) => Promise<Conversation | null>;

  /** Ghép phần tin nhắn bị bỏ lỡ sau khi kết nối lại. */
  applySync: (
    conversationId: string,
    messages: Message[],
    truncated: boolean
  ) => void;
  /** Cursor mới nhất đang có của một conversation, để gửi cho `sync:since`. */
  newestCursor: (conversationId: string) => string | undefined;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface TypingEntry {
  displayName: string;
  expiresAt: number;
}

export interface SocketState {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  status: ConnectionStatus;
  presence: Record<string, { status: PresenceStatus; lastSeenAt: string | null }>;
  /** conversationId -> userId -> đang nhập */
  typingByConversation: Record<string, Record<string, TypingEntry>>;

  connectSocket: () => void;
  disconnectSocket: () => void;
  emitTyping: (conversationId: string, isTyping: boolean) => void;
  advanceRead: (conversationId: string, lastReadMessageId?: string) => void;
  /** Gửi qua socket; trả về false nếu socket không dùng được (client sẽ fallback HTTP). */
  sendMessage: (input: SendMessageInput) => Promise<Message | null>;
  setAway: (away: boolean) => void;
}

export interface FriendState {
  friends: Friend[];
  loading: boolean;
  receivedList: FriendRequest[];
  sentList: FriendRequest[];
  searchByUsername: (username: string) => Promise<User | null>;
  addFriend: (to: string, message?: string) => Promise<string>;
  getAllFriendRequests: () => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string) => Promise<void>;
  getFriends: () => Promise<void>;
}

export interface UserState {
  updateAvatarUrl: (formData: FormData) => Promise<void>;
  updateProfile: (payload: {
    displayName?: string;
    bio?: string | null;
    phone?: string | null;
    preferences?: UserPreferences;
  }) => Promise<User>;
}
