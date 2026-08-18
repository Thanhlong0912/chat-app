import { Search, X } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useChatStore } from "@/stores/useChatStore";

/**
 * Lọc danh sách cuộc trò chuyện.
 *
 * Lọc phía client trên dữ liệu đã tải: danh sách cuộc trò chuyện của một người
 * hiếm khi lớn, nên gọi server cho việc này chỉ thêm độ trễ mà không được gì.
 *
 * Tìm kiếm trong NỘI DUNG tin nhắn thì khác hẳn và cần Atlas Search — index text
 * của MongoDB không có bộ phân tích tiếng Việt và không bỏ dấu, nên độ chính xác
 * sẽ tệ. Đó là việc để sau, không phải làm qua loa ở đây.
 */
const ConversationSearch = () => {
  const query = useChatStore((s) => s.searchQuery);
  const setSearchQuery = useChatStore((s) => s.setSearchQuery);

  return (
    <div className="relative px-1">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />

      <Input
        value={query}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Tìm cuộc trò chuyện..."
        aria-label="Tìm cuộc trò chuyện"
        className="bg-background pl-9 pr-9"
      />

      {query && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchQuery("")}
          aria-label="Xoá tìm kiếm"
          className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
};

export default ConversationSearch;
