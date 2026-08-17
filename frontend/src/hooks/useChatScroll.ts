import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Coi là "đang ở đáy" nếu còn cách đáy dưới ngưỡng này. */
const BOTTOM_THRESHOLD_PX = 80;

/** Cách đỉnh dưới ngưỡng này thì bắt đầu tải tin cũ hơn. */
const LOAD_OLDER_THRESHOLD_PX = 250;

/** Khoảng tiết chế cho việc đo vị trí cuộn. */
const SCROLL_THROTTLE_MS = 100;

interface Options {
  /** Id cuộc trò chuyện — đổi giá trị này thì nhảy thẳng xuống đáy. */
  conversationId: string | null;
  /** Id các tin nhắn, cũ → mới. Dùng để phát hiện prepend và tin nhắn mới. */
  messageIds: string[];
  /** Còn tin cũ hơn để tải không. */
  hasMore: boolean;
  /** Đang tải — chặn sentinel bắn lặp. */
  isLoading: boolean;
  /** Gọi khi sentinel trên đỉnh lọt vào khung nhìn. */
  onLoadOlder: () => void;
}

/**
 * Hành vi cuộn của khung tin nhắn.
 *
 * Thay cho `react-infinite-scroll-component` (không còn được bảo trì từ 2021) và
 * cho cả mớ logic cuộn cũ. Bản cũ có ba vấn đề chồng lên nhau:
 *
 *  1. Có HAI phần tử cuộn lồng nhau, và phần tử bên trong không có ràng buộc chiều
 *     cao nên nó không bao giờ cuộn — `scrollableTarget` trỏ vào nó, nên sự kiện
 *     scroll không bao giờ bắn và phân trang lùi coi như không hoạt động.
 *  2. `flex-col-reverse` khiến thứ tự DOM ngược với thứ tự đọc, làm hỏng cả điều
 *     hướng bàn phím và screen reader. Ở đây dùng thứ tự thuận.
 *  3. Effect khôi phục vị trí cuộn phụ thuộc `[messages.length]`, nên MỖI tin nhắn
 *     mới lại kéo khung nhìn về một offset đã lưu, tranh chấp với `scrollIntoView`.
 *     Bản này neo vị trí chỉ khi thực sự prepend, và chỉ tự cuộn khi người dùng
 *     đang ở đáy.
 */
