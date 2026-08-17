import { Check, CheckCheck, Loader2, RotateCw } from "lucide-react";
import { cn, formatMessageTime } from "@/lib/utils";
import type { Conversation, Message } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import UserAvatar from "./UserAvatar";

interface MessageItemProps {
  message: Message;
  index: number;
  messages: Message[];
  selectedConvo: Conversation;
}

/** 5 phút — quá mốc này thì chèn một mốc thời gian. */
const TIME_GAP_MS = 300_000;

/**
 * Read receipt cho MỘT tin nhắn, suy ra từ con trỏ `lastReadAt` của từng thành viên.
 *
 * Đây là lý do không cần lưu `readBy[]` trên mỗi tin nhắn: ai đã đọc tin `m` chính
 * là những người có `lastReadAt >= m.createdAt`.
 */
const countReaders = (conversation: Conversation, message: Message) => {
  const sentAt = new Date(message.createdAt).getTime();

  return conversation.participants.filter(
    (p) =>
      p._id !== message.senderId &&
      p.lastReadAt !== null &&
      new Date(p.lastReadAt).getTime() >= sentAt,
  ).length;
};

const MessageItem = ({ message, index, messages, selectedConvo }: MessageItemProps) => {
  const meId = useAuthStore((s) => s.user?._id);

  // `messages` được truyền theo thứ tự mới → cũ, nên tin trước đó nằm ở index + 1.
  const prev = index + 1 < messages.length ? messages[index + 1] : undefined;

  const isShowTime =
    index === messages.length - 1 ||
    new Date(message.createdAt).getTime() - new Date(prev?.createdAt ?? 0).getTime() >
      TIME_GAP_MS;

  const isGroupBreak = isShowTime || message.senderId !== prev?.senderId;

  const sender =
    message.sender ?? selectedConvo.participants.find((p) => p._id === message.senderId);

  const isOwn = message.isOwn ?? message.senderId === meId;
  const readerCount = isOwn ? countReaders(selectedConvo, message) : 0;

  return (
    <>
      {isShowTime && (
        <span className="flex justify-center px-1 py-2 text-xs text-muted-foreground">
          {formatMessageTime(new Date(message.createdAt))}
        </span>
      )}

      <div className={cn("mt-1 flex gap-2", isOwn ? "justify-end" : "justify-start")}>
        {!isOwn && (
          <div className="w-8 shrink-0">
            {isGroupBreak && (
              <UserAvatar
                type="chat"
                name={sender?.displayName ?? "Moji"}
                avatarUrl={sender?.avatarUrl ?? undefined}
              />
            )}
          </div>
        )}

        <div
          className={cn(
            "flex max-w-xs flex-col space-y-1 lg:max-w-md",
            isOwn ? "items-end" : "items-start",
          )}
        >
          {/* Tên người gửi trong nhóm — trước đây chỉ có avatar, nên không biết ai
              viết gì mà không đối chiếu ảnh. */}
          {!isOwn && selectedConvo.type === "group" && isGroupBreak && (
            <span className="px-1 text-xs font-medium text-muted-foreground">
              {sender?.displayName}
            </span>
          )}

          <div
            className={cn(
              "rounded-2xl px-3 py-2",
              isOwn ? "chat-bubble-sent" : "chat-bubble-received",
              // Tin nhắn đang gửi thì mờ đi, để thấy rõ nó chưa được xác nhận.
              message.status === "sending" && "opacity-60",
              message.status === "failed" && "ring-1 ring-destructive",
            )}
          >
            {message.deleted ? (
              <p className="text-sm italic opacity-70">Tin nhắn đã bị xoá</p>
            ) : (
              <>
                {message.attachments.map((attachment) => (
                  <img
                    key={attachment.url}
                    src={attachment.url}
                    alt={attachment.originalName ?? "Ảnh đã gửi"}
                    className="mb-1 max-h-64 rounded-lg object-cover"
                    loading="lazy"
                  />
                ))}

                {message.content && (
                  <p className="break-words text-sm leading-relaxed">{message.content}</p>
                )}
              </>
            )}
          </div>

          {/* Trạng thái gửi / đã xem */}
          {isOwn && (
            <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
              {message.status === "sending" && (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Đang gửi
                </>
              )}

              {message.status === "failed" && (
                <button
                  type="button"
                  onClick={() =>
                    message.clientMessageId &&
                    void useChatStore.getState().retryMessage(message.clientMessageId)
                  }
                  className="flex items-center gap-1 text-destructive hover:underline"
                >
                  <RotateCw className="size-3" />
                  Gửi lại
                </button>
              )}

              {!message.status &&
                (readerCount > 0 ? (
                  <>
                    <CheckCheck className="size-3.5 text-primary" />
                    {selectedConvo.type === "group" && readerCount > 1
                      ? `Đã xem (${readerCount})`
                      : "Đã xem"}
                  </>
                ) : (
                  <>
                    <Check className="size-3.5" />
                    Đã gửi
                  </>
                ))}

              {message.editedAt && !message.deleted && <span>· đã chỉnh sửa</span>}
            </span>
          )}
        </div>
      </div>
    </>
  );
};

export default MessageItem;
