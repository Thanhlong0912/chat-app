import { useRef } from "react";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";

/**
 * Id tin nhắn chưa đọc ĐẦU TIÊN khi mở cuộc trò chuyện.
 *
 * Chốt lại một lần và giữ nguyên cho tới khi đổi cuộc trò chuyện. Nếu tính động
 * theo `lastReadAt` thì `markAsSeen` sẽ đẩy con trỏ xuống ngay sau khi mở, và vạch
 * ngăn biến mất trước cả khi người dùng kịp nhìn.
 */
export function useUnreadAnchor(conversationId: string | null) {
  const anchor = useRef<string | null>(null);
  const anchoredFor = useRef<string | null>(null);
  const pinned = useRef(false);

  const thread = useChatStore((s) =>
    conversationId ? s.messages[conversationId] : undefined,
  );

  /*
    Đặt lại NGAY TRONG render, không phải trong useEffect.

    Effect chạy sau khi render xong, nên ở lần render đầu tiên của cuộc trò chuyện
    mới, ref vẫn còn giữ vạch của cuộc trò chuyện trước. Việc đặt lại này chỉ phụ
    thuộc `conversationId` nên chạy bao nhiêu lần cũng ra cùng kết quả — an toàn
    trong render, khác với việc ghi ref dựa trên dữ liệu đang đổi.
  */
  if (anchoredFor.current !== conversationId) {
    anchoredFor.current = conversationId;
    anchor.current = null;
    pinned.current = false;
  }

  // Chưa tải xong thì CHƯA chốt. Chốt trên một luồng rỗng sẽ khoá vĩnh viễn ở
  // "không có vạch", vì sau đó không còn lần tính nào nữa.
  if (!conversationId || !thread || thread.ids.length === 0) return null;

  if (pinned.current) return anchor.current;

  const meId = useAuthStore.getState().user?._id;
  const conversation = useChatStore.getState().conversationsById[conversationId];
  const lastReadAt = conversation?.participants.find((p) => p._id === meId)?.lastReadAt;

  if (!lastReadAt || conversation?.unreadCount === 0) {
    // Vẫn phải chốt: nếu để ngỏ, hàm sẽ tính lại ở mỗi lần render, và một kết quả
    // "không có vạch" sẽ không bao giờ ổn định lại được.
    pinned.current = true;
    anchor.current = null;
    return null;
  }

  const readUntil = new Date(lastReadAt).getTime();

  const firstUnread = thread.ids.find((id) => {
    const message = thread.byId[id];
    if (!message || message.senderId === meId) return false;
    return new Date(message.createdAt).getTime() > readUntil;
  });

  pinned.current = true;
  anchor.current = firstUnread ?? null;
  return anchor.current;
}
