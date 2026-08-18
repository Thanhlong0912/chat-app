import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { io, type Socket } from "socket.io-client";
import type { SocketState } from "@/types/store";
import type {
  ClientToServerEvents,
  SendMessageInput,
  ServerToClientEvents,
} from "@/types/socket";
import type { Message } from "@/types/chat";
import { toast } from "sonner";
import { notify } from "@/lib/notifications";
import { useAuthStore } from "./useAuthStore";
import { useChatStore } from "./useChatStore";

const baseURL = import.meta.env.VITE_SOCKET_URL;

/** Client tự hết hạn chỉ báo đang nhập, vì event hết hạn của server có thể bị mất. */
const TYPING_TTL_MS = 6000;

/** Nhịp heartbeat, khớp với phía server. */
const HEARTBEAT_MS = 60_000;

/** Ack quá lâu thì coi như thất bại, để UI không treo ở trạng thái "đang gửi". */
const ACK_TIMEOUT_MS = 8000;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let typingSweeper: ReturnType<typeof setInterval> | null = null;
/** Đã từng kết nối thành công chưa — dùng để biết khi nào cần đồng bộ lại. */
let hasConnectedBefore = false;

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  status: "idle",
  presence: {},
  typingByConversation: {},

  connectSocket: () => {
    const existing = get().socket;

    /*
     * `existing.active` chứ không phải chỉ `existing`.
     *
     * `active` đúng khi socket đang kết nối HOẶC đang thử kết nối lại, và sai khi
     * nó đã chết hẳn. Bản trước kiểm tra `if (existingSocket) return`, nên một
     * socket đã chết vẫn bị coi là còn sống và không bao giờ được tạo lại — đây là
     * một nửa của lý do realtime chết vĩnh viễn.
     */
    if (existing?.active) return;

    // Socket cũ đã chết thì dọn hẳn trước khi tạo mới.
    if (existing) existing.close();

    set({ status: "connecting" });

    const socket: AppSocket = io(baseURL, {
      /*
       * `auth` là HÀM, không phải giá trị.
       *
       * socket.io gọi lại hàm này ở MỖI lần thử kết nối lại, nên token mới nhất
       * luôn được dùng. Bản trước chụp giá trị token một lần vào object; sau khi
       * access token hết hạn (30 phút), mọi lần kết nối lại đều trình ra đúng cái
       * token đã hết hạn đó và bị từ chối mãi mãi. Đây là nguyên nhân chính của
       * việc realtime chết và chỉ hồi phục sau khi tải lại trang.
       */
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken ?? "" }),
      // Cho phép polling: một số proxy chặn WebSocket.
      transports: ["websocket", "polling"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    set({ socket });

    registerListeners(socket, set, get);
    startTimers(socket, get);
  },

  disconnectSocket: () => {
    const socket = get().socket;

    stopTimers();
    hasConnectedBefore = false;

    if (socket) socket.close();

    set({ socket: null, status: "idle", presence: {}, typingByConversation: {} });
  },

  emitTyping: (conversationId, isTyping) => {
    const socket = get().socket;
    if (!socket?.connected) return;

    socket.emit(isTyping ? "typing:start" : "typing:stop", { conversationId });
  },

  advanceRead: (conversationId, lastReadMessageId) => {
    const socket = get().socket;
    if (!socket?.connected) return;

    socket.emit("read:advance", { conversationId, lastReadMessageId });
  },

  sendMessage: async (input: SendMessageInput): Promise<Message | null> => {
    const socket = get().socket;

    // Không kết nối được thì trả null để store gọi sang HTTP.
    if (!socket?.connected) return null;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Gửi tin nhắn quá lâu không có phản hồi")),
        ACK_TIMEOUT_MS,
      );

      socket.emit("message:send", input, (res) => {
        clearTimeout(timer);

        if (res.ok) {
          resolve(res.message);
        } else {
          reject(new Error(`Không gửi được tin nhắn (${res.code})`));
        }
      });
    });
  },

  setAway: (away) => {
    const socket = get().socket;
    if (!socket?.connected) return;

    socket.emit("presence:away", { away });
  },
}));

// ---------------------------------------------------------------------------

type Setter = (partial: Partial<SocketState> | ((s: SocketState) => Partial<SocketState>)) => void;
type Getter = () => SocketState;

