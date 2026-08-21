import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Play, RotateCw } from "lucide-react";
import { Spinner } from "../ui/spinner";
import { cn, formatDaySeparator, formatMessageTime, isSameDay } from "@/lib/utils";
import type { Attachment, Conversation, Message } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import UserAvatar from "./UserAvatar";
import MessageActions from "./MessageActions";
import MediaPreviewModal from "./MediaPreviewModal";
import ReplyQuote from "./ReplyQuote";

interface MessageItemProps {
  message: Message;
  index: number;
  /** Toàn bộ tin nhắn, thứ tự cũ → mới. */
  messages: Message[];
  selectedConvo: Conversation;
}

/** 5 phút — quá mốc này thì chèn mốc giờ giữa hai tin nhắn. */
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

// Tin nhắn hệ thống được render bởi component cha (ChatWindowBody), KHÔNG phải
// bằng một early return ở đây: return sớm trước các hook sẽ làm số hook thay đổi
// giữa các lần render và React sẽ ném "Rendered more hooks than during the
// previous render".
const MessageItem = ({ message, index, messages, selectedConvo }: MessageItemProps) => {
  const meId = useAuthStore((s) => s.user?._id);

  // Thứ tự thuận, nên tin trước đó nằm ở index - 1.
  const prev = index > 0 ? messages[index - 1] : undefined;

  const createdAt = new Date(message.createdAt);
  const prevCreatedAt = prev ? new Date(prev.createdAt) : undefined;

  // Vạch ngăn theo NGÀY — trước đây không có, nên một luồng dài không có mốc nào để
  // định vị ngoài các mốc giờ cách nhau 5 phút.
  const isNewDay = !prevCreatedAt || !isSameDay(createdAt, prevCreatedAt);

  const isShowTime =
    isNewDay || createdAt.getTime() - (prevCreatedAt?.getTime() ?? 0) > TIME_GAP_MS;

  const isGroupBreak = isShowTime || message.senderId !== prev?.senderId;

  const sender =
    message.sender ?? selectedConvo.participants.find((p) => p._id === message.senderId);

  const isOwn = message.isOwn ?? message.senderId === meId;
  const readerCount = isOwn ? countReaders(selectedConvo, message) : 0;

  /*
   * Animation vào chỉ chạy MỘT lần.
   *
   * Bản cũ đặt class `message-bounce` cố định, nên nó phát lại mỗi lần component
   * re-render (tức mỗi lần cuộn, mỗi tin nhắn mới) — cả danh sách nhấp nháy.
   */
  const [entered, setEntered] = useState(false);
  const mounted = useRef(false);

  /** Tệp đang xem cỡ lớn, `null` là không mở gì. */
  const [preview, setPreview] = useState<Attachment | null>(null);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const timer = setTimeout(() => setEntered(true), 250);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {isNewDay && (
        <div className="flex items-center gap-3 py-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">
            {formatDaySeparator(createdAt)}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      {isShowTime && !isNewDay && (
        <span className="flex justify-center px-1 py-2 text-xs text-muted-foreground">
          {formatMessageTime(createdAt)}
        </span>
      )}

      <div
        // `data-message-id` là đích cho việc nhảy tới tin nhắn gốc từ một trích dẫn.
        data-message-id={message._id}
        className={cn(
          "group/message flex items-center gap-2 rounded-lg transition-smooth",
          // Cụm tin nhắn liền nhau sát hơn, cụm mới thì tách ra — `isGroupBreak`
          // trước đây chỉ dùng để ẩn avatar, không hề ảnh hưởng khoảng cách.
          isGroupBreak ? "mt-3" : "mt-0.5",
          isOwn ? "justify-end" : "justify-start",
          !entered && "message-bounce",
        )}
      >
        {!isOwn && (
          <div className="w-8 shrink-0 self-end">
            {isGroupBreak && (
              <UserAvatar
                type="chat"
                name={sender?.displayName ?? "Moji"}
                avatarUrl={sender?.avatarUrl ?? undefined}
              />
            )}
          </div>
        )}

        {/* Thao tác nằm ở phía đối diện với bong bóng, để không che nội dung.
            Tin nhắn đang gửi hoặc đã xoá thì không có gì để thao tác. */}
        {isOwn && !message.status && !message.deleted && (
          <MessageActions
            message={message}
            conversation={selectedConvo}
          />
        )}

        <div
          className={cn(
            "flex max-w-[75%] flex-col gap-1 sm:max-w-md",
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
              "px-3 py-2",
              isOwn ? "chat-bubble-sent" : "chat-bubble-received",
              // Bo góc theo cụm: góc phía trong cụm vuông lại, nên các bong bóng
              // liền nhau đọc như một khối.
              isOwn
                ? isGroupBreak
                  ? "rounded-2xl rounded-br-md"
                  : "rounded-2xl rounded-r-md"
                : isGroupBreak
                  ? "rounded-2xl rounded-bl-md"
                  : "rounded-2xl rounded-l-md",
              message.status === "sending" && "opacity-60",
              message.status === "failed" && "ring-1 ring-destructive",
            )}
          >
            {message.deleted ? (
              <p className="text-sm italic opacity-70">Tin nhắn đã bị xoá</p>
            ) : (
              <>
                {message.replyTo && (
                  <ReplyQuote
                    replyTo={message.replyTo}
                    conversation={selectedConvo}
                    isOwn={isOwn}
                  />
                )}

                {message.attachments.map((attachment) => (
                  <button
                    key={attachment.url}
                    type="button"
                    onClick={() => setPreview(attachment)}
                    className="group/media relative mb-1 block overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={
                      attachment.kind === "video" ? "Xem video" : "Xem ảnh cỡ lớn"
                    }
                  >
                    {attachment.kind === "video" ? (
                      <>
                        {/*
                          `preload="metadata"` chứ không phải "auto": khung chat có
                          thể chứa nhiều video, và tải sẵn toàn bộ từng cái sẽ ngốn
                          băng thông cho thứ người dùng có thể không bao giờ mở.
                          "metadata" đủ để trình duyệt vẽ khung hình đầu.
                        */}
                        <video
                          src={attachment.url}
                          preload="metadata"
                          muted
                          playsInline
                          className="max-h-64 rounded-lg object-cover"
                        />

                        {/* Dấu play: không có nó thì video đứng im trông như ảnh hỏng. */}
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <span className="flex size-12 items-center justify-center rounded-full bg-black/55 transition-smooth group-hover/media:scale-110">
                            <Play className="size-5 fill-white text-white" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <img
                        src={attachment.url}
                        alt={attachment.originalName ?? "Ảnh đã gửi"}
                        className="max-h-64 rounded-lg object-cover transition-smooth group-hover/media:brightness-95"
                        loading="lazy"
                      />
                    )}
                  </button>
                ))}

                {message.content && (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {message.content}
                  </p>
                )}
              </>
            )}
          </div>

          {isOwn && (
            <span className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
              {message.status === "sending" && (
                <>
                  <Spinner className="size-3" />
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

          {!isOwn && message.editedAt && !message.deleted && (
            <span className="px-1 text-[11px] text-muted-foreground">đã chỉnh sửa</span>
          )}
        </div>

        {!isOwn && !message.deleted && (
          <MessageActions
            message={message}
            conversation={selectedConvo}
          />
        )}
      </div>

      <MediaPreviewModal
        attachment={preview}
        onClose={() => setPreview(null)}
      />
    </>
  );
};

export default MessageItem;
