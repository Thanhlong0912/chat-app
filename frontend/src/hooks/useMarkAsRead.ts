import { useEffect } from "react";
import { useChatStore } from "@/stores/useChatStore";

/** Chờ một nhịp trước khi đánh dấu đã đọc, để lướt nhanh qua không tính là đã đọc. */
const DEBOUNCE_MS = 400;

/**
 * Đánh dấu đã đọc khi người dùng đang thực sự nhìn vào cuộc trò chuyện.
 *
 * Hai điểm khác với bản trước:
 *
 * 1. Có kiểm tra hiển thị. Trước đây chỉ cần "là conversation đang chọn" là đánh dấu
 *    đã đọc — nên một tab bị ẩn ở chế độ nền vẫn âm thầm đọc hết tin nhắn của bạn.
 * 2. Không nằm trong handler socket. Bản trước gọi markAsSeen ngay trong handler
 *    `new-message` và gọi TRƯỚC khi cập nhật số chưa đọc, nên nó đọc giá trị cũ (0),
 *    thoát sớm, rồi badge mới được ghi vào và đứng lại ở trạng thái sai.
 */
export function useMarkAsRead(conversationId: string | null | undefined, unreadCount: number) {
  useEffect(() => {
    if (!conversationId || unreadCount === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      if (document.visibilityState !== "visible") return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void useChatStore.getState().markAsSeen(conversationId);
      }, DEBOUNCE_MS);
    };

    attempt();

    // Quay lại tab thì thử lại — lúc bị ẩn ta đã cố tình không đánh dấu.
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("focus", attempt);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("focus", attempt);
    };
  }, [conversationId, unreadCount]);
}
