import { formatOnlineTime, cn } from "@/lib/utils";

interface ChatCardProps {
  convoId: string;
  name: string;
  timestamp?: Date;
  isActive: boolean;
  onSelect: (id: string) => void;
  unreadCount?: number;
  leftSection: React.ReactNode;
  subtitle: React.ReactNode;
}

/**
 * Một dòng trong danh sách cuộc trò chuyện.
 *
 * Là `<button>` thật, không phải `<Card onClick>`. Đây là control điều hướng CHÍNH
 * của cả ứng dụng, mà trước đây nó là một div có onClick: không focus được bằng
 * bàn phím, không phản hồi Enter/Space, và screen reader không nhận ra nó là thứ
 * bấm được.
 */
const ChatCard = ({
  convoId,
  name,
  timestamp,
  isActive,
  onSelect,
  unreadCount,
  leftSection,
  subtitle,
}: ChatCardProps) => {
  const hasUnread = Boolean(unreadCount && unreadCount > 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(convoId)}
      // `aria-current` cho biết dòng nào đang mở, thông tin mà màu sắc đơn thuần
      // không truyền tải được.
      aria-current={isActive ? "true" : undefined}
      className={cn(
        // `group` là bắt buộc: các class `group-hover:` bên dưới trước đây không có
        // ancestor nào mang class này, nên affordance hover không bao giờ hiện ra.
        "group glass w-full rounded-lg border-none p-3 text-left transition-smooth",
        "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        isActive &&
          "bg-gradient-to-tr from-primary-glow/10 to-primary-foreground ring-2 ring-primary/50",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">{leftSection}</div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3
              className={cn(
                "truncate text-sm",
                // Chưa đọc thì đậm hơn hẳn. Trước đây "nhấn mạnh" là
                // `text-foreground` — đúng bằng màu mặc định, nên không đổi gì cả.
                hasUnread ? "font-bold text-foreground" : "font-medium text-foreground/90",
              )}
            >
              {name}
            </h3>

            <span className="shrink-0 text-xs text-muted-foreground">
              {timestamp ? formatOnlineTime(timestamp) : ""}
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-1">{subtitle}</div>
        </div>
      </div>
    </button>
  );
};

export default ChatCard;
