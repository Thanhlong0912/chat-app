import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { REACTION_EMOJIS } from "@/types/chat";
import { useChatStore } from "@/stores/useChatStore";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * Chọn nhanh một biểu cảm.
 *
 * Cố tình KHÔNG dùng `EmojiPicker` (emoji-mart) đang có cho ô soạn thảo: server
 * chỉ chấp nhận sáu emoji cố định, nên một bảng chọn đầy đủ sẽ mời người dùng bấm
 * vào hàng nghìn lựa chọn rồi trả về lỗi validate. Sáu nút là toàn bộ miền giá trị
 * hợp lệ, và cũng nhẹ hơn hẳn.
 *
 * `modal={false}` vì đúng lý do đã ghi ở `MessageActions`: popover ở chế độ modal
 * tham gia vào sổ sách `pointer-events` của <body>, và hai lớp overlay chồng nhau
 * là thứ làm cả trang chết cứng sau khi đóng.
 */
const ReactionPicker = ({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) => {
  /*
   * Bảng chọn TỰ ĐÓNG sau khi chọn.
   *
   * Bản trước để popover không kiểm soát, nên nó vẫn mở nguyên sau cú bấm: người
   * dùng không nhìn thấy chip vừa xuất hiện (bảng chọn nổi che đúng chỗ đó), và
   * phải bấm ra ngoài để đóng. Thả biểu cảm là thao tác một-lần-rồi-xong, nên việc
   * đóng lại chính là phản hồi cho biết cú bấm đã ăn.
   */
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      modal={false}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Thả biểu cảm"
        >
          <SmilePlus className="size-3.5" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="center"
        className="flex w-auto gap-0.5 p-1"
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              setOpen(false);
              void useChatStore
                .getState()
                .toggleReaction(conversationId, messageId, emoji);
            }}
            aria-label={`Thả biểu cảm ${emoji}`}
            className="rounded-md p-1.5 text-lg leading-none transition-smooth hover:scale-125 hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

export default ReactionPicker;
