import { useCallback, useEffect, useRef } from "react";

/**
 * Gỡ `pointer-events: none` bị kẹt lại trên <body> sau khi đóng modal.
 *
 * Mọi lớp modal của Radix (Dialog, AlertDialog, Sheet, DropdownMenu ở chế độ
 * modal) đều đặt `document.body.style.pointerEvents = "none"` lúc mở và khôi phục
 * lúc đóng. Nhưng giá trị "trước đó" được nhớ trong MỘT biến cấp module dùng chung
 * cho tất cả các lớp, và chỉ được ghi lại khi tập lớp đang mở rỗng
 * (`@radix-ui/react-dismissable-layer/dist/index.mjs:68-91`).
 *
 * Khi hai lớp chồng nhau — menu đóng đúng lúc hộp thoại xác nhận mở, hoặc một
 * Dialog nằm trong một Sheet đang mở — lớp mới có thể ghi lại giá trị "trước đó"
 * ĐÚNG LÚC <body> vẫn còn "none" của lớp cũ. Từ đó "none" trở thành giá trị được
 * khôi phục, nên đóng hết modal xong cả trang chết cứng cho tới khi F5.
 *
 * Đây là lớp bảo hiểm cuối: chỉ dọn khi CHẮC CHẮN không còn overlay nào đang mở,
 * nên nó không bao giờ mở khoá nhầm một modal vẫn còn hiển thị.
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-radix-menu-content][data-state="open"]',
  // Popover/tooltip/dropdown đang mở đều nằm trong wrapper này.
  "[data-radix-popper-content-wrapper]",
].join(", ");

export const hasOpenOverlay = () =>
  document.querySelector(OPEN_OVERLAY_SELECTOR) !== null;

export const releaseStuckPointerEvents = () => {
  if (typeof document === "undefined") return;
  if (document.body.style.pointerEvents !== "none") return;
  if (hasOpenOverlay()) return;

  document.body.style.removeProperty("pointer-events");
};

/**
 * Đợi hai frame trước khi dọn.
 *
 * Radix tháo lớp modal sau khi animation đóng chạy xong, nên kiểm tra ngay trong
 * cùng một tick sẽ thấy overlay vẫn còn trong DOM và bỏ qua. Hai frame là đủ để
 * commit tháo lớp đã xong, mà vẫn nhanh hơn mức người dùng kịp bấm chuột.
 */
const scheduleRelease = () => {
  if (typeof requestAnimationFrame === "undefined") {
    releaseStuckPointerEvents();
    return () => {};
  }

  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(releaseStuckPointerEvents);
  });

  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
};

/**
 * Bọc `onOpenChange` của một overlay để tự dọn sau mỗi lần đóng.
 *
 * Dùng `onOpenChange` chứ không phải prop `open`: các overlay trong app có cả loại
 * controlled lẫn uncontrolled, và loại uncontrolled không bao giờ đổi `open` để mà
 * theo dõi. Radix gọi `onOpenChange` trong cả hai trường hợp.
 */
export const useOverlayPointerEventsGuard = (
  onOpenChange?: (open: boolean) => void,
) => {
  const cancelRef = useRef<(() => void) | null>(null);

  const schedule = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = scheduleRelease();
  }, []);

  // Overlay bị unmount trong lúc đang mở (đổi route, component cha biến mất) thì
  // không có `onOpenChange` nào được gọi cả — vẫn phải dọn.
  useEffect(() => {
    return () => {
      cancelRef.current?.();
      cancelRef.current = scheduleRelease();
    };
  }, []);

  return useCallback(
    (open: boolean) => {
      onOpenChange?.(open);
      if (!open) schedule();
    },
    [onOpenChange, schedule],
  );
};
