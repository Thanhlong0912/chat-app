import ChatCard from "./ChatCard";
import { useAuthStore } from "@/stores/useAuthStore";
import { useActiveConversationId, useConversation } from "@/stores/useChatStore";
import { usePresence } from "@/stores/useSocketStore";
import { useSelectConversation } from "@/hooks/useSelectConversation";
import { cn } from "@/lib/utils";
import UserAvatar from "./UserAvatar";
import StatusBadge from "./StatusBadge";
import UnreadCountBadge from "./UnreadCountBadge";
import ConversationMenu from "./ConversationMenu";
import { BellOff } from "lucide-react";

const DirectMessageCard = ({ convoId }: { convoId: string }) => {
  const user = useAuthStore((s) => s.user);
  // Card tự đăng ký vào đúng conversation của nó, nên một tin nhắn mới ở cuộc trò
  // chuyện khác không làm nó re-render.
  const convo = useConversation(convoId);
  const activeConversationId = useActiveConversationId();
  const selectConversation = useSelectConversation();

  const otherUser = convo?.participants.find((p) => p._id !== user?._id);
  const presence = usePresence(otherUser?._id);

  if (!user || !convo || !otherUser) return null;

  // `unreadCount` do server tính cho chính người đang xem, không phải tra Map bằng
  // id của mình (vốn trả undefined dưới một kiểu khai báo là number).
  const unreadCount = convo.unreadCount;
  const lastMessage = convo.lastMessage?.content ?? "";

  return (
    <ChatCard
      convoId={convo._id}
      name={otherUser.displayName ?? ""}
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
          <UserAvatar
            type="sidebar"
            name={otherUser.displayName ?? ""}
            avatarUrl={otherUser.avatarUrl ?? undefined}
          />
          <StatusBadge status={presence} />
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
            {lastMessage}
          </p>
        </>
      }
    />
  );
};

export default DirectMessageCard;
