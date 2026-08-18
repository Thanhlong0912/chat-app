import { useEffect } from "react";
import { useChatStore } from "@/stores/useChatStore";
import { setUnreadBadge } from "@/lib/notifications";

/**
 * Giữ tiêu đề tab và favicon đồng bộ với tổng số tin chưa đọc.
 *
 * Rẻ, và là dấu hiệu duy nhất người dùng nhìn thấy khi tab đang ở chế độ nền mà họ
 * chưa bật thông báo trình duyệt.
 */
export function useUnreadBadge() {
  const total = useChatStore((s) =>
    Object.values(s.conversationsById).reduce(
      (sum, conversation) => sum + (conversation.unreadCount ?? 0),
      0,
    ),
  );

  useEffect(() => {
    setUnreadBadge(total);
  }, [total]);

  // Trả lại tiêu đề sạch khi rời trang.
  useEffect(() => () => setUnreadBadge(0), []);
}
