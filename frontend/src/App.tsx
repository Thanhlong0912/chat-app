import { BrowserRouter, Route, Routes } from "react-router";
import SignInPage from "./pages/SignInPage";
import ChatAppPage from "./pages/ChatAppPage";
import { Toaster } from "sonner";
import SignUpPage from "./pages/SignUpPage";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import { useUnreadBadge } from "./hooks/useUnreadBadge";
import { useThemeStore } from "./stores/useThemeStore";
import { useEffect } from "react";
import { useAuthStore } from "./stores/useAuthStore";
import { useSocketStore } from "./stores/useSocketStore";

function App() {
  // Chọn từng field một: destructure cả store khiến App — nơi chứa router — re-render
  // mỗi lần có bất kỳ thay đổi nào trong store, kể cả một người lạ vừa online.
  const isDark = useThemeStore((s) => s.isDark);
  const setTheme = useThemeStore((s) => s.setTheme);

  /*
   * Chỉ quan tâm "đã đăng nhập hay chưa", không quan tâm token là chuỗi gì.
   *
   * Bản trước đặt `accessToken` vào dependency, nên MỖI lần làm mới token (15 phút
   * một lần, hoặc mỗi lần gặp 401) socket bị đóng rồi mở lại — presence của người
   * dùng nhấp nháy với tất cả bạn bè, và mọi room phải join lại.
   */
  const isAuthenticated = useAuthStore((s) => Boolean(s.accessToken));

  // Số chưa đọc hiển thị ngay trên tiêu đề tab và favicon.
  useUnreadBadge();

  useEffect(() => {
    setTheme(isDark);
  }, [isDark, setTheme]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const { connectSocket, disconnectSocket } = useSocketStore.getState();

    connectSocket();

    return () => disconnectSocket();
  }, [isAuthenticated]);

  // Báo cho server biết tab đang ẩn / người dùng không tương tác, để trạng thái
  // "away" là do server quyết định chứ không phải client tự vẽ.
  useEffect(() => {
    if (!isAuthenticated) return;

    const report = () =>
      useSocketStore.getState().setAway(document.visibilityState === "hidden");

    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [isAuthenticated]);

  return (
    <ErrorBoundary>
      <Toaster
        richColors
        // Không có prop này, toast luôn ở giao diện sáng dù app đang ở chế độ tối.
        theme={isDark ? "dark" : "light"}
        /*
          Trên đỉnh, không phải góc dưới phải (mặc định của sonner).

          Góc dưới phải đúng chỗ nút Gửi. Toast "có tin nhắn mới" thêm ở Phase 8
          nghĩa là mỗi lần ai đó nhắn tới trong lúc bạn đang soạn, nút Gửi bị che
          mất vài giây — bấm vào chỉ trúng toast. Chuyển lên trên là xong, không
          cần z-index hay offset gì thêm.
        */
        position="top-center"
      />
      <BrowserRouter>
        <Routes>
          {/* public routes */}
          <Route
            path="/signin"
            element={<SignInPage />}
          />
          <Route
            path="/signup"
            element={<SignUpPage />}
          />

          {/* protectect routes */}
          <Route element={<ProtectedRoute />}>
            <Route
              path="/"
              element={<ChatAppPage />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
