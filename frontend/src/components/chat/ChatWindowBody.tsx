import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import InfiniteScroll from "react-infinite-scroll-component";
import ChatWelcomeScreen from "./ChatWelcomeScreen";
import MessageItem from "./MessageItem";
import TypingIndicator from "./TypingIndicator";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import {
  useActiveConversation,
  useChatStore,
  useMessageIds,
  useThreadHasMore,
  useThreadStatus,
} from "@/stores/useChatStore";

/**
 * Danh sách tin nhắn.
 *
 * TODO(Phase 5): thay `react-infinite-scroll-component` và cấu trúc scroll ở đây.
 * Hiện tại container bên trong không có ràng buộc chiều cao nên nó không thực sự
 * cuộn, khiến `scrollableTarget` không bao giờ bắn — tức phân trang lùi gần như
 * không hoạt động. Phase này chỉ chuyển sang store đã chuẩn hoá; phần layout và
 * cuộn được xử lý riêng ở Phase 5 để diff dễ đọc.
 */
const ChatWindowBody = () => {
  const selectedConvo = useActiveConversation();
  const conversationId = selectedConvo?._id ?? null;

  const ids = useMessageIds(conversationId);
  const hasMore = useThreadHasMore(conversationId);
  const status = useThreadStatus(conversationId);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Đánh dấu đã đọc khi tab đang hiển thị (xem useMarkAsRead).
  useMarkAsRead(conversationId, selectedConvo?.unreadCount ?? 0);

  // Lấy nội dung tin nhắn từ store một lần cho mỗi lần `ids` đổi.
  const messages = useChatStore((s) =>
    conversationId ? s.messages[conversationId]?.byId : undefined,
  );

  const ordered = useMemo(
    () => (messages ? ids.map((id) => messages[id]).filter(Boolean) : []),
    [ids, messages],
  );

  const reversed = useMemo(() => [...ordered].reverse(), [ordered]);

  // Tải trang đầu khi mở một cuộc trò chuyện chưa có dữ liệu.
  useEffect(() => {
    if (conversationId && status === "idle") {
      void useChatStore.getState().fetchMessages(conversationId);
    }
  }, [conversationId, status]);

  // Kéo xuống dưới khi đổi cuộc trò chuyện.
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [conversationId]);

  if (!selectedConvo) return <ChatWelcomeScreen />;

  if (status === "loading" && ordered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Đang tải tin nhắn…
      </div>
    );
  }

  if (status === "error" && ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>Không tải được tin nhắn.</p>
        <button
          type="button"
          onClick={() => void useChatStore.getState().fetchMessages(conversationId!)}
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
        <p>Chưa có tin nhắn nào.</p>
        <p className="text-sm">Hãy gửi lời chào để bắt đầu.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-foreground p-4">
      <div
        id="scrollableDiv"
        className="beautiful-scrollbar flex flex-col-reverse overflow-y-auto overflow-x-hidden"
      >
        <div ref={messagesEndRef} />

        <TypingIndicator conversationId={selectedConvo._id} />

        <InfiniteScroll
          dataLength={ordered.length}
          next={() => void useChatStore.getState().fetchMessages(selectedConvo._id)}
          hasMore={hasMore}
          scrollableTarget="scrollableDiv"
          loader={
            <p className="py-2 text-center text-xs text-muted-foreground">Đang tải…</p>
          }
          inverse
          style={{ display: "flex", flexDirection: "column-reverse", overflow: "visible" }}
        >
          {reversed.map((message, index) => (
            <MessageItem
              key={message._id}
              message={message}
              index={index}
              messages={reversed}
              selectedConvo={selectedConvo}
            />
          ))}
        </InfiniteScroll>
      </div>
    </div>
  );
};

export default ChatWindowBody;