function registerListeners(socket: AppSocket, set: Setter, get: Getter) {
  socket.on("connect", () => {
    set({ status: "connected" });

    // Chỉ đồng bộ lại từ lần kết nối THỨ HAI trở đi: lần đầu đã có fetch bình thường.
    if (hasConnectedBefore) {
      void resync();
    }

    hasConnectedBefore = true;
  });

  socket.io.on("reconnect_attempt", () => set({ status: "reconnecting" }));

  socket.on("disconnect", (reason) => {
    // `io client disconnect` là do ta chủ động ngắt, không phải sự cố.
    set({ status: reason === "io client disconnect" ? "idle" : "reconnecting" });
  });

  socket.on("connect_error", async (error) => {
    const code = (error as Error & { data?: { code?: string } }).data?.code;

    /*
     * Token hết hạn thì làm mới rồi thử lại, thay vì bỏ cuộc.
     *
     * Bản trước không có handler này, nên khi token hết hạn socket cứ thử kết nối
     * lại với token cũ và thất bại mãi, không có đường nào tự phục hồi.
     */
    if (code === "TOKEN_EXPIRED" || code === "TOKEN_INVALID") {
      try {
        await useAuthStore.getState().refresh();
        // `auth` là hàm nên lần thử tiếp theo tự lấy token mới.
        socket.connect();
        return;
      } catch {
        set({ status: "error" });
        return;
      }
    }

    set({ status: get().status === "connected" ? "reconnecting" : "error" });
  });

  // Server xin token mới trước khi token hiện tại hết hạn.
  socket.on("auth:reauth", async () => {
    try {
      await useAuthStore.getState().refresh();
    } catch {
      // Không làm mới được thì cứ gửi token đang có; server sẽ tự ngắt nếu sai.
    }

    socket.emit("auth:token", { token: useAuthStore.getState().accessToken ?? "" });
  });

  // --- Presence ---

  socket.on("presence:snapshot", ({ users }) => {
    const presence: SocketState["presence"] = {};
    users.forEach((u) => {
      presence[u.userId] = { status: u.status, lastSeenAt: null };
    });
    set({ presence });
  });

  socket.on("presence:update", ({ userId, status, lastSeenAt }) => {
    set((state) => ({
      presence: { ...state.presence, [userId]: { status, lastSeenAt } },
    }));
  });

  // --- Tin nhắn ---

  socket.on("message:new", ({ message, conversation, unreadCounts }) => {
    const chat = useChatStore.getState();

    chat.upsertMessage(message);

    chat.updateConversation({
      _id: conversation._id,
      lastMessage: conversation.lastMessage
        ? {
            _id: conversation.lastMessage._id,
            content: conversation.lastMessage.content,
            createdAt: conversation.lastMessage.createdAt,
            // Server đã populate người gửi trong `message`, nên preview ở sidebar
            // có tên thật — bản trước phải bịa `displayName: ""`.
            sender: message.sender,
          }
        : null,
      lastMessageAt: conversation.lastMessageAt,
    });

    chat.applyUnreadCounts(conversation._id, unreadCounts);

    /*
     * Cố tình KHÔNG gọi markAsSeen ở đây.
     *
     * Bản trước gọi nó ngay trong handler này, và gọi TRƯỚC khi cập nhật
     * unreadCounts — nên nó đọc số chưa đọc cũ (0), thoát sớm, rồi số mới mới được
     * ghi vào: badge đứng lại ở trạng thái sai. Việc đánh dấu đã đọc nay thuộc về
     * observer hiển thị của danh sách tin nhắn, nơi biết chắc người dùng đang thực
     * sự nhìn vào đó.
     */

    notifyIncoming(message, conversation._id);
  });

  socket.on("message:updated", ({ message }) => {
    useChatStore.getState().upsertMessage(message);
  });

  socket.on("message:deleted", ({ conversationId, messageId }) => {
    useChatStore.getState().removeMessage(conversationId, messageId);
  });

  // --- Conversation ---

  socket.on("conversation:created", ({ conversation }) => {
    useChatStore.getState().upsertConversation(conversation);
    socket.emit("conversation:subscribe", { conversationId: conversation._id });
  });

  socket.on("conversation:updated", ({ conversation }) => {
    useChatStore.getState().upsertConversation(conversation);
  });

  socket.on("conversation:removed", ({ conversationId }) => {
    useChatStore.getState().removeConversation(conversationId);
  });

  // --- Read receipt ---

  socket.on("read:updated", ({ conversationId, userId, lastReadAt, unreadCounts }) => {
    const chat = useChatStore.getState();

    chat.applyReadReceipt(conversationId, userId, lastReadAt);
    if (unreadCounts) chat.applyUnreadCounts(conversationId, unreadCounts);
  });

  // --- Typing ---

  socket.on("typing:update", ({ conversationId, userId, displayName, isTyping }) => {
    set((state) => {
      const forConversation = { ...(state.typingByConversation[conversationId] ?? {}) };

      if (isTyping) {
        forConversation[userId] = { displayName, expiresAt: Date.now() + TYPING_TTL_MS };
      } else {
        delete forConversation[userId];
      }

      return {
        typingByConversation: {
          ...state.typingByConversation,
          [conversationId]: forConversation,
        },
      };
    });
  });

  // --- Tương thích với tên event cũ ---
  // Server còn phát song song một release. Chỉ nghe `online-users` để không mất
  // dấu online nếu server chưa kịp deploy bản mới.
  socket.on("online-users" as keyof ServerToClientEvents, ((userIds: string[]) => {
    if (!Array.isArray(userIds)) return;
    if (Object.keys(get().presence).length > 0) return; // đã có dữ liệu mới, bỏ qua

    const presence: SocketState["presence"] = {};
    userIds.forEach((id) => {
      presence[id] = { status: "online", lastSeenAt: null };
    });
    set({ presence });
  }) as never);
}

