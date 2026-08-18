import { useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { SidebarTrigger, useSidebar } from "../ui/sidebar";
import { Button } from "../ui/button";
import GroupInfoPanel from "../group/GroupInfoPanel";
import { useAuthStore } from "@/stores/useAuthStore";
import { useActiveConversation } from "@/stores/useChatStore";
import { useLastSeen, usePresence, useTypingNames } from "@/stores/useSocketStore";
import { Separator } from "../ui/separator";
import { formatOnlineTime } from "@/lib/utils";
import UserAvatar from "./UserAvatar";
import StatusBadge from "./StatusBadge";
import GroupChatAvatar from "./GroupChatAvatar";

const PRESENCE_LABEL = {
  online: "Đang hoạt động",
  away: "Vắng mặt",
  offline: "Không hoạt động",
} as const;

const ChatWindowHeader = () => {
  const chat = useActiveConversation();
  const user = useAuthStore((s) => s.user);
  const { setOpenMobile } = useSidebar();
  const [infoOpen, setInfoOpen] = useState(false);

  const otherUser =
    chat?.type === "direct" ? chat.participants.find((p) => p._id !== user?._id) : undefined;

  const presence = usePresence(otherUser?._id);
  const lastSeenAt = useLastSeen(otherUser?._id);
  const typingNames = useTypingNames(chat?._id);

  // Luôn hiện nút mở sidebar. Trước đây nhánh này chỉ render khi KHÔNG có
  // conversation nào và còn kèm `md:hidden`, nên trên desktop mở một cuộc trò
  // chuyện xong là không còn nút nào để thu/mở sidebar.
  if (!chat) {
    return (
      <header className="sticky top-0 z-10 flex w-full items-center gap-2 px-4 py-2">
        <SidebarTrigger className="-ml-1 text-foreground" />
      </header>
    );
  }

  const title = chat.type === "direct" ? otherUser?.displayName : chat.group?.name;

  const subtitle = () => {
    if (typingNames.length > 0) {
      return chat.type === "direct"
        ? "đang nhập…"
        : `${typingNames.slice(0, 2).join(", ")} đang nhập…`;
    }

    if (chat.type === "group") {
      return `${chat.participants.length} thành viên`;
    }

    if (presence === "offline" && lastSeenAt) {
      return `Hoạt động ${formatOnlineTime(new Date(lastSeenAt))}`;
    }

    return PRESENCE_LABEL[presence];
  };

  return (
    <header className="sticky top-0 z-10 flex items-center bg-background px-4 py-2">
      <div className="flex w-full items-center gap-2">
        {/*
          Trên mobile, sidebar là một Sheet phủ toàn màn hình — nó chính là "hộp thư".
          Nút quay lại mở Sheet đó, cho người dùng một đường về danh sách mà không
          phải đoán rằng phải bấm vào icon hamburger.
        */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpenMobile(true)}
          className="-ml-1 size-9 md:hidden"
          aria-label="Quay lại danh sách cuộc trò chuyện"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <SidebarTrigger className="-ml-1 hidden size-9 text-foreground md:flex" />
        <Separator
          orientation="vertical"
          className="mr-2 hidden data-[orientation=vertical]:h-4 md:block"
        />

        <div className="flex w-full items-center gap-3 p-2">
          <div className="relative">
            {chat.type === "direct" ? (
              <>
                <UserAvatar
                  type="sidebar"
                  name={otherUser?.displayName || "Moji"}
                  avatarUrl={otherUser?.avatarUrl || undefined}
                />
                <StatusBadge status={presence} />
              </>
            ) : (
              <GroupChatAvatar
                participants={chat.participants}
                type="sidebar"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-foreground">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{subtitle()}</p>
          </div>

          {chat.type === "group" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => setInfoOpen(true)}
              aria-label="Thông tin nhóm"
            >
              <Info className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {chat.type === "group" && (
        <GroupInfoPanel
          conversation={chat}
          open={infoOpen}
          onOpenChange={setInfoOpen}
        />
      )}
    </header>
  );
};

export default ChatWindowHeader;
