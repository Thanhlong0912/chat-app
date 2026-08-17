import { useConversationIdsByType } from "@/stores/useChatStore";
import GroupChatCard from "./GroupChatCard";

const GroupChatList = () => {
  const ids = useConversationIdsByType("group");

  if (ids.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Bạn chưa tham gia nhóm nào.
      </p>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {ids.map((id) => (
        <GroupChatCard
          convoId={id}
          key={id}
        />
      ))}
    </div>
  );
};

export default GroupChatList;
