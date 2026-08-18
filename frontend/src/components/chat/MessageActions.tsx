import { useState } from "react";
import { Copy, MoreHorizontal, Pencil, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Conversation, Message } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import { describeError } from "@/lib/errors";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import ConfirmDialog from "../group/ConfirmDialog";

/** Khớp với EDIT_WINDOW_MS phía server. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Menu thao tác trên một tin nhắn.
 *
 * Chỉ hiện khi hover (hoặc khi focus bằng bàn phím) để không làm rối luồng chat.
 * Các điều kiện dưới đây chỉ để ẩn nút — server vẫn là nơi ép quyền thật, nên một
 * nút bị ẩn không phải lớp bảo vệ.
 */
const MessageActions = ({
  message,
  conversation,
}: {
  message: Message;
  conversation: Conversation;
}) => {
  const meId = useAuthStore((s) => s.user?._id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwn = message.senderId === meId;
  const isAdmin = conversation.myRole === "owner" || conversation.myRole === "admin";

  const withinEditWindow =
    Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;

  const canEdit = isOwn && message.kind === "text" && withinEditWindow;
  const canDelete = isOwn || (conversation.type === "group" && isAdmin);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content ?? "");
      toast.success("Đã sao chép");
    } catch {
      toast.error("Không sao chép được");
    }
  };

  return (
    <>
      <div
        className="flex items-center gap-0.5 opacity-0 transition-smooth focus-within:opacity-100 group-hover/message:opacity-100"
        // Bàn phím: các nút vẫn focus được, và focus-within làm chúng hiện ra.
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => useChatStore.getState().setReplyingTo(conversation._id, message)}
          aria-label="Trả lời tin nhắn"
        >
          <Reply className="size-3.5" />
        </Button>

        {/*
          `modal={false}`: menu này không có lý do gì để khoá cả trang. Ở chế độ
          modal, nó tham gia vào cùng một sổ sách `pointer-events` của <body> với
          hộp thoại xác nhận mở ngay sau đó — và hai lớp chồng nhau chính là thứ
          làm cả trang chết cứng sau khi đóng. Bỏ modal cũng thôi khoá luôn việc
          cuộn danh sách tin nhắn khi menu đang mở.
        */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Thêm tuỳ chọn"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align={isOwn ? "end" : "start"}>
            {message.content && (
              <DropdownMenuItem onClick={copy}>
                <Copy className="size-4" />
                Sao chép
              </DropdownMenuItem>
            )}

            {canEdit && (
              <DropdownMenuItem
                onClick={() =>
                  useChatStore.getState().setEditingId(conversation._id, message._id)
                }
              >
                <Pencil className="size-4" />
                Chỉnh sửa
              </DropdownMenuItem>
            )}

            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
                Xoá
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xoá tin nhắn này?"
        description="Tin nhắn sẽ bị xoá với tất cả mọi người. Không thể hoàn tác."
        confirmLabel="Xoá"
        onConfirm={() => {
          useChatStore
            .getState()
            .deleteMessage(conversation._id, message._id)
            .catch((error) => toast.error(describeError(error)));
        }}
      />
    </>
  );
};

export default MessageActions;
