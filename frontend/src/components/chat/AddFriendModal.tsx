import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { UserPlus } from "lucide-react";
import type { User } from "@/types/user";
import { useFriendStore } from "@/stores/useFriendStore";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { describeError } from "@/lib/errors";
import SearchForm from "@/components/AddFriendModal/SearchForm";
import SendFriendRequestForm from "@/components/AddFriendModal/SendFriendRequestForm";

export interface IFormValues {
  message: string;
}

/** Đợi người dùng ngừng gõ trước khi gọi API. */
const SEARCH_DEBOUNCE_MS = 250;

const AddFriendModal = () => {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);

  const loading = useFriendStore((s) => s.loading);
  const addFriend = useFriendStore((s) => s.addFriend);

  const { register, handleSubmit, reset } = useForm<IFormValues>({
    defaultValues: { message: "" },
  });

  /*
   * Mỗi lần gõ là một lượt tìm, sau khi ngừng gõ 250ms.
   *
   * `requestId` chống race: hai lượt tìm chồng nhau có thể về không đúng thứ tự
   * đã gửi, và nếu cứ ghi thẳng thì kết quả của từ khoá cũ đè lên từ khoá mới.
   */
  const requestId = useRef(0);

  useEffect(() => {
    const query = term.trim();

    if (!query) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      const found = await useFriendStore.getState().searchByUsername(query);

      // Lượt tìm đã cũ thì bỏ kết quả đi.
      if (id !== requestId.current) return;

      setResults(found);
      setSearched(true);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term]);

  const handleSend = handleSubmit(async (data) => {
    if (!selected) return;

    try {
      const message = await addFriend(selected._id, data.message.trim());

      toast.success(message);
      resetAll();
      setOpen(false);
    } catch (error) {
      /*
       * Thất bại phải hiện ra như thất bại, và modal phải ở nguyên đó.
       *
       * Trước đây `addFriend` nuốt lỗi rồi trả về chính chuỗi mô tả lỗi, đúng vị
       * trí mà thành công trả về "Gửi lời mời kết bạn thành công" — nên "Đã có
       * lời mời đang chờ" hiện lên dưới dạng toast XANH và modal đóng lại như thể
       * đã gửi xong.
       */
      toast.error(describeError(error));
    }
  });

  const resetAll = () => {
    reset();
    setTerm("");
    setResults([]);
    setSearched(false);
    setSelected(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Mở lại thì bắt đầu từ ô tìm kiếm, không phải từ trạng thái lần trước.
        if (!next) resetAll();
      }}
    >
      {/* <button> thật, không phải div: div có onClick không nhận focus bàn phím và
          screen reader không biết đó là thứ bấm được. Vùng chạm cũng nới từ 20px lên
          36px — 20px thấp hơn nhiều so với mức tối thiểu khuyến nghị cho ngón tay. */}
      <DialogTrigger
        className="z-10 flex size-9 items-center justify-center rounded-full transition-smooth hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Kết bạn"
      >
        <UserPlus className="size-4" />
      </DialogTrigger>

      <DialogContent className="border-none sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Kết Bạn</DialogTitle>
        </DialogHeader>

        {selected ? (
          <SendFriendRequestForm
            register={register}
            loading={loading}
            recipient={selected}
            onSubmit={handleSend}
            onBack={() => setSelected(null)}
          />
        ) : (
          <SearchForm
            term={term}
            onTermChange={setTerm}
            loading={searching}
            results={results}
            searched={searched}
            onSelect={setSelected}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AddFriendModal;
