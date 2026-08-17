import { useCallback, useEffect, useRef } from "react";
import { ImagePlus, Send } from "lucide-react";
import { toast } from "sonner";
import type { Conversation } from "@/types/chat";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import EmojiPicker from "./EmojiPicker";
import { useChatStore, useDraft } from "@/stores/useChatStore";
import { useSocketStore } from "@/stores/useSocketStore";

/** Dừng phát "đang nhập" sau khi người dùng ngừng gõ. */
const TYPING_IDLE_MS = 2500;

const MAX_ROWS_PX = 160;

const MessageInput = ({ selectedConvo }: { selectedConvo: Conversation }) => {
  const conversationId = selectedConvo._id;

  // Bản nháp nằm trong store nên đổi cuộc trò chuyện rồi quay lại vẫn còn nguyên.
  const draft = useDraft(conversationId);
  const setDraft = useChatStore((s) => s.setDraft);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  const stopTyping = useCallback(() => {
    if (!isTyping.current) return;
    isTyping.current = false;
    useSocketStore.getState().emitTyping(conversationId, false);
  }, [conversationId]);

  // Đổi cuộc trò chuyện thì phải dừng chỉ báo ở cuộc trò chuyện cũ.
  useEffect(() => stopTyping, [stopTyping]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  };

  useEffect(autoGrow, [draft]);

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
    // thử lại — bản trước xoá text và không có cách nào lấy lại.
    setDraft(conversationId, "");
    stopTyping();

    try {
      await sendMessage({ conversationId, content });
    } catch {
      toast.error("Không gửi được tin nhắn. Bạn hãy thử lại!");
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter phải xuống dòng. Bản trước chỉ kiểm tra `e.key === "Enter"`, nên
    // Shift+Enter cũng gửi và không có cách nào viết tin nhắn nhiều dòng.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
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

    // Đặt lại con trỏ sau emoji vừa chèn.
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  return (
    <div className="flex items-end gap-2 bg-background p-3">
      <Button
        variant="ghost"
        size="icon"
        className="transition-smooth shrink-0 hover:bg-primary/10"
        // TODO(Phase 7): nối vào luồng tải tệp lên.
        disabled
        aria-label="Gửi ảnh (sắp có)"
      >
        <ImagePlus className="size-4" />
      </Button>

      <div className="relative flex-1">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={stopTyping}
          placeholder="Soạn tin nhắn..."
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
        disabled={!draft.trim()}
        aria-label="Gửi tin nhắn"
      >
        <Send className="size-4 text-white" />
      </Button>
    </div>
  );
};

export default MessageInput;
