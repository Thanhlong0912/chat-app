import { userService } from "@/services/userService";
import type { UserState } from "@/types/store";
import { create } from "zustand";
import { useAuthStore } from "./useAuthStore";
import { toast } from "sonner";
import { useChatStore } from "./useChatStore";
import { describeError } from "@/lib/errors";

export const useUserStore = create<UserState>(() => ({
  updateAvatarUrl: async (formData) => {
    try {
      const { user, setUser } = useAuthStore.getState();
      const data = await userService.uploadAvatar(formData);

      if (user) {
        setUser({ ...user, avatarUrl: data.avatarUrl });

        // Avatar xuất hiện trong danh sách participant, nên phải tải lại để các
        // cuộc trò chuyện hiển thị ảnh mới.
        void useChatStore.getState().fetchConversations();
      }
    } catch (error) {
      toast.error(describeError(error));
    }
  },

  /**
   * Cập nhật hồ sơ / tuỳ chọn.
   *
   * Cố tình NÉM lỗi ra ngoài thay vì nuốt: form cần biết để tô đỏ đúng field.
   */
  updateProfile: async (payload) => {
    const user = await userService.updateProfile(payload);
    useAuthStore.getState().setUser(user);
    return user;
  },
}));