export function useChatScroll({
  conversationId,
  messageIds,
  hasMore,
  isLoading,
  onLoadOlder,
}: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  // Trạng thái dùng để so sánh giữa các lần render.
  const prevOldestId = useRef<string | undefined>(undefined);
  const prevNewestId = useRef<string | undefined>(undefined);
  const prevScrollHeight = useRef(0);
  const prevConversationId = useRef<string | null>(null);
  /**
   * Chưa nhảy xuống đáy cho cuộc trò chuyện hiện tại.
   *
   * Cần một cờ riêng vì lúc `conversationId` đổi thì danh sách tin nhắn thường CÒN
   * RỖNG (đang fetch). Nếu chỉ xử lý ở thời điểm đó thì khi dữ liệu về, cả nhánh
   * prepend và append đều không khớp (không có giá trị "trước đó" để so), và khung
   * nhìn nằm lại ở đâu đó giữa luồng thay vì ở tin mới nhất.
   */
  const needsInitialScroll = useRef(true);

  const oldestId = messageIds[0];
  const newestId = messageIds[messageIds.length - 1];

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;

    el.scrollTo({ top: el.scrollHeight, behavior });
    setUnseenCount(0);
  }, []);

  // Giữ giá trị mới nhất cho scroll handler, để handler không phải đăng ký lại mỗi
  // lần các giá trị này đổi.
  const loadOlderRef = useRef(onLoadOlder);
  const canLoadOlderRef = useRef(false);

  loadOlderRef.current = onLoadOlder;
  canLoadOlderRef.current = hasMore && !isLoading;

  /** Theo dõi vị trí cuộn, gộp theo animation frame. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastRunAt = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      lastRunAt = Date.now();

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX;

      setIsAtBottom(atBottom);
      if (atBottom) setUnseenCount(0);

      /*
       * Dự phòng cho việc tải thêm tin cũ, song song với IntersectionObserver.
       *
       * Không phải trang trí: nếu chỉ dựa vào IO thì ở bất cứ môi trường nào IO
       * không hoạt động (hoặc bị hạn chế), phân trang sẽ chết lặng — đúng loại lỗi
       * mà cả phase này đang sửa. Kiểm tra vị trí cuộn thì rẻ và luôn đúng. Hai
       * đường cùng bảo vệ nhau; `fetchMessages` đã idempotent nhờ cờ đang-tải nên
       * gọi trùng không gây hại.
       */
      if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX && canLoadOlderRef.current) {
        loadOlderRef.current();
      }
    };

    /*
     * Tiết chế theo thời gian, KHÔNG dùng requestAnimationFrame.
     *
     * rAF không chạy khi tab bị ẩn, nên nếu gắn phần đo vào rAF thì ở trạng thái đó
     * việc tải thêm tin cũ sẽ không bao giờ xảy ra. Bộ đếm thời gian thì luôn chạy.
     * (Bản cũ tệ hơn nhiều: JSON.stringify + sessionStorage.setItem trên MỖI sự kiện
     * scroll, đủ để thấy giật khi lăn chuột nhanh.)
     */
    const handleScroll = () => {
      const elapsed = Date.now() - lastRunAt;

      if (elapsed >= SCROLL_THROTTLE_MS) {
        measure();
        return;
      }

      // Luôn đo thêm một lần ở cuối chuỗi, để không bỏ mất vị trí cuối cùng.
      if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          measure();
        }, SCROLL_THROTTLE_MS - elapsed);
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (trailing) clearTimeout(trailing);
    };
  }, []);

  /** Sentinel trên đỉnh: tải thêm tin cũ hơn. */
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const el = containerRef.current;

    if (!sentinel || !el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // `isLoading` được kiểm tra ở đây VÀ trong store: observer có thể bắn nhiều
        // lần trước khi request đầu tiên xong.
        if (entries[0]?.isIntersecting && !isLoading) onLoadOlder();
      },
      { root: el, rootMargin: "200px 0px 0px 0px" },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadOlder, conversationId]);

  /**
   * Định vị lại sau mỗi lần danh sách đổi.
   *
   * Dùng `useLayoutEffect` để chỉnh scrollTop trước khi browser vẽ, nếu không người
   * dùng sẽ thấy một cú nhảy.
   */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const conversationChanged = prevConversationId.current !== conversationId;
    const prependedOlder =
      !conversationChanged &&
      Boolean(oldestId) &&
      prevOldestId.current !== undefined &&
      prevOldestId.current !== oldestId;
    const appendedNewer =
      !conversationChanged &&
      Boolean(newestId) &&
      prevNewestId.current !== undefined &&
      prevNewestId.current !== newestId;

    if (conversationChanged) {
      needsInitialScroll.current = true;
    }

    if (needsInitialScroll.current) {
      // Xuống đáy ngay, không animation. Chỉ hạ cờ khi đã thực sự có tin nhắn để
      // cuộn tới — nếu hạ sớm lúc danh sách còn rỗng thì lần dữ liệu về đầu tiên sẽ
      // không còn nhánh nào xử lý.
      el.scrollTop = el.scrollHeight;
      setUnseenCount(0);
      setIsAtBottom(true);

      if (messageIds.length > 0) needsInitialScroll.current = false;
    } else if (prependedOlder) {
      /*
       * Neo vị trí sau khi chèn tin cũ lên đầu.
       *
       * Không có bước này, thêm nội dung phía trên sẽ đẩy mọi thứ xuống và người
       * dùng bị "bắn" đi khỏi chỗ đang đọc. Bản cũ có ĐO `scrollHeight` và lưu lại
       * — rồi không bao giờ dùng đến nó.
       */
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
    } else if (appendedNewer) {
      if (isAtBottom) {
        el.scrollTop = el.scrollHeight;
      } else {
        // Người dùng đang đọc tin cũ: KHÔNG giật họ xuống, chỉ đếm để hiện pill.
        setUnseenCount((count) => count + 1);
      }
    }

    prevOldestId.current = oldestId;
    prevNewestId.current = newestId;
    prevScrollHeight.current = el.scrollHeight;
    prevConversationId.current = conversationId;
    // `isAtBottom` và `messageIds.length` cố tình không nằm trong deps: chỉ cần đọc
    // giá trị hiện tại khi danh sách đổi, còn thêm vào sẽ khiến effect chạy lại mỗi
    // lần cuộn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, oldestId, newestId]);

  return {
    containerRef,
    topSentinelRef,
    isAtBottom,
    unseenCount,
    scrollToBottom,
  };
}
