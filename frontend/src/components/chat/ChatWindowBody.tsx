import { useCallback, useEffect, useMemo } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import ChatWelcomeScreen from "./ChatWelcomeScreen";
import MessageItem from "./MessageItem";
import TypingIndicator from "./TypingIndicator";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useChatScroll } from "@/hooks/useChatScroll";
import {
  useActiveConversation,
  useChatStore,
  useMessageIds,
  useThreadHasMore,
  useThreadStatus,
} from "@/stores/useChatStore";

const ChatWindowBody = () => {
  const selectedConvo = useActiveConversation();
  const conversationId = selectedConvo?._id ?? null;

  const ids = useMessageIds(conversationId);
  const hasMore = useThreadHasMore(conversationId);
  const status = useThreadStatus(conversationId);

  const byId = useChatStore((s) =>
    conversationId ? s.messages[conversationId]?.byId : undefined,
  );

  // Thứ tự thuận: cũ → mới. Bản cũ đảo mảng rồi lại dùng `flex-col-reverse` để đảo
  // ngược lần nữa về mặt hình ảnh — đúng kết quả nhưng rất khó lần theo, và làm thứ
  // tự DOM ngược với thứ tự đọc.
  const messages = useMemo(
    () => (byId ? ids.map((id) => byId[id]).filter(Boolean) : []),
    [ids, byId],
  );

  const loadOlder = useCallback(() => {
    if (conversationId) void useChatStore.getState().fetchMessages(conversationId);
  }, [conversationId]);

  const { containerRef, topSentinelRef, isAtBottom, unseenCount, scrollToBottom } =
    useChatScroll({
      conversationId,
      messageIds: ids,
      hasMore,
      isLoading: status === "loading",
      onLoadOlder: loadOlder,
    });

  useMarkAsRead(conversationId, selectedConvo?.unreadCount ?? 0);

  // Tải trang đầu khi luồng chưa có dữ liệu. Cần cho trường hợp
  // `activeConversationId` được khôi phục từ localStorage sau khi tải lại trang —
  // lúc đó không có cú click nào để `useSelectConversation` bắt được.
  useEffect(() => {
    if (conversationId && status === "idle") {
      void useChatStore.getState().fetchMessages(conversationId);
    }
  }, [conversationId, status]);

  if (!selectedConvo) return <ChatWelcomeScreen />;

  const isEmpty = messages.length === 0;

  return (
    // `relative` để đặt pill và nút xuống đáy; `min-h-0` để phần tử cuộn bên trong
    // co lại được trong grid row.
    <div className="relative min-h-0 bg-primary-foreground">
      <div
        ref={containerRef}
        // Đúng MỘT phần tử cuộn, có chiều cao xác định.
        className="beautiful-scrollbar h-full overflow-y-auto overflow-x-hidden px-4 py-3"
        // Danh sách tin nhắn là một log: screen reader cần biết nó tự cập nhật.
        role="log"
        aria-live="polite"
        aria-label="Tin nhắn"
      >
        {/*
          Sentinel trên đỉnh — thay cho react-infinite-scroll-component.

          Phải có chiều cao thật (`h-px`). Một phần tử cao 0px không có diện tích
          giao nhau, và IntersectionObserver sẽ không bao giờ báo `isIntersecting`
          cho nó — sentinel sẽ im lặng không bao giờ bắn.
        */}
        {hasMore && <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />}

        {status === "loading" && !isEmpty && (
          <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Đang tải tin nhắn cũ hơn…
          </p>
        )}

        {status === "loading" && isEmpty && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang tải tin nhắn…
          </div>
        )}

        {status === "error" && isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>Không tải được tin nhắn.</p>
            <button
              type="button"
              onClick={loadOlder}
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground transition-smooth hover:opacity-90"
            >
              Thử lại
            </button>
          </div>
        )}

        {status !== "loading" && status !== "error" && isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
            <p>Chưa có tin nhắn nào.</p>
            <p className="text-sm">Hãy gửi lời chào để bắt đầu.</p>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageItem
            key={message._id}
            message={message}
            index={index}
            messages={messages}
            selectedConvo={selectedConvo}
          />
        ))}

        <TypingIndicator conversationId={selectedConvo._id} />
      </div>

      {/* Pill "tin nhắn mới": chỉ hiện khi người dùng đang đọc tin cũ, nên tin nhắn
          mới không bao giờ giật khung nhìn của họ. */}
      {unseenCount > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-glow transition-smooth hover:scale-105"
        >
          <ArrowDown className="size-3.5" />
          {unseenCount} tin nhắn mới
        </button>
      )}

      {/* Nút xuống đáy, hiện khi đã cuộn lên xa. */}
      {!isAtBottom && unseenCount === 0 && !isEmpty && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label="Xuống tin nhắn mới nhất"
          className="absolute bottom-4 right-4 flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-soft transition-smooth hover:text-foreground"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
};

export default ChatWindowBody;
