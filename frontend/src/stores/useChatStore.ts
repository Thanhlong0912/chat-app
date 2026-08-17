import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { chatService } from "@/services/chatService";
import type { ChatState, MessageThread } from "@/types/store";
import type { Conversation, Message } from "@/types/chat";
import { describeError } from "@/lib/errors";
import { useAuthStore } from "./useAuthStore";
import { useSocketStore } from "./useSocketStore";

const EMPTY_IDS: string[] = [];

const emptyThread = (): MessageThread => ({
  ids: [],
  byId: {},
  hasMore: false,
  nextCursor: null,
  status: "idle",
  error: null,
});

/** Sắp theo hoạt động mới nhất. Tie-break bằng id để thứ tự luôn xác định. */
const sortOrder = (ids: string[], byId: Record<string, Conversation>) =>
  [...ids].sort((a, b) => {
    const left = byId[a];
    const right = byId[b];
    const leftAt = new Date(left?.lastMessageAt ?? left?.createdAt ?? 0).getTime();
    const rightAt = new Date(right?.lastMessageAt ?? right?.createdAt ?? 0).getTime();

    if (rightAt !== leftAt) return rightAt - leftAt;
    return a < b ? -1 : 1;
  });

/** Chèn một tin nhắn vào thread, giữ thứ tự theo (createdAt, _id). */
const insertMessage = (thread: MessageThread, message: Message): MessageThread => {
  const byId = { ...thread.byId, [message._id]: message };

  if (thread.byId[message._id]) {
    // Đã có: chỉ thay nội dung, không đụng thứ tự.
    return { ...thread, byId };
  }

  const key = (m: Message) => [new Date(m.createdAt).getTime(), m._id] as const;
  const target = key(message);

  // Gần như luôn là tin mới nhất, nên quét từ cuối lên là nhanh nhất.
  let index = thread.ids.length;
  while (index > 0) {
    const candidate = byId[thread.ids[index - 1]];
    if (!candidate) break;

    const other = key(candidate);
    const isBefore = other[0] < target[0] || (other[0] === target[0] && other[1] < target[1]);
    if (isBefore) break;

    index -= 1;
  }

  const ids = [...thread.ids];
  ids.splice(index, 0, message._id);

  return { ...thread, ids, byId };
};

const isGroupConversation = (conversation: Conversation | undefined) =>
  conversation?.type === "group";

