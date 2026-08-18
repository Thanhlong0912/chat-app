import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SpinnerProps = {
  className?: string;
  /**
   * Chỉ truyền khi spinner đứng MỘT MÌNH, không có chữ đi kèm.
   *
   * Cạnh một dòng chữ như "Đang tải tin nhắn…" thì spinner chỉ là trang trí —
   * gắn nhãn cho nó khiến screen reader đọc trạng thái hai lần. Nên mặc định là
   * aria-hidden, và chỉ thông báo khi người gọi nói rõ là cần.
   */
  label?: string;
};

/** Chỉ báo đang tải. Tôn trọng `prefers-reduced-motion` qua tiện ích `animate-spin`. */
export const Spinner = ({ className, label }: SpinnerProps) =>
  label ? (
    <Loader2
      role="status"
      aria-label={label}
      className={cn("size-4 animate-spin", className)}
    />
  ) : (
    <Loader2
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    />
  );

export default Spinner;
