import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Pencil, Reply, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { Conversation } from "@/types/chat";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import EmojiPicker from "./EmojiPicker";
import { useChatStore, useDraft } from "@/stores/useChatStore";
import { useSocketStore } from "@/stores/useSocketStore";
import { chatService } from "@/services/chatService";
import { describeError } from "@/lib/errors";

/** Dừng phát "đang nhập" sau khi người dùng ngừng gõ. */
const TYPING_IDLE_MS = 2500;

const MAX_ROWS_PX = 160;

const MessageInput = ({ selectedConvo }: { selectedConvo: Conversation }) => {
  const conversationId = selectedConvo._id;

  // Bản nháp nằm trong store nên đổi cuộc trò chuyện rồi quay lại vẫn còn nguyên.
  const draft = useDraft(conversationId);
  const setDraft = useChatStore((s) => s.setDraft);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const replyingTo = useChatStore((s) => s.replyingTo[conversationId]);
  const editingId = useChatStore((s) => s.editingId[conversationId]);
  const editingMessage = useChatStore((s) =>
    editingId ? s.messages[conversationId]?.byId[editingId] : undefined,
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const [uploading, setUploading] = useState(false);

  const stopTyping = useCallback(() => {
    if (!isTyping.current) return;
    isTyping.current = false;
    useSocketStore.getState().emitTyping(conversationId, false);
  }, [conversationId]);

  // Đổi cuộc trò chuyện thì phải dừng chỉ báo ở cuộc trò chuyện cũ.
  useEffect(() => stopTyping, [stopTyping]);

  /*
   * Vào chế độ sửa: nạp nội dung hiện tại vào ô soạn.
   *
   * Chỉ phụ thuộc `editingId`, KHÔNG phụ thuộc object tin nhắn. Nếu phụ thuộc
   * object thì sau khi lưu, `upsertMessage` tạo ra một object mới, effect chạy lại
   * trong lúc `editingId` chưa kịp được xoá, và ô soạn bị nạp lại đúng nội dung vừa
   * sửa — người dùng lưu xong vẫn thấy chữ nằm nguyên trong ô.
   */
  useEffect(() => {
    if (!editingId) return;

    const current =
      useChatStore.getState().messages[conversationId]?.byId[editingId]?.content ?? "";

    setDraft(conversationId, current);
    textareaRef.current?.focus();
  }, [editingId, conversationId, setDraft]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  };

  useEffect(autoGrow, [draft]);

  const cancelContext = () => {
    const store = useChatStore.getState();
    store.setReplyingTo(conversationId, undefined);
    store.setEditingId(conversationId, undefined);
    setDraft(conversationId, "");
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(conversationId, event.target.value);

    if (!isTyping.current && event.target.value.trim()) {
      isTyping.current = true;
      useSocketStore.getState().emitTyping(conversationId, true);
    }

    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content) return;

    // Xoá ô nhập ngay cho cảm giác nhanh. An toàn vì tin nhắn đã được vẽ lạc quan
    // và nếu gửi thất bại thì bong bóng đó chuyển sang trạng thái "failed" kèm nút
    // thử lại.
    setDraft(conversationId, "");
    stopTyping();

    try {
      if (editingId) {
        await useChatStore.getState().editMessage(editingId, content);
        useChatStore.getState().setEditingId(conversationId, undefined);
        // Dọn lại lần nữa: effect nạp nội dung có thể đã chạy trong lúc chờ await.
        setDraft(conversationId, "");
        return;
      }

      await sendMessage({
        conversationId,
        content,
        replyToMessageId: replyingTo?._id,
      });

      useChatStore.getState().setReplyingTo(conversationId, undefined);
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter phải xuống dòng. Bản trước chỉ kiểm tra `e.key === "Enter"`, nên
    // Shift+Enter cũng gửi và không có cách nào viết tin nhắn nhiều dòng.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }

    // Esc thoát khỏi chế độ trả lời / sửa.
    if (event.key === "Escape" && (replyingTo || editingId)) {
      event.preventDefault();
      cancelContext();
    }
  };

  /** Chèn emoji tại vị trí con trỏ, không phải nối vào cuối. */
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;

    if (!el) {
      setDraft(conversationId, draft + emoji);
      return;
    }

    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;

    setDraft(conversationId, draft.slice(0, start) + emoji + draft.slice(end));

    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  /**
   * Tải ảnh lên rồi gửi tin nhắn tham chiếu tới nó.
   *
   * Hai bước tách rời: nếu tải thất bại, nội dung đang gõ vẫn còn nguyên trong ô
   * soạn thảo thay vì biến mất cùng lần gửi hỏng.
   */
  const uploadAndSend = async (file: File) => {
    setUploading(true);

    try {
      const attachment = await chatService.uploadAttachment(conversationId, file);

      await sendMessage({
        conversationId,
        content: draft.trim() || undefined,
        imgUrl: attachment.url,
        replyToMessageId: replyingTo?._id,
      });

      setDraft(conversationId, "");
      useChatStore.getState().setReplyingTo(conversationId, undefined);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void uploadAndSend(file);
    // Cho phép chọn lại đúng tệp vừa chọn.
    event.target.value = "";
  };

  /** Dán ảnh trực tiếp từ clipboard. */
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...event.clipboardData.files].find((f) => f.type.startsWith("image/"));

    if (file) {
      event.preventDefault();
      void uploadAndSend(file);
    }
  };

  return (
    <div className="bg-background">
      {/* Dải bối cảnh: đang trả lời ai, hoặc đang sửa tin nào. */}
      {(replyingTo || editingMessage) && (
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          {editingMessage ? (
            <Pencil className="size-4 shrink-0 text-primary" />
          ) : (
            <Reply className="size-4 shrink-0 text-primary" />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-primary">
              {editingMessage ? "Đang chỉnh sửa" : "Đang trả lời"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {(editingMessage ?? replyingTo)?.content ?? "Hình ảnh"}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={cancelContext}
            aria-label="Huỷ"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <Button
          variant="ghost"
          size="icon"
          className="transition-smooth shrink-0 hover:bg-primary/10"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || Boolean(editingId)}
          aria-label="Gửi ảnh"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleFile}
          aria-label="Chọn ảnh để gửi"
        />

        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={stopTyping}
            placeholder={editingId ? "Chỉnh sửa tin nhắn..." : "Soạn tin nhắn..."}
            aria-label="Nội dung tin nhắn"
            // `bg-background` chứ không phải `bg-white`: giá trị cứng kia làm ô nhập
            // trắng lốp trong chế độ tối.
            className="min-h-9 resize-none overflow-y-auto border-border/50 bg-background pr-11 transition-smooth focus:border-primary/50"
          />

          <div className="absolute bottom-1 right-1">
            <EmojiPicker onChange={insertEmoji} />
          </div>
        </div>

        <Button
          onClick={submit}
          className="transition-smooth shrink-0 bg-gradient-chat hover:scale-105 hover:shadow-glow"
          disabled={!draft.trim() || uploading}
          aria-label={editingId ? "Lưu chỉnh sửa" : "Gửi tin nhắn"}
        >
          <Send className="size-4 text-white" />
        </Button>
      </div>
    </div>
  );
};

export default MessageInput;
