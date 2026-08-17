import api from "@/lib/axios";
import type { Conversation, ConversationResponse, Message } from "@/types/chat";
import type { SendMessageInput } from "@/types/socket";

interface FetchMessagesResult {
  messages: Message[];
  cursor: string | null;
}

const pageLimit = 50;

/**
 * Lớp gọi API. Cố tình KHÔNG bắt lỗi ở đây — service ném, store bắt.
 *
 * Bản trước có vài method tự try/catch rồi trả về `undefined`, nên store không
 * bao giờ thấy thất bại và toast "thành công" vẫn hiện dù request đã 500.
 */
export const chatService = {
  async fetchConversations(): Promise<ConversationResponse> {
    const res = await api.get<ConversationResponse>("/conversations");
    return res.data;
  },

  async fetchMessages(id: string, cursor?: string | null): Promise<FetchMessagesResult> {
    // Chỉ gửi `cursor` khi thực sự có. Bản trước luôn nối `&cursor=` vào URL, nên
    // trang đầu gửi một cursor rỗng.
    const params = new URLSearchParams({ limit: String(pageLimit) });
    if (cursor) params.set("cursor", cursor);

    const res = await api.get(`/conversations/${id}/messages?${params}`);

    return { messages: res.data.messages, cursor: res.data.nextCursor ?? null };
  },

  /** Các tin nhắn mới hơn một cursor — dùng để đồng bộ lại sau khi mất kết nối. */
  async fetchMessagesSince(
    id: string,
    after?: string,
  ): Promise<{ messages: Message[]; truncated: boolean; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (after) params.set("after", after);

    const res = await api.get(`/conversations/${id}/messages/since?${params}`);

    return {
      messages: res.data.messages,
      truncated: Boolean(res.data.truncated),
      nextCursor: res.data.nextCursor ?? null,
    };
  },

  /** Gửi tin nhắn qua HTTP. Đường dự phòng khi socket không dùng được. */
  async sendMessage(
    input: SendMessageInput & { recipientId?: string; isGroup: boolean },
  ): Promise<Message> {
    const { isGroup, recipientId, ...rest } = input;

    if (isGroup) {
      const res = await api.post("/messages/group", rest);
      return res.data.message;
    }

    const res = await api.post("/messages/direct", { ...rest, recipientId });
    return res.data.message;
  },

  async markAsSeen(conversationId: string, lastReadMessageId?: string) {
    const res = await api.patch(`/conversations/${conversationId}/seen`, {
      ...(lastReadMessageId ? { lastReadMessageId } : {}),
    });
    return res.data;
  },

  async createConversation(
    type: "direct" | "group",
    name: string,
    memberIds: string[],
  ): Promise<Conversation> {
    const res = await api.post("/conversations", { type, name, memberIds });
    return res.data.conversation;
  },
};
