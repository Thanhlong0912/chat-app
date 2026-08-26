import { useState } from "react";
import { Archive, ChevronDown } from "lucide-react";
import { useArchivedCount, useConversationIdsByType } from "@/stores/useChatStore";
import { cn } from "@/lib/utils";
import DirectMessageCard from "./DirectMessageCard";
import GroupChatCard from "./GroupChatCard";

/**
 * Ngăn "Lưu trữ", đóng sẵn.
 *
 * Lưu trữ phải LÀ MỘT NGĂN chứ không phải một cách xoá: nếu cuộc trò chuyện đã lưu
 * trữ không còn đường nào để mở lại thì người dùng vừa mất dữ liệu mà không hề
 * được cảnh báo. Ở đây chúng vẫn ở đó, chỉ là không chen vào danh sách chính.
 *
 * Cả ngăn tự ẩn khi chưa lưu trữ gì — một mục luôn hiện mà luôn rỗng chỉ làm rối
 * sidebar của phần lớn người dùng.
 */
const ArchivedList = () => {
  const [open, setOpen] = useState(false);
  const count = useArchivedCount();

  const directIds = useConversationIdsByType("direct", { archived: true });
  const groupIds = useConversationIdsByType("group", { archived: true });

  if (count === 0) return null;

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-smooth hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Archive
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 text-left">Lưu trữ</span>
        <span className="tabular-nums text-xs">{count}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-smooth", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-2 py-2">
          {groupIds.map((id) => (
            <GroupChatCard
              convoId={id}
              key={id}
            />
          ))}
          {directIds.map((id) => (
            <DirectMessageCard
              convoId={id}
              key={id}
            />
          ))}

          {/* Đang lọc tìm kiếm mà không khớp gì: nói rõ, thay vì để một ngăn mở ra
              trống trơn trông như lỗi. */}
          {groupIds.length === 0 && directIds.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Không có mục lưu trữ nào khớp.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ArchivedList;
