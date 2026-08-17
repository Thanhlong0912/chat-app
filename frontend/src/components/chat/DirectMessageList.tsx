import { useConversationIdsByType } from "@/stores/useChatStore";
import DirectMessageCard from "./DirectMessageCard";

const DirectMessageList = () => {
  const ids = useConversationIdsByType("direct");

  if (ids.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Chưa có cuộc trò chuyện nào. Hãy bắt đầu một tin nhắn mới.
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
