import { cn } from "@/lib/utils";

const Bar = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-md bg-muted", className)} />
);

/**
 * Skeleton của khung chat.
 *
 * Vẽ đúng hình dạng thật: header, các bong bóng so le hai bên, và composer. Bản cũ
 * vẽ một vòng tròn lớn giữa màn hình kèm hai vạch — tức hình dạng của MÀN HÌNH CHÀO,
 * nên lúc chuyển sang nội dung thật thì layout nhảy hoàn toàn.
 */
const ChatWindowSkeleton = () => {
  return (
    <div
      className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      role="status"
      aria-label="Đang tải cuộc trò chuyện"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="size-12 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <Bar className="h-3.5 w-32" />
          <Bar className="h-2.5 w-20" />
        </div>
      </div>

      {/* Tin nhắn — so le để giống luồng thật */}
      <div className="space-y-3 overflow-hidden bg-primary-foreground px-4 py-3">
        {[
          { own: false, width: "w-40" },
          { own: false, width: "w-28" },
          { own: true, width: "w-48" },
          { own: false, width: "w-36" },
          { own: true, width: "w-24" },
          { own: true, width: "w-44" },
        ].map((row, index) => (
          <div
            key={index}
            className={cn("flex items-end gap-2", row.own ? "justify-end" : "justify-start")}
          >
            {!row.own && <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />}
            <Bar className={cn("h-9 rounded-2xl", row.width)} />
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 p-3">
        <div className="size-9 animate-pulse rounded-md bg-muted" />
        <Bar className="h-9 flex-1 rounded-md" />
        <div className="size-9 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
};

export default ChatWindowSkeleton;
