import { useThemeStore } from "@/stores/useThemeStore";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Smile } from "lucide-react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

interface EmojiPickerProps {
  onChange: (value: string) => void;
}

/** Phần payload của emoji-mart mà chúng ta dùng — thư viện không xuất kiểu này. */
interface EmojiMartEmoji {
  native: string;
}

const EmojiPicker = ({ onChange }: EmojiPickerProps) => {
  const isDark = useThemeStore((s) => s.isDark);

  return (
    <Popover>
      {/*
        Trigger tự là một <button> thật. Trước đây nó bị bọc trong
        `<Button asChild><div><PopoverTrigger>`, tức một button lồng trong button —
        HTML không hợp lệ và làm hỏng cả điều hướng bàn phím. Vùng chạm cũng chỉ
        16px; giữ icon nhỏ nhưng nới vùng bấm ra 36px.
      */}
      <PopoverTrigger
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-smooth hover:bg-primary/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label="Chèn emoji"
      >
        <Smile className="size-4" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-auto border-none bg-transparent p-0 shadow-none drop-shadow-none"
      >
        <Picker
          theme={isDark ? "dark" : "light"}
          data={data}
          onEmojiSelect={(emoji: EmojiMartEmoji) => onChange(emoji.native)}
          emojiSize={24}
          previewPosition="none"
        />
      </PopoverContent>
    </Popover>
  );
};

export default EmojiPicker;