/**
 * Thông báo cho một tin nhắn đến.
 *
 * Ba tầng, và chỉ một tầng chạy:
 *  1. Tin nhắn của chính mình, hoặc đang mở đúng cuộc trò chuyện đó VÀ tab đang
 *     hiển thị → không thông báo gì. Đây là yêu cầu "không thông báo trùng khi
 *     conversation đang mở".
 *  2. Tab bị ẩn → thông báo trình duyệt (nếu người dùng đã bật).
 *  3. Còn lại → toast trong ứng dụng, bấm vào thì mở cuộc trò chuyện.
 */
function notifyIncoming(message: Message, conversationId: string) {
  const chat = useChatStore.getState();
  const me = useAuthStore.getState().user;

  if (!me || message.senderId === me._id) return;

  const isActive = chat.activeConversationId === conversationId;
  const isVisible = document.visibilityState === "visible";

  if (isActive && isVisible) return;

  const preferences = me.preferences;
  const conversation = chat.conversationsById[conversationId];

  const title =
    conversation?.type === "group"
      ? (conversation.group?.name ?? "Nhóm chat")
      : (message.sender?.displayName ?? "Tin nhắn mới");

  const body =
    conversation?.type === "group" && message.sender?.displayName
      ? `${message.sender.displayName}: ${message.content ?? "Đã gửi một ảnh"}`
      : (message.content ?? "Đã gửi một ảnh");

  const open = () => {
    useChatStore.getState().setActiveConversation(conversationId);
  };

  if (!isVisible && preferences?.browserNotifications !== false) {
    const shown = notify({ title, body, conversationId, onClick: open });
    if (shown) return;
  }

  if (preferences?.inAppNotifications === false) return;

  toast(title, {
    description: body,
    action: { label: "Mở", onClick: open },
  });
}

/** Lấy lại phần tin nhắn bị bỏ lỡ trong lúc mất kết nối. */
async function resync() {
  const chat = useChatStore.getState();
  const socket = useSocketStore.getState().socket;

  if (!socket?.connected) return;

  // Danh sách conversation làm mới trước: nó mang lastMessage và unreadCounts.
  await chat.fetchConversations();

  const openThreads = Object.keys(useChatStore.getState().messages);
  if (openThreads.length === 0) return;

  const cursors = openThreads.map((conversationId) => ({
    conversationId,
    cursor: chat.newestCursor(conversationId),
  }));

  socket.emit("sync:since", { cursors }, (res) => {
    if (!res.ok) return;

    res.conversations.forEach((entry) => {
      if (entry.error || !entry.messages) return;

      useChatStore
        .getState()
        .applySync(entry.conversationId, entry.messages, Boolean(entry.truncated));
    });
  });
}

function startTimers(socket: AppSocket, get: Getter) {
  stopTimers();

  heartbeatTimer = setInterval(() => {
    if (socket.connected) socket.emit("presence:heartbeat");
  }, HEARTBEAT_MS);

  // Quét bỏ các chỉ báo đang nhập đã quá hạn: event `typing:stop` của server có
  // thể bị mất, và một chỉ báo treo vĩnh viễn trông như lỗi.
  typingSweeper = setInterval(() => {
    const now = Date.now();
    const current = get().typingByConversation;
    let changed = false;
    const next: SocketState["typingByConversation"] = {};

    for (const [conversationId, users] of Object.entries(current)) {
      const kept: Record<string, { displayName: string; expiresAt: number }> = {};

      for (const [userId, entry] of Object.entries(users)) {
        if (entry.expiresAt > now) {
          kept[userId] = entry;
        } else {
          changed = true;
        }
      }

      next[conversationId] = kept;
    }

    if (changed) useSocketStore.setState({ typingByConversation: next });
  }, 2000);
}

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (typingSweeper) clearInterval(typingSweeper);
  heartbeatTimer = null;
  typingSweeper = null;
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export const useConnectionStatus = () => useSocketStore((s) => s.status);

/** Trạng thái online của một người. Đăng ký hẹp nên không re-render vì người khác. */
export const usePresence = (userId: string | null | undefined) =>
  useSocketStore((s) => (userId ? (s.presence[userId]?.status ?? "offline") : "offline"));

export const useLastSeen = (userId: string | null | undefined) =>
  useSocketStore((s) => (userId ? (s.presence[userId]?.lastSeenAt ?? null) : null));

/** Tên những người đang nhập trong một conversation. */
export const useTypingNames = (conversationId: string | null | undefined) =>
  useSocketStore(
    useShallow((s) => {
      if (!conversationId) return [];
      const users = s.typingByConversation[conversationId];
      if (!users) return [];
      return Object.values(users).map((u) => u.displayName);
    }),
  );

/** @deprecated dùng `usePresence(userId)` — hook này đăng ký vào toàn bộ presence. */
export const useOnlineUserIds = () =>
  useSocketStore(
    useShallow((s) =>
      Object.entries(s.presence)
        .filter(([, v]) => v.status !== "offline")
        .map(([id]) => id),
    ),
  );
