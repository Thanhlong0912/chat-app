import { useChatStore, useConversationIdsByType } from "@/stores/useChatStore";
import DirectMessageCard from "./DirectMessageCard";

const DirectMessageList = () => {
  const ids = useConversationIdsByType("direct");
  const isSearching = useChatStore((s) => s.searchQuery.trim().length > 0);

  if (ids.length === 0) {
    // Phân biệt "chưa có gì" với "bộ lọc không khớp": gợi ý bắt đầu tin nhắn mới
    // trong khi người dùng đang gõ tìm kiếm chỉ khiến họ tưởng dữ liệu đã mất.
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        {isSearching
          ? "Không có cuộc trò chuyện nào khớp."
          : "Chưa có cuộc trò chuyện nào. Hãy bắt đầu một tin nhắn mới."}
      </p>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {ids.map((id) => (
        <DirectMessageCard
          convoId={id}
          key={id}
        />
      ))}
    </div>
  );
};

export default DirectMessageList;
