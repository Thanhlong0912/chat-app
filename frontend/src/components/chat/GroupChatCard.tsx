import { useActiveConversationId, useConversation } from "@/stores/useChatStore";
import { useSelectConversation } from "@/hooks/useSelectConversation";
import { cn } from "@/lib/utils";
import ChatCard from "./ChatCard";
import UnreadCountBadge from "./UnreadCountBadge";
import GroupChatAvatar from "./GroupChatAvatar";
import ConversationMenu from "./ConversationMenu";
import { BellOff } from "lucide-react";

const GroupChatCard = ({ convoId }: { convoId: string }) => {
  const convo = useConversation(convoId);
  const activeConversationId = useActiveConversationId();
  const selectConversation = useSelectConversation();

  if (!convo) return null;

  const unreadCount = convo.unreadCount;
  const name = convo.group?.name ?? "";
  const lastMessage = convo.lastMessage?.content ?? "";

  return (
    <ChatCard
      convoId={convo._id}
      name={name}
      timestamp={
        convo.lastMessage?.createdAt ? new Date(convo.lastMessage.createdAt) : undefined
      }
      isActive={activeConversationId === convo._id}
      onSelect={selectConversation}
      unreadCount={unreadCount}
      pinned={convo.pinned}
      actions={<ConversationMenu conversation={convo} />}
      leftSection={
        <>
          {/* Cùng preset avatar và cùng thứ tự badge như card 1-1: hai loại card
              trước đây dùng "chat" (32px) và "sidebar" (48px), nên hai danh sách có
              chiều cao dòng lệch nhau rõ rệt. */}
          <GroupChatAvatar
            participants={convo.participants}
            type="sidebar"
          />
          {unreadCount > 0 && <UnreadCountBadge unreadCount={unreadCount} />}
        </>
      }
      subtitle={
        <>
          {convo.mutedUntil && (
            <BellOff
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="Đã tắt thông báo"
            />
          )}
          <p
            className={cn(
              "text-sm truncate",
              unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
          {/* Hiển thị tin nhắn cuối như card 1-1; số thành viên không phải thứ người
              ta cần thấy trong danh sách. */}
            {lastMessage || `${convo.participants.length} thành viên`}
          </p>
        </>
      }
    />
  );
};

export default GroupChatCard;
