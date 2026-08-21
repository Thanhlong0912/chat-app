import type { UseFormRegister } from "react-hook-form";
import type { IFormValues } from "../chat/AddFriendModal";
import type { User } from "@/types/user";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { UserPlus } from "lucide-react";
import UserAvatar from "../chat/UserAvatar";

interface SendRequestProps {
  register: UseFormRegister<IFormValues>;
  loading: boolean;
  recipient: User;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}

const SendFriendRequestForm = ({
  register,
  loading,
  recipient,
  onSubmit,
  onBack,
}: SendRequestProps) => {
  return (
    <form onSubmit={onSubmit}>
      <div className="space-y-4">
        {/* Người nhận hiện rõ ràng: sau khi chọn từ danh sách, cần thấy chắc chắn
            mình đang gửi cho ai trước khi bấm. */}
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <UserAvatar
            type="chat"
            name={recipient.displayName}
            avatarUrl={recipient.avatarUrl}
          />

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{recipient.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">@{recipient.username}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="message"
            className="text-sm font-semibold"
          >
            Giới thiệu
          </Label>
          <Textarea
            id="message"
            rows={3}
            placeholder="Chào bạn ~ Có thể kết bạn được không?..."
            className="glass resize-none border-border/50 transition-smooth focus:border-primary/50"
            {...register("message")}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="glass flex-1 hover:text-destructive"
            onClick={onBack}
          >
            Quay lại
          </Button>

          <Button
            type="submit"
            disabled={loading}
            className="flex-1 bg-gradient-chat text-white transition-smooth hover:opacity-90"
          >
            {loading ? (
              <span>Đang gửi...</span>
            ) : (
              <>
                <UserPlus className="mr-2 size-4" /> Kết Bạn
              </>
            )}
          </Button>
        </DialogFooter>
      </div>
    </form>
  );
};

export default SendFriendRequestForm;
