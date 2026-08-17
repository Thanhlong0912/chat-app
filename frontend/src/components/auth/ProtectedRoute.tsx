import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";

const ProtectedRoute = () => {
  // Chọn từng field: destructure cả store khiến gate này render lại theo mọi thay
  // đổi của auth store.
  const accessToken = useAuthStore((s) => s.accessToken);
  const loading = useAuthStore((s) => s.loading);

  const [starting, setStarting] = useState(true);

  useEffect(() => {
    /*
     * Khôi phục phiên chỉ chạy đúng một lần khi mount.
     *
     * Toàn bộ thao tác đọc state qua `getState()` thay vì qua closure, nên effect
     * không cần dependency nào — trước đây `init` được khai báo trong thân component
     * và đọc `accessToken` từ closure, nên nó luôn thấy giá trị lúc mount (đó là
     * lý do phải có `getState()` ở giữa hàm) và eslint cảnh báo thiếu dependency.
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

      setStarting(false);
    };

    void restore();
  }, []);

  if (starting || loading) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Đang tải trang...
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
