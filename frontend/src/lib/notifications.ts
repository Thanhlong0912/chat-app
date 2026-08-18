/**
 * Thông báo của trình duyệt.
 *
 * Cố tình KHÔNG dùng Web Push / service worker: đường đó cần lưu subscription,
 * khoá VAPID và một service worker, mà chỉ có giá trị khi tab đã đóng hẳn. Ở đây
 * chỉ cần thông báo khi tab bị ẩn — Notification API là đủ và không thêm hạ tầng.
 */

export type NotificationPermissionState = "unsupported" | NotificationPermission;

export const isSupported = () => typeof window !== "undefined" && "Notification" in window;

export function getPermission(): NotificationPermissionState {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Xin quyền thông báo.
 *
 * CHỈ được gọi từ một hành động rõ ràng của người dùng (bấm nút bật thông báo),
 * không bao giờ tự gọi lúc tải trang: Chrome phạt các site xin quyền ngay khi vào,
 * và Safari đơn giản là bỏ qua nếu không có cử chỉ người dùng.
 */
export async function requestPermission(): Promise<NotificationPermissionState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;

  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

interface NotifyOptions {
  title: string;
  body: string;
  /** Dùng làm `tag` để nhiều tin nhắn cùng cuộc trò chuyện gộp thành một. */
  conversationId: string;
  icon?: string;
  onClick?: () => void;
}

/**
 * Hiện một thông báo, nếu điều kiện cho phép.
 *
 * Trả về `false` khi không hiện, để chỗ gọi biết mà rơi về toast trong ứng dụng.
 */
export function notify({
  title,
  body,
  conversationId,
  icon,
  onClick,
}: NotifyOptions): boolean {
  if (!isSupported() || Notification.permission !== "granted") return false;

  /*
   * Chỉ thông báo khi tab đang bị ẩn.
   *
   * Người dùng đang nhìn thẳng vào cuộc trò chuyện mà vẫn bắn thông báo hệ thống
   * là phiền và trùng lặp — đó chính là yêu cầu "tránh thông báo trùng khi
   * conversation đang mở".
   */
  if (document.visibilityState === "visible") return false;

  try {
    const notification = new Notification(title, {
      body,
      icon: icon ?? "/logo.svg",
      // Cùng `tag` thì thông báo mới THAY THẾ thông báo cũ, nên một loạt tin nhắn
      // không tạo ra một chồng thông báo.
      tag: `moji:${conversationId}`,
      renotify: false,
    } as NotificationOptions);

    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };

    return true;
  } catch {
    return false;
  }
}

/*
 * Bộ đếm chưa đọc trên tiêu đề tab và chấm trên favicon.
 *
 * Rẻ, và là dấu hiệu duy nhất người dùng thấy được khi tab đang ở chế độ nền mà
 * họ chưa bật thông báo trình duyệt.
 */
const BASE_TITLE = "Moji";
let faviconEl: HTMLLinkElement | null = null;
let baseFaviconHref: string | null = null;

export function setUnreadBadge(count: number) {
  document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;

  faviconEl ??= document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!faviconEl) return;

  baseFaviconHref ??= faviconEl.href;

  if (count === 0) {
    faviconEl.href = baseFaviconHref;
    return;
  }

  drawFaviconDot(baseFaviconHref).then((dataUrl) => {
    if (dataUrl && faviconEl) faviconEl.href = dataUrl;
  });
}

/** Vẽ lại favicon kèm một chấm đỏ ở góc. */
function drawFaviconDot(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);

      ctx.drawImage(image, 0, 0, size, size);

      ctx.beginPath();
      ctx.arc(size - 18, 18, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();

      resolve(canvas.toDataURL("image/png"));
    };

    // SVG từ cùng origin nên vẽ được lên canvas; nếu lỗi thì bỏ qua chấm đỏ.
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
