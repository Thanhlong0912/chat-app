import { Pin } from "lucide-react";
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
  /** Ghim: hiện một dấu nhỏ để người dùng biết vì sao dòng này nằm trên cùng. */
  pinned?: boolean;
  /**
   * Menu thao tác, render như ANH EM của <button> chứ không nằm trong nó.
   *
   * Lồng một button trong button là HTML không hợp lệ và làm hỏng điều hướng bàn
   * phím — đúng lỗi đã phải sửa hai lần ở sidebar. Vì vậy card được bọc trong một
   * `div.relative`, và menu được định vị tuyệt đối bên trên.
   */
  actions?: React.ReactNode;
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
  pinned,
  actions,
}: ChatCardProps) => {
  const hasUnread = Boolean(unreadCount && unreadCount > 0);

  return (
    <div className="group/card relative">
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
          {/* Chừa chỗ cho nút menu luôn hiện trên mobile; từ `md` trở lên nút chỉ
              xuất hiện khi hover nên không cần padding. */}
          <div
            className={cn(
              "mb-1 flex items-center justify-between gap-2",
              actions && "pr-7 md:pr-0",
            )}
          >
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

            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
                // Chỉ nhường chỗ cho nút menu khi nó thực sự hiện ra vì hover —
                // tức là từ `md` trở lên. Trên mobile nút luôn hiện, nên chỗ cho
                // nó được chừa sẵn bằng padding ở dưới thay vì giấu mất giờ.
                actions && "md:group-hover/card:opacity-0",
              )}
            >
              {pinned && (
                <Pin
                  className="size-3 fill-current"
                  aria-label="Đã ghim"
                />
              )}
              {timestamp ? formatOnlineTime(timestamp) : ""}
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-1">{subtitle}</div>
        </div>
      </div>
    </button>

      {/*
        Hiện SẴN trên mobile, chỉ ẩn-hiện theo hover từ `md` trở lên.

        Thiết bị cảm ứng không có hover: một nút chỉ xuất hiện khi `group-hover`
        là một nút không tồn tại trên điện thoại, nên ghim/tắt thông báo/lưu trữ
        sẽ hoàn toàn không với tới được ở đúng nơi ứng dụng này được dùng nhiều
        nhất. `focus-within` giữ cho bàn phím vẫn mở được nó trên desktop.
      */}
      {actions && (
        <div className="absolute right-2 top-2 transition-smooth md:opacity-0 md:focus-within:opacity-100 md:group-hover/card:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
};

export default ChatCard;
