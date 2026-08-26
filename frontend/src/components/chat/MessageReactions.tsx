import { useChatStore, useReactions } from "@/stores/useChatStore";
import { cn } from "@/lib/utils";

/**
 * Dải chip biểu cảm dưới một bong bóng tin nhắn.
 *
 * Đăng ký hẹp qua `useReactions`, nên một lượt thả chỉ vẽ lại đúng bong bóng đó
 * chứ không phải cả luồng chat — cùng quy ước với `useMessage`.
 *
 * Mỗi chip là một toggle: bấm vào chip mình đã thả thì gỡ. Không có menu "gỡ"
 * riêng, vì trạng thái đã hiện rõ bằng viền và nền của chip.
 */
const MessageReactions = ({
  conversationId,
  messageId,
  align,
}: {
  conversationId: string;
  messageId: string;
  align: "start" | "end";
}) => {
  const reactions = useReactions(conversationId, messageId);

  if (reactions.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1 px-1",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() =>
            void useChatStore
              .getState()
              .toggleReaction(conversationId, messageId, reaction.emoji)
          }
          // Trạng thái được nói bằng chữ, không chỉ bằng màu: `aria-pressed` cho
          // screen reader biết mình đã thả hay chưa.
          aria-pressed={reaction.reactedByMe}
          aria-label={`${reaction.emoji}, ${reaction.count} lượt${
            reaction.reactedByMe ? ", bạn đã thả" : ""
          }`}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-smooth",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            reaction.reactedByMe
              ? "border-primary/50 bg-primary/15 font-medium text-foreground"
              : "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
          )}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
};

export default MessageReactions;
