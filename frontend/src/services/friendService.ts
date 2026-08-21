import api from "@/lib/axios";
import type { User } from "@/types/user";

/**
 * Lớp gọi API cho bạn bè.
 *
 * Cố tình KHÔNG bắt lỗi ở đây. Ba method dưới đây trước kia tự try/catch rồi trả về
 * `undefined`, nên store không bao giờ nhìn thấy thất bại: `throw error` trong
 * `useFriendStore.acceptRequest` là code chết, và `ReceivedRequests` hiện toast
 * "đã chấp nhận" cho một request vừa trả về 500.
 *
 * Nguyên tắc: service ném, store bắt.
 */
export const friendService = {
  /**
   * Tìm người dùng theo username hoặc tên hiển thị, khớp một phần.
   *
   * Đọc `users` nếu có, và rơi về `user` khi không — backend ở Render còn frontend
   * ở Vercel, hai bên không lên bản mới cùng lúc, nên bundle này phải chạy được cả
   * với backend chưa deploy dạng mảng.
   */
  async searchByUsername(username: string): Promise<User[]> {
    const res = await api.get("/users/search", { params: { username } });

    if (Array.isArray(res.data.users)) return res.data.users;

    return res.data.user ? [res.data.user] : [];
  },

  async sendFriendRequest(to: string, message?: string) {
    const res = await api.post("/friends/requests", { to, message });
    return res.data.message;
  },

  async getAllFriendRequest() {
    const res = await api.get("/friends/requests");
    const { sent, received } = res.data;
    return { sent, received };
  },

  async acceptRequest(requestId: string) {
    const res = await api.post(`/friends/requests/${requestId}/accept`);
    return res.data.newFriend;
  },

  async declineRequest(requestId: string) {
    await api.post(`/friends/requests/${requestId}/decline`);
  },

  async getFriendList() {
    const res = await api.get("/friends");
    return res.data.friends;
  },
};
