import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";

/*
 * Máy này đã từng đăng nhập chưa?
 *
 * Backend nằm trên gói free của Render: không ai gọi trong ~15 phút thì nó ngủ, và
 * request đánh thức mất 20–50 giây (đo được 21,5s lúc lạnh, 0,6s lúc đã ấm). Gate
 * này trước đây chặn lần vẽ đầu tiên cho tới khi `/auth/refresh` trả lời, nên người
 * đầu tiên ghé sau một quãng vắng chỉ thấy "Đang tải trang..." gần một phút — không
 * lỗi, không giải thích, không cách nào biết là trang chưa hỏng. Với một link nằm
 * trong portfolio thì gần như mọi cú click đều rơi đúng vào lần lạnh đó.
 *
 * `user` được persist trong `auth-storage`, và `clearState()` xoá nó mỗi khi phiên
 * thật sự kết thúc. Nên nó trả lời đúng câu hỏi trên: có `user` thì mới đáng chờ
 * khôi phục phiên, không có thì đi thẳng tới màn hình đăng nhập và để refresh chạy
 * nền.
 */
const hasSessionWorthWaitingFor = () => useAuthStore.getState().user !== null;

// Chờ quá lâu thì nói cho người dùng biết chuyện gì đang xảy ra, đừng để họ đoán.
const WAKE_NOTICE_MS = 3000;

const ProtectedRoute = () => {
  // Chọn từng field: destructure cả store khiến gate này render lại theo mọi thay
  // đổi của auth store.
  const accessToken = useAuthStore((s) => s.accessToken);

  /*
   * Không gate theo `loading` nữa.
   *
   * `refresh()` bật `loading` ngay khi được gọi, kể cả trên đường chạy nền của
   * khách mới — gate theo nó thì việc bỏ chặn ở trên thành vô nghĩa. Đường khôi
   * phục phiên không cần tới nó: `restore()` await xong hết mới hạ cờ bên dưới.
   */
  const [waitingForSession, setWaitingForSession] = useState(hasSessionWorthWaitingFor);
  const [serverWaking, setServerWaking] = useState(false);

  useEffect(() => {
    /*
     * Khôi phục phiên chỉ chạy đúng một lần khi mount.
     *
     * Toàn bộ thao tác đọc state qua `getState()` thay vì qua closure, nên effect
     * không cần dependency nào — trước đây `init` được khai báo trong thân component
     * và đọc `accessToken` từ closure, nên nó luôn thấy giá trị lúc mount (đó là
     * lý do phải có `getState()` ở giữa hàm) và eslint cảnh báo thiếu dependency.
     *
     * Vẫn chạy cho cả khách mới: hiếm nhưng có thật — localStorage bị xoá trong khi
     * cookie refresh còn hạn. Lúc đó refresh thành công sau khi đã chuyển sang
     * /signin, và SignInPage tự đưa họ trở vào app.
     */
    const restore = async () => {
      const auth = useAuthStore.getState();

      // Xảy ra khi người dùng F5: access token chỉ nằm trong bộ nhớ.
      if (!auth.accessToken) {
        await auth.refresh();
      }

      const afterRefresh = useAuthStore.getState();

      if (afterRefresh.accessToken && !afterRefresh.user) {
        await afterRefresh.fetchMe();
      }

      // `signIn` có gọi fetchConversations, còn đường khôi phục phiên thì không,
      // nên sau khi F5 sidebar trống cho tới khi đăng nhập lại.
      if (useAuthStore.getState().accessToken) {
        await useChatStore.getState().fetchConversations();
      }

      setWaitingForSession(false);
    };

    void restore();
  }, []);

  useEffect(() => {
    if (!waitingForSession) return;

    const timer = setTimeout(() => setServerWaking(true), WAKE_NOTICE_MS);

    return () => clearTimeout(timer);
  }, [waitingForSession]);

  if (waitingForSession) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Đang tải trang...
        </div>
        {serverWaking && (
          <p className="max-w-sm text-sm">
            Server đang được đánh thức. Lần đầu sau một quãng vắng có thể mất tới một
            phút.
          </p>
        )}
      </div>
    );
  }

  if (!accessToken) {
    return (
      <Navigate
        to="/signin"
        replace
      />
    );
  }

  return <Outlet />;
};

export default ProtectedRoute;
