import { useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "../ui/button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  /**
   * Chạy sau khi hộp thoại đã đóng, và CHỈ khi người dùng đã xác nhận — bấm "Huỷ"
   * hay Esc thì không gọi.
   *
   * Dành cho việc đóng luôn lớp bao ngoài (ví dụ bảng thông tin nhóm). Làm việc đó
   * ngay trong `onConfirm` nghĩa là hai lớp modal cùng đóng trong một tick, và sổ
   * sách `pointer-events` của Radix để lại `none` trên <body> — cả trang chết cứng.
   */
  onConfirmedClose?: () => void;
  destructive?: boolean;
}

/**
 * Xác nhận cho hành động không hoàn tác được.
 *
 * Gom về một chỗ thay vì tự dựng modal ở bốn nơi (xoá thành viên, rời nhóm, xoá
 * nhóm, gỡ ảnh nhóm) — vừa đỡ lặp, vừa đảm bảo tất cả cùng một hành vi bàn phím và
 * cùng một cách nhấn mạnh hành động phá huỷ.
 */
const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  onConfirmedClose,
  destructive = true,
}: ConfirmDialogProps) => {
  const confirmed = useRef(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (next) {
          confirmed.current = false;
          return;
        }

        if (confirmed.current) {
          confirmed.current = false;
          onConfirmedClose?.();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true;
              onConfirm();
            }}
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmDialog;
