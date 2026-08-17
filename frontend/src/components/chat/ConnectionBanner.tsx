import { Loader2, WifiOff } from "lucide-react";
import { useConnectionStatus } from "@/stores/useSocketStore";

/**
 * Cho người dùng biết realtime đang gián đoạn.
 *
 * Trước đây mất kết nối là hoàn toàn im lặng: tin nhắn ngừng đến mà không có dấu
 * hiệu nào, nên người dùng chỉ nghĩ là không ai trả lời.
 */
const ConnectionBanner = () => {
  const status = useConnectionStatus();

  if (status === "connected" || status === "idle" || status === "connecting") return null;

  const reconnecting = status === "reconnecting";

  return (
    <div
      // `polite` chứ không phải `assertive`: đây là thông tin trạng thái, không nên
      // cắt ngang thứ screen reader đang đọc.
      role="status"
      aria-live="polite"
      className={
        reconnecting
          ? "flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300"
          : "flex items-center justify-center gap-2 bg-destructive/15 px-4 py-1.5 text-xs text-destructive"
      }
    >
      {reconnecting ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Đang kết nối lại…
        </>
      ) : (
        <>
          <WifiOff className="size-3.5" />
          Mất kết nối. Tin nhắn mới có thể chưa được cập nhật.
        </>
      )}
    </div>
  );
};

export default ConnectionBanner;