/** Phía bên kia của một conversation 1-1. */
const otherParticipantId = (conversation: Conversation, meId: string) =>
  conversation.participants.find((p) => p._id !== meId)?._id;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversationsById: {},
      conversationOrder: [],
      messages: {},
      pending: {},
      drafts: {},
      activeConversationId: null,
      convoLoading: false,
      creating: false,
      error: null,

      reset: () =>
        set({
          conversationsById: {},
          conversationOrder: [],
          messages: {},
          pending: {},
          activeConversationId: null,
          convoLoading: false,
          creating: false,
          error: null,
        }),

      setActiveConversation: (id) => set({ activeConversationId: id }),

      setDraft: (conversationId, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [conversationId]: draft } })),

      clearError: () => set({ error: null }),

      fetchConversations: async () => {
        set({ convoLoading: true, error: null });

        try {
          const { conversations } = await chatService.fetchConversations();

          const byId: Record<string, Conversation> = {};
          conversations.forEach((c) => {
            byId[c._id] = c;
          });

          set({
            conversationsById: byId,
            conversationOrder: sortOrder(Object.keys(byId), byId),
            convoLoading: false,
          });
        } catch (error) {
          set({ convoLoading: false, error: describeError(error) });
        }
      },

      fetchMessages: async (conversationId) => {
        const convoId = conversationId ?? get().activeConversationId;
        if (!convoId) return;

        const thread = get().messages[convoId] ?? emptyThread();

        // Kiểm tra cờ đang-tải mà bản trước chỉ SET chứ không bao giờ ĐỌC — nên
        // sentinel của infinite scroll có thể bắn hai lần và prepend cùng một
        // trang hai lượt.
        if (thread.status === "loading") return;

        // Đã hết dữ liệu cũ hơn.
        if (thread.status === "loaded" && !thread.hasMore) return;

        set((state) => ({
          messages: {
            ...state.messages,
            [convoId]: { ...(state.messages[convoId] ?? emptyThread()), status: "loading" },
          },
        }));

        try {
          const { messages, cursor } = await chatService.fetchMessages(
            convoId,
            thread.nextCursor,
          );

          const meId = useAuthStore.getState().user?._id;

          set((state) => {
            // Đọc lại state BÊN TRONG updater: `thread` phía trên là ảnh chụp
            // trước await và có thể đã cũ.
            let next = state.messages[convoId] ?? emptyThread();

            for (const message of messages) {
              next = insertMessage(next, {
                ...message,
                isOwn: message.senderId === meId,
              });
            }

            return {
              messages: {
                ...state.messages,
                [convoId]: {
                  ...next,
                  hasMore: Boolean(cursor),
                  nextCursor: cursor,
                  status: "loaded",
                  error: null,
                },
              },
            };
          });
        } catch (error) {
          set((state) => ({
            messages: {
              ...state.messages,
              [convoId]: {
                ...(state.messages[convoId] ?? emptyThread()),
                status: "error",
                error: describeError(error),
              },
            },
          }));
        }
      },

      sendMessage: async (input) => {
        const me = useAuthStore.getState().user;
        const conversation = get().conversationsById[input.conversationId];

        if (!me || !conversation) return;

        // Id do client sinh, dùng để đối chiếu bản lạc quan với bản server trả về,
        // và để retry idempotent — server coi lần gửi lại cùng id là cùng một tin.
        const clientMessageId = input.clientMessageId ?? crypto.randomUUID();

        const optimistic: Message = {
          _id: `tmp:${clientMessageId}`,
          conversationId: input.conversationId,
          senderId: me._id,
          sender: { _id: me._id, displayName: me.displayName, avatarUrl: me.avatarUrl },
          kind: input.imgUrl ? "image" : "text",
          content: input.content ?? null,
          attachments: input.imgUrl ? [{ url: input.imgUrl, kind: "image" }] : [],
          replyTo: null,
          createdAt: new Date().toISOString(),
          editedAt: null,
          deleted: false,
          clientMessageId,
          isOwn: true,
          status: "sending",
        };

        set((state) => ({
          messages: {
            ...state.messages,
            [input.conversationId]: insertMessage(
              state.messages[input.conversationId] ?? emptyThread(),
              optimistic,
            ),
          },
          pending: {
            ...state.pending,
            [clientMessageId]: {
              conversationId: input.conversationId,
              status: "sending",
              input: { ...input, clientMessageId },
            },
          },
        }));

        try {
          const payload = { ...input, clientMessageId };

          // Ưu tiên socket (có ack, nhanh hơn); rơi về HTTP khi socket không dùng
          // được, nhờ vậy vẫn gửi được lúc realtime đang gián đoạn.
          let saved = await useSocketStore.getState().sendMessage(payload);

          if (!saved) {
            saved = await chatService.sendMessage({
              ...payload,
              isGroup: isGroupConversation(conversation),
              recipientId: isGroupConversation(conversation)
                ? undefined
                : otherParticipantId(conversation, me._id),
            });
          }

          get().reconcilePending(clientMessageId, saved);
        } catch (error) {
          set((state) => {
            const thread = state.messages[input.conversationId];
            const tmpId = `tmp:${clientMessageId}`;

            return {
              error: describeError(error),
              pending: {
                ...state.pending,
                [clientMessageId]: {
                  ...state.pending[clientMessageId],
                  status: "failed",
                },
              },
              messages: thread
                ? {
                    ...state.messages,
                    [input.conversationId]: {
                      ...thread,
                      byId: {
                        ...thread.byId,
                        // Giữ lại bong bóng tin nhắn ở trạng thái "failed" để người
                        // dùng thử lại được. Bản trước xoá sạch nội dung đã gõ.
                        [tmpId]: { ...thread.byId[tmpId], status: "failed" },
                      },
                    },
                  }
                : state.messages,
            };
          });
        }
      },

      /** Thay bản lạc quan bằng bản server đã xác nhận. */
      reconcilePending: (clientMessageId: string, saved: Message) => {
        set((state) => {
          const pending = state.pending[clientMessageId];
          if (!pending) {
            // Bản broadcast đã tới trước ack và đã dọn xong — không có gì để làm.
            return state;
          }

          const thread = state.messages[pending.conversationId] ?? emptyThread();
          const tmpId = `tmp:${clientMessageId}`;

          // Bỏ bản tạm rồi chèn bản thật. Nếu broadcast đã chèn bản thật thì
          // insertMessage chỉ cập nhật, không tạo bản thứ hai.
          const ids = thread.ids.filter((id) => id !== tmpId);
          const byId = { ...thread.byId };
          delete byId[tmpId];

          const cleaned: MessageThread = { ...thread, ids, byId };
          const nextPending = { ...state.pending };
          delete nextPending[clientMessageId];

          return {
            pending: nextPending,
            messages: {
              ...state.messages,
              [pending.conversationId]: insertMessage(cleaned, { ...saved, isOwn: true }),
            },
          };
        });
      },

      retryMessage: async (clientMessageId) => {
        const pending = get().pending[clientMessageId];
        if (!pending) return;

        // Cùng clientMessageId, nên nếu lần trước server đã lưu thành công thì
        // lần này nhận lại đúng tin nhắn đó chứ không tạo bản trùng.
        await get().sendMessage(pending.input);
      },

      discardFailedMessage: (clientMessageId) =>
        set((state) => {
          const pending = state.pending[clientMessageId];
          if (!pending) return state;

          const thread = state.messages[pending.conversationId];
          const tmpId = `tmp:${clientMessageId}`;
          const nextPending = { ...state.pending };
          delete nextPending[clientMessageId];

          if (!thread) return { pending: nextPending };

          const byId = { ...thread.byId };
          delete byId[tmpId];

          return {
            pending: nextPending,
            messages: {
              ...state.messages,
              [pending.conversationId]: {
                ...thread,
                ids: thread.ids.filter((id) => id !== tmpId),
                byId,
              },
            },
          };
        }),

      upsertMessage: (message) => {
        const meId = useAuthStore.getState().user?._id;

        set((state) => {
          const convoId = message.conversationId;

          // Bản broadcast của tin nhắn do CHÍNH TA gửi: đối chiếu với bản lạc quan
          // thay vì thêm một bong bóng thứ hai.
          const tmpId = message.clientMessageId ? `tmp:${message.clientMessageId}` : null;

          /*
           * KHÔNG tải cả luồng tin nhắn ở đây.
           *
           * Bản trước, khi nhận socket message của một conversation chưa từng mở, sẽ
           * gọi luôn một request 50 tin nhắn. Với nhiều conversation đang có hoạt
           * động thì đó là N+1 request cho dữ liệu không ai đang xem. Nay chỉ cập
           * nhật khi luồng đã được tải; phần preview và badge do
           * `updateConversation` lo.
           */
          const existing = state.messages[convoId];
          if (!existing) return state;

          let thread = existing;

          if (tmpId && thread.byId[tmpId]) {
            const ids = thread.ids.filter((id) => id !== tmpId);
            const byId = { ...thread.byId };
            delete byId[tmpId];
            thread = { ...thread, ids, byId };
          }

          const nextPending = { ...state.pending };
          if (message.clientMessageId) delete nextPending[message.clientMessageId];

          return {
            pending: nextPending,
            messages: {
              ...state.messages,
              [convoId]: insertMessage(thread, {
                ...message,
                isOwn: message.senderId === meId,
              }),
            },
          };
        });
      },

      removeMessage: (conversationId, messageId) =>
        set((state) => {
          const thread = state.messages[conversationId];
          if (!thread?.byId[messageId]) return state;

          return {
            messages: {
              ...state.messages,
              [conversationId]: {
                ...thread,
                byId: {
                  ...thread.byId,
                  // Xoá mềm: giữ bong bóng làm bia mộ để chuỗi trả lời không hổng.
                  [messageId]: {
                    ...thread.byId[messageId],
                    deleted: true,
                    content: null,
                    attachments: [],
                  },
                },
              },
            },
          };
        }),

      upsertConversation: (conversation) =>
        set((state) => {
          const byId = { ...state.conversationsById, [conversation._id]: conversation };

          return {
            conversationsById: byId,
            conversationOrder: sortOrder(Object.keys(byId), byId),
          };
        }),

      updateConversation: (patch) =>
        set((state) => {
          const existing = state.conversationsById[patch._id];
          if (!existing) return state;

          const byId = {
            ...state.conversationsById,
            [patch._id]: { ...existing, ...patch },
          };

          return {
            conversationsById: byId,
            // Sắp lại: bản trước map tại chỗ và không bao giờ sắp lại, nên thứ tự
            // sidebar cũ dần đi cho tới lần fetch tiếp theo.
            conversationOrder: sortOrder(Object.keys(byId), byId),
          };
        }),

      removeConversation: (conversationId) =>
        set((state) => {
          const byId = { ...state.conversationsById };
          delete byId[conversationId];

          const messages = { ...state.messages };
          delete messages[conversationId];

          return {
            conversationsById: byId,
            conversationOrder: state.conversationOrder.filter((id) => id !== conversationId),
            messages,
            activeConversationId:
              state.activeConversationId === conversationId
                ? null
                : state.activeConversationId,
          };
        }),

      applyUnreadCounts: (conversationId, unreadCounts) =>
        set((state) => {
          const existing = state.conversationsById[conversationId];
          if (!existing) return state;

          const meId = useAuthStore.getState().user?._id;

          const byId = {
            ...state.conversationsById,
            [conversationId]: {
              ...existing,
              unreadCounts,
              unreadCount: meId ? (unreadCounts[meId] ?? 0) : existing.unreadCount,
            },
          };

          return { conversationsById: byId };
        }),

      markAsSeen: async (conversationId) => {
        const convoId = conversationId ?? get().activeConversationId;
        const me = useAuthStore.getState().user;

        if (!convoId || !me) return;

        const conversation = get().conversationsById[convoId];
        if (!conversation) return;

        const thread = get().messages[convoId];
        const newestId = [...(thread?.ids ?? [])]
          .reverse()
          .find((id) => !id.startsWith("tmp:"));

        // Đã đọc hết rồi thì không gọi lại.
        if (conversation.unreadCount === 0) return;

        // Cập nhật lạc quan để badge tắt ngay.
        set((state) => {
          const existing = state.conversationsById[convoId];
          if (!existing) return state;

          return {
            conversationsById: {
              ...state.conversationsById,
              [convoId]: {
                ...existing,
                unreadCount: 0,
                unreadCounts: { ...existing.unreadCounts, [me._id]: 0 },
              },
            },
          };
        });

        try {
          // Ưu tiên socket; HTTP là dự phòng.
          const socket = useSocketStore.getState();
          if (socket.status === "connected") {
            socket.advanceRead(convoId, newestId);
          } else {
            await chatService.markAsSeen(convoId, newestId);
          }
        } catch (error) {
          // Không hoàn tác badge: lần mở sau sẽ thử lại, và badge tắt là hành vi
          // đúng về mặt cảm nhận của người dùng.
          set({ error: describeError(error) });
        }
      },

      applyReadReceipt: (conversationId, userId, lastReadAt) =>
        set((state) => {
          const existing = state.conversationsById[conversationId];
          if (!existing) return state;

          return {
            conversationsById: {
              ...state.conversationsById,
              [conversationId]: {
                ...existing,
                participants: existing.participants.map((p) =>
                  p._id === userId ? { ...p, lastReadAt } : p,
                ),
              },
            },
          };
        }),

      createConversation: async (type, name, memberIds) => {
        set({ creating: true, error: null });

        try {
          const conversation = await chatService.createConversation(type, name, memberIds);

          get().upsertConversation(conversation);
          set({ creating: false, activeConversationId: conversation._id });

          return conversation;
        } catch (error) {
          set({ creating: false, error: describeError(error) });
          return null;
        }
      },

      applySync: (conversationId, messages, truncated) => {
        // Khoảng trống lớn hơn một lần trả về: bỏ cache và tải lại từ đầu, thay vì
        // ghép một dải còn thiếu ở giữa và tạo ra một luồng có lỗ.
        if (truncated) {
          set((state) => {
            const next = { ...state.messages };
            delete next[conversationId];
            return { messages: next };
          });

          void get().fetchMessages(conversationId);
          return;
        }

        const meId = useAuthStore.getState().user?._id;

        set((state) => {
          const existing = state.messages[conversationId];
          // Chưa mở luồng này thì không cần ghép gì.
          if (!existing) return state;

          let thread = existing;
          for (const message of messages) {
            thread = insertMessage(thread, {
              ...message,
              isOwn: message.senderId === meId,
            });
          }

          return { messages: { ...state.messages, [conversationId]: thread } };
        });
      },

      newestCursor: (conversationId) => {
        const thread = get().messages[conversationId];
        if (!thread) return undefined;

        const newestId = [...thread.ids].reverse().find((id) => !id.startsWith("tmp:"));
        const message = newestId ? thread.byId[newestId] : undefined;

        if (!message) return undefined;

        // Cùng định dạng với cursor của server: base64url của {t, i}.
        return btoa(
          JSON.stringify({ t: new Date(message.createdAt).toISOString(), i: message._id }),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      },
    }),
    {
      name: "chat-storage",
      /*
       * Chỉ giữ bản nháp và conversation đang mở.
       *
       * Cố tình KHÔNG persist `conversations` nữa: lợi ích về cảm nhận tốc độ là
       * nhỏ, còn cái giá là badge chưa đọc và tin nhắn cuối đã cũ được vẽ ra trước
       * khi request đầu tiên trả về — người dùng thấy số sai rồi thấy nó nhảy.
       */
      partialize: (state) => ({
        drafts: state.drafts,
        activeConversationId: state.activeConversationId,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/*
 * Quy ước: component KHÔNG destructure store.
 *
 * `const { a, b } = useChatStore()` đăng ký vào toàn bộ store, nên một tin nhắn
 * trong một conversation làm re-render mọi card, header, và cả `App`. Các hook dưới
 * đây thu hẹp phạm vi đăng ký. `useShallow` có sẵn trong zustand 5 — không thêm
 * dependency nào.
 */

export const useConversationOrder = () =>
  useChatStore(useShallow((s) => s.conversationOrder));

/**
 * Id các conversation theo loại, đã sắp thứ tự.
 *
 * Trả về id chứ không phải object, để card tự đăng ký vào đúng conversation của nó
 * — nhờ vậy một tin nhắn mới chỉ re-render một card, không phải cả danh sách.
 */
export const useConversationIdsByType = (type: "direct" | "group") =>
  useChatStore(
    useShallow((s) =>
      s.conversationOrder.filter((id) => s.conversationsById[id]?.type === type),
    ),
  );

export const useConversation = (id: string | null | undefined) =>
  useChatStore((s) => (id ? s.conversationsById[id] : undefined));

export const useActiveConversationId = () => useChatStore((s) => s.activeConversationId);

export const useActiveConversation = () =>
  useChatStore((s) =>
    s.activeConversationId ? s.conversationsById[s.activeConversationId] : undefined,
  );

export const useMessageIds = (conversationId: string | null | undefined) =>
  useChatStore(
    useShallow((s) => (conversationId ? s.messages[conversationId]?.ids ?? EMPTY_IDS : EMPTY_IDS)),
  );

/** Một tin nhắn duy nhất — nhờ đó một event socket chỉ re-render một bong bóng. */
export const useMessage = (conversationId: string | null | undefined, messageId: string) =>
  useChatStore((s) => (conversationId ? s.messages[conversationId]?.byId[messageId] : undefined));

export const useThreadStatus = (conversationId: string | null | undefined) =>
  useChatStore((s) =>
    conversationId ? (s.messages[conversationId]?.status ?? "idle") : "idle",
  );

export const useThreadHasMore = (conversationId: string | null | undefined) =>
  useChatStore((s) => (conversationId ? Boolean(s.messages[conversationId]?.hasMore) : false));

export const useUnreadCount = (conversationId: string) =>
  useChatStore((s) => s.conversationsById[conversationId]?.unreadCount ?? 0);

export const useDraft = (conversationId: string | null | undefined) =>
  useChatStore((s) => (conversationId ? (s.drafts[conversationId] ?? "") : ""));

export const useChatError = () => useChatStore((s) => s.error);
