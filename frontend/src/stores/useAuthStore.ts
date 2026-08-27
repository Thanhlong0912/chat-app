import { create } from "zustand";
import axios from "axios";
import { toast } from "sonner";
import { authService } from "@/services/authService";
import type { AuthState } from "@/types/store";
import { persist } from "zustand/middleware";
import { useChatStore } from "./useChatStore";

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      loading: false,

      setAccessToken: (accessToken) => {
        set({ accessToken });
      },
      setUser: (user) => {
        set({ user });
      },
      clearState: () => {
        set({ accessToken: null, user: null, loading: false });
        useChatStore.getState().reset();

        /*
         * Chỉ xoá đúng key của app, KHÔNG dùng localStorage.clear().
         *
         * `clear()` xoá cả `theme-storage` và các vị trí scroll đã lưu. Và vì
         * `signIn` gọi `clearState()` ngay đầu, mỗi lần đăng nhập lại xoá luôn tuỳ
         * chọn sáng/tối mà người dùng đã chọn.
         */
        localStorage.removeItem("auth-storage");
        useChatStore.persist.clearStorage();
      },
      signUp: async (username, password, email, firstName, lastName) => {
        try {
          set({ loading: true });

          //  gọi api
          await authService.signUp(username, password, email, firstName, lastName);

          toast.success(
            "Đăng ký thành công! Bạn sẽ được chuyển sang trang đăng nhập."
          );
        } catch (error) {
          console.error(error);
          toast.error("Đăng ký không thành công");
        } finally {
          set({ loading: false });
        }
      },
      signIn: async (username, password) => {
        try {
          // Không gọi clearState() ở đây: nó xoá dữ liệu đã lưu, và đăng nhập không
          // phải là thời điểm để dọn dẹp. Chỉ reset phần state trong bộ nhớ.
          useChatStore.getState().reset();
          set({ loading: true });

          const { accessToken } = await authService.signIn(username, password);
          get().setAccessToken(accessToken);

          await get().fetchMe();
          useChatStore.getState().fetchConversations();

          toast.success("Chào mừng bạn quay lại với Moji 🎉");
        } catch (error) {
          console.error(error);
          toast.error("Đăng nhập không thành công!");
        } finally {
          set({ loading: false });
        }
      },
      signOut: async () => {
        try {
          get().clearState();
          await authService.signOut();
          toast.success("Logout thành công!");
        } catch (error) {
          console.error(error);
          toast.error("Lỗi xảy ra khi logout. Hãy thử lại!");
        }
      },
      fetchMe: async () => {
        try {
          set({ loading: true });
          const user = await authService.fetchMe();

          set({ user });
        } catch (error) {
          console.error(error);
          set({ user: null, accessToken: null });
          toast.error("Lỗi xảy ra khi lấy dữ liệu người dùng. Hãy thử lại!");
        } finally {
          set({ loading: false });
        }
      },
      refresh: async () => {
        try {
          set({ loading: true });
          const { user, fetchMe, setAccessToken } = get();
          const accessToken = await authService.refresh();

          setAccessToken(accessToken);

          if (!user) {
            await fetchMe();
          }
        } catch (error) {
          /*
           * Không có cookie nào cả nghĩa là chưa từng có phiên để mà hết hạn.
           *
           * `ProtectedRoute` gọi refresh() ngay khi mount cho bất kỳ ai vào "/" mà
           * chưa có access token trong bộ nhớ — gồm cả người lần đầu vào trang. Họ
           * nhận 401 NO_REFRESH_TOKEN, và trước đây bị báo "Phiên đăng nhập đã hết
           * hạn" ngay trên màn hình đầu tiên họ nhìn thấy.
           *
           * Các mã còn lại (REFRESH_TOKEN_INVALID/_EXPIRED/_REUSED) là phiên thật
           * sự kết thúc. Lỗi mạng thì không có mã nào để đọc — im lặng ở đó sẽ giấu
           * mất lỗi thật, nên mặc định vẫn là báo.
           *
           * console.error cũng nằm trong nhánh này: đổ một AxiosError ra console
           * mỗi lần có khách mới ghé nghĩa là console production luôn sẵn một "lỗi"
           * đỏ chẳng liên quan gì tới lỗi thật. (Dòng "Failed to load resource: 401"
           * của trình duyệt thì vẫn còn — log tầng mạng, JS không tắt được.)
           */
          const isAxios = axios.isAxiosError<{ code?: string }>(error);

          const noSessionToExpire =
            isAxios && error.response?.data?.code === "NO_REFRESH_TOKEN";

          if (!noSessionToExpire) {
            console.error(error);

            /*
             * Không có `response` nghĩa là request không tới được server: backend
             * đang ngủ (gói free của Render mất 20–50 giây để tỉnh) hoặc mất mạng.
             * Vẫn phải báo — im lặng ở đây giấu mất lỗi thật — nhưng "phiên đã hết
             * hạn" là sai sự thật. Từ khi `ProtectedRoute` không chặn lần vẽ đầu
             * nữa, khách lần đầu đọc được đúng câu đó ngay trên màn hình đăng nhập,
             * dù chưa từng có phiên nào để mà hết hạn.
             */
            const serverUnreachable = isAxios && !error.response;

            toast.error(
              serverUnreachable
                ? "Không kết nối được tới server. Server có thể đang khởi động, thử lại sau giây lát."
                : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!"
            );
          }

          get().clearState();
        } finally {
          set({ loading: false });
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({ user: state.user }), // chỉ persist user
    }
  )
);
