import { friendService } from "@/services/friendService";
import type { FriendState } from "@/types/store";
import { create } from "zustand";

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  loading: false,
  receivedList: [],
  sentList: [],

  searchByUsername: async (username) => {
    try {
      set({ loading: true });
      return await friendService.searchByUsername(username);
    } catch (error) {
      console.error("Lỗi xảy ra khi tìm user bằng username", error);
      return [];
    } finally {
      set({ loading: false });
    }
  },

  /**
   * Gửi lời mời kết bạn. NÉM khi thất bại.
   *
   * Bản trước `catch` rồi `return describeError(error)` — trả về chuỗi mô tả LỖI
   * ở đúng vị trí mà thành công trả về chuỗi "Gửi lời mời kết bạn thành công".
   * Chỗ gọi không phân biệt được hai thứ đó, nên nó `toast.success(...)` nội dung
   * lỗi rồi đóng modal: một lời mời chưa từng được gửi hiện ra như đã gửi xong,
   * và cách duy nhất để phát hiện là tải lại trang xem danh sách đã gửi.
   */
  addFriend: async (to, message) => {
    try {
      set({ loading: true });
      return await friendService.sendFriendRequest(to, message);
    } finally {
      set({ loading: false });
    }
  },

  getAllFriendRequests: async () => {
    try {
      set({ loading: true });

      const { sent, received } = await friendService.getAllFriendRequest();

      set({ receivedList: received, sentList: sent });
    } catch (error) {
      console.error("Lỗi xảy ra khi getAllFriendRequests", error);
    } finally {
      set({ loading: false });
    }
  },

  acceptRequest: async (requestId) => {
    try {
      set({ loading: true });
      await friendService.acceptRequest(requestId);

      set((state) => ({
        receivedList: state.receivedList.filter((r) => r._id !== requestId),
      }));
    } finally {
      // Thiếu `finally` là lý do `loading` bị kẹt ở true vĩnh viễn sau khi chấp
      // nhận một lời mời, khiến cả hai nút trong ReceivedRequests bị disable.
      set({ loading: false });
    }
  },

  declineRequest: async (requestId) => {
    try {
      set({ loading: true });
      await friendService.declineRequest(requestId);

      set((state) => ({
        receivedList: state.receivedList.filter((r) => r._id !== requestId),
      }));
    } finally {
      set({ loading: false });
    }
  },

  getFriends: async () => {
    try {
      set({ loading: true });
      const friends = await friendService.getFriendList();
      set({ friends });
    } catch (error) {
      console.error("Lỗi xảy ra khi getFriends", error);
    } finally {
      set({ loading: false });
    }
  },
}));
