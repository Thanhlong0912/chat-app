import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { Conversation } from "@/types/chat";
import type { Friend } from "@/types/user";
import { useFriendStore } from "@/stores/useFriendStore";
import { useGroupActions } from "@/hooks/useGroupActions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import IniviteSuggestionList from "../newGroupChat/IniviteSuggestionList";
import SelectedUsersList from "../newGroupChat/SelectedUsersList";

/** Thêm bạn bè vào một nhóm đã có. Dùng lại đúng hai component của luồng tạo nhóm. */
const AddMembersDialog = ({ conversation }: { conversation: Conversation }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Friend[]>([]);

  const friends = useFriendStore((s) => s.friends);
  const actions = useGroupActions(conversation._id);

  const memberIds = new Set(conversation.participants.map((p) => p._id));

  const candidates = friends.filter(
    (friend) =>
      friend.displayName.toLowerCase().includes(search.toLowerCase()) &&
      // Người đã ở trong nhóm không nên xuất hiện trong gợi ý.
      !memberIds.has(friend._id) &&
      !selected.some((u) => u._id === friend._id),
  );

  const submit = async () => {
    const result = await actions.addMembers(selected.map((u) => u._id));

    if (result) {
      setSelected([]);
      setSearch("");
      setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void useFriendStore.getState().getFriends();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
        >
          <UserPlus className="size-4" />
          Thêm thành viên
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Thêm thành viên</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="add-member-search">Tìm bạn bè</Label>
          <Input
            id="add-member-search"
            placeholder="Tìm theo tên hiển thị..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Hiện ngay khi mở, không đợi gõ — xem ghi chú ở NewGroupChatModal. */}
          {candidates.length > 0 && (
            <IniviteSuggestionList
              filteredFriends={candidates}
              onSelect={(friend) => {
                setSelected([...selected, friend]);
                setSearch("");
              }}
            />
          )}

          {candidates.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              {search
                ? "Không tìm thấy bạn bè nào phù hợp."
                : "Tất cả bạn bè của bạn đã ở trong nhóm này."}
            </p>
          )}

          <SelectedUsersList
            invitedUsers={selected}
            onRemove={(friend) => setSelected(selected.filter((u) => u._id !== friend._id))}
          />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={selected.length === 0 || actions.pending}
            className="flex-1"
          >
            Thêm {selected.length > 0 && `(${selected.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddMembersDialog;
