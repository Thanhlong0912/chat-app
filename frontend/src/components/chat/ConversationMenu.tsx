import { Archive, ArchiveRestore, Bell, BellOff, MoreHorizontal, Pin, PinOff } from "lucide-react";
import type { Conversation } from "@/types/chat";
import { useChatStore } from "@/stores/useChatStore";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** Các mốc tắt thông báo. `null` là bật lại. */
const MUTE_OPTIONS = [
  { label: "Trong 1 giờ", minutes: 60 },
  { label: "Trong 8 giờ", minutes: 480 },
  { label: "Trong 1 tuần", minutes: 10_080 },
] as const;

/**
 * Ghim / tắt thông báo / lưu trữ cho một cuộc trò chuyện.
 *
 * Cả ba đều là tuỳ chọn RIÊNG của người đang đăng nhập, nên không có mục nào ở
 * đây cần kiểm tra vai trò nhóm — một thành viên thường vẫn ghim được nhóm của
 * mình. Xoá nhóm và rời nhóm cố tình KHÔNG nằm ở đây: chúng ảnh hưởng tới người
 * khác và đã có chỗ riêng trong `GroupInfoPanel`, nơi có xác nhận đàng hoàng.
 *
 * `modal={false}` vì cùng lý do đã ghi ở `MessageActions`: menu modal tham gia vào
 * sổ sách `pointer-events` của <body> và hai lớp chồng nhau làm cả trang chết cứng.
 */
const ConversationMenu = ({ conversation }: { conversation: Conversation }) => {
  const muted = Boolean(conversation.mutedUntil);

  const update = (settings: Parameters<typeof apply>[1]) => apply(conversation._id, settings);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-background/80 backdrop-blur-sm"
          aria-label={`Tuỳ chọn cho cuộc trò chuyện`}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => update({ pinned: !conversation.pinned })}>
          {conversation.pinned ? (
            <>
              <PinOff className="size-4" />
              Bỏ ghim
            </>
          ) : (
            <>
              <Pin className="size-4" />
              Ghim lên đầu
            </>
          )}
        </DropdownMenuItem>

        {muted ? (
          <DropdownMenuItem onClick={() => update({ muteMinutes: null })}>
            <Bell className="size-4" />
            Bật lại thông báo
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BellOff className="size-4" />
              Tắt thông báo
            </DropdownMenuSubTrigger>

            <DropdownMenuSubContent>
              {MUTE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.minutes}
                  onClick={() => update({ muteMinutes: option.minutes })}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => update({ archived: !conversation.archived })}>
          {conversation.archived ? (
            <>
              <ArchiveRestore className="size-4" />
              Bỏ lưu trữ
            </>
          ) : (
            <>
              <Archive className="size-4" />
              Lưu trữ
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/*
 * Gọi qua `getState()` chứ không đăng ký hook.
 *
 * Component này nằm trong mỗi dòng của sidebar; đăng ký vào store ở đây sẽ khiến
 * mọi tin nhắn mới vẽ lại toàn bộ menu của toàn bộ danh sách. Đây cũng chính là
 * quy ước đã dùng ở `MessageActions`.
 */
const apply = (
  conversationId: string,
  settings: { pinned?: boolean; archived?: boolean; muteMinutes?: number | null },
) => {
  void useChatStore.getState().updateConversationSettings(conversationId, settings);
};

export default ConversationMenu;
