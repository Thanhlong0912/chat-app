import api from "@/lib/axios";
import type { Conversation, GroupRole } from "@/types/chat";

/**
 * Quản lý nhóm.
 *
 * Service ném lỗi, store bắt. Quyền được ép ở SERVER — các nút bị ẩn theo `myRole`
 * chỉ là để giao diện gọn gàng, không phải lớp bảo vệ.
 */
export const groupService = {
  async getConversation(conversationId: string): Promise<Conversation> {
    const res = await api.get(`/conversations/${conversationId}`);
    return res.data.conversation;
  },

  async updateInfo(
    conversationId: string,
    payload: { name?: string; description?: string | null },
  ): Promise<Conversation> {
    const res = await api.patch(`/conversations/${conversationId}/group`, payload);
    return res.data.conversation;
  },

  async uploadAvatar(conversationId: string, file: File): Promise<Conversation> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await api.post(`/conversations/${conversationId}/group/avatar`, formData);
    return res.data.conversation;
  },

  async removeAvatar(conversationId: string): Promise<Conversation> {
    const res = await api.delete(`/conversations/${conversationId}/group/avatar`);
    return res.data.conversation;
  },

  async addMembers(
    conversationId: string,
    memberIds: string[],
  ): Promise<{ conversation: Conversation; added: string[] }> {
    const res = await api.post(`/conversations/${conversationId}/members`, { memberIds });
    return res.data;
  },

  async removeMember(conversationId: string, userId: string): Promise<Conversation> {
    const res = await api.delete(`/conversations/${conversationId}/members/${userId}`);
    return res.data.conversation;
  },

  async setRole(
    conversationId: string,
    userId: string,
    role: GroupRole,
  ): Promise<Conversation> {
    const res = await api.patch(
      `/conversations/${conversationId}/members/${userId}/role`,
      { role },
    );
    return res.data.conversation;
  },

  async transferOwnership(conversationId: string, userId: string): Promise<Conversation> {
    const res = await api.post(`/conversations/${conversationId}/transfer-ownership`, {
      userId,
    });
    return res.data.conversation;
  },

  async leave(conversationId: string): Promise<{ deleted: boolean }> {
    const res = await api.post(`/conversations/${conversationId}/leave`);
    return res.data;
  },

  async remove(conversationId: string): Promise<void> {
    await api.delete(`/conversations/${conversationId}`);
  },
};
