import { cn } from "@/lib/utils";
import type { Conversation, ReplyToSnapshot } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";

/**
 * Trích dẫn tin nhắn được trả lời, hiển thị trong bong bóng.
 *
 * Dùng ảnh chụp mà server đã lưu kèm tin nhắn, KHÔNG tra ngược tin nhắn gốc: nhờ
 * vậy trích dẫn hiển thị được cả khi tin gốc nằm ngoài trang đang tải, và không cần
 * thêm một lượt truy vấn nào cho mỗi trang 50 tin nhắn.
 */
const ReplyQuote = ({
  replyTo,
  conversation,
  isOwn,
}: {
  replyTo: ReplyToSnapshot;
  conversation: Conversation;
  isOwn: boolean;
}) => {
  const meId = useAuthStore((s) => s.user?._id);

  const authorName =
    replyTo.senderId === meId
      ? "Bạn"
      : (conversation.participants.find((p) => p._id === replyTo.senderId)?.displayName ??
        "Một thành viên");

  const jumpToOriginal = () => {
    const target = document.querySelector(`[data-message-id="${replyTo.messageId}"]`);

    if (!target) {
      // Tin gốc nằm ngoài phần đã tải. Không cố lật ngược nhiều trang ở đây —
      // giữ hành vi đơn giản và đoán được.
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-2", "ring-primary");
    setTimeout(() => target.classList.remove("ring-2", "ring-primary"), 1200);
  };

  return (
    <button
      type="button"
      onClick={jumpToOriginal}
      className={cn(
        "mb-1 flex w-full flex-col gap-0.5 rounded-md border-l-2 px-2 py-1 text-left text-xs",
        isOwn
          ? "border-white/60 bg-white/15 text-white/90"
          : "border-primary/50 bg-primary/5 text-muted-foreground",
      )}
    >
      <span className="font-medium">{authorName}</span>
      <span className="line-clamp-2 opacity-90">
        {replyTo.contentSnapshot ?? (
          <span className="italic">
            {replyTo.kindSnapshot === "image" ? "Hình ảnh" : "Tin nhắn đã bị xoá"}
          </span>
        )}
      </span>
    </button>
  );
};

export default ReplyQuote;
