import api from "@/lib/axios";
import type {
  Attachment,
  Conversation,
  ConversationResponse,
  Message,
  ReactionEmoji,
  ReactionGroup,
} from "@/types/chat";
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

  async editMessage(messageId: string, content: string): Promise<Message> {
    const res = await api.patch(`/messages/${messageId}`, { content });
    return res.data.message;
  },

  async deleteMessage(messageId: string): Promise<Message> {
    const res = await api.delete(`/messages/${messageId}`);
    return res.data.message;
  },

  /**
   * Tải tệp lên TRƯỚC, rồi mới gửi tin nhắn tham chiếu tới nó.
   *
   * Hai bước để tiến trình tải hiển thị được và thử lại được độc lập — gộp làm một
   * thì một lần tải 8MB thất bại sẽ kéo theo mất luôn nội dung đã gõ.
   */
  async uploadAttachment(conversationId: string, file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await api.post(
      `/conversations/${conversationId}/attachments`,
      formData,
    );

    return res.data.attachment;
  },

  /**
   * Thả / gỡ biểu cảm qua HTTP. Đường dự phòng khi socket không dùng được.
   *
   * Là TOGGLE: server tự quyết định thả hay gỡ dựa trên trạng thái thật, nên hai
   * tab không đồng bộ vẫn hội tụ về cùng một kết quả.
   */
  async toggleReaction(
    messageId: string,
    emoji: ReactionEmoji,
  ): Promise<{ reactions: ReactionGroup[]; active: boolean }> {
    const res = await api.put(`/messages/${messageId}/reactions`, { emoji });
    return { reactions: res.data.reactions, active: res.data.active };
  },

  /** Ghim / lưu trữ / tắt thông báo — tuỳ chọn riêng của người đang đăng nhập. */
  async updateConversationSettings(
    conversationId: string,
    settings: { pinned?: boolean; archived?: boolean; muteMinutes?: number | null },
  ): Promise<Conversation> {
    const res = await api.patch(`/conversations/${conversationId}/settings`, settings);
    return res.data.conversation;
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
    // Bỏ hẳn `name` khi rỗng thay vì gửi chuỗi rỗng. Chat 1-1 không có tên, và
    // một `name: ""` đi kèm là thứ từng làm mọi request tạo chat 1-1 trả 400.
    const trimmed = name.trim();

    const res = await api.post("/conversations", {
      type,
      memberIds,
      ...(trimmed ? { name: trimmed } : {}),
    });

    return res.data.conversation;
  },
};
