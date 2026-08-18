import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import type { Conversation } from "@/types/chat";
import { useGroupActions } from "@/hooks/useGroupActions";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import MemberList from "./MemberList";
import GroupSettingsForm from "./GroupSettingsForm";
import AddMembersDialog from "./AddMembersDialog";
import ConfirmDialog from "./ConfirmDialog";

interface GroupInfoPanelProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bảng thông tin nhóm.
 *
 * Dùng Sheet cho cả desktop lẫn mobile: trên desktop nó là một rail bên phải, trên
 * mobile là tấm trượt toàn màn hình — cùng một component, không phải dựng hai layout.
 */
const GroupInfoPanel = ({ conversation, open, onOpenChange }: GroupInfoPanelProps) => {
  const actions = useGroupActions(conversation._id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAdmin = conversation.myRole === "owner" || conversation.myRole === "admin";
  const isOwner = conversation.myRole === "owner";
  const isLastMember = conversation.participants.length === 1;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Thông tin nhóm</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          {isAdmin ? (
            <GroupSettingsForm conversation={conversation} />
          ) : (
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">{conversation.group?.name}</h3>
              {conversation.group?.description && (
                <p className="text-sm text-muted-foreground">
                  {conversation.group.description}
                </p>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">
                Thành viên ({conversation.participants.length})
              </h4>
            </div>

            {/* Chỉ owner/admin mới thêm được thành viên. */}
            {isAdmin && <AddMembersDialog conversation={conversation} />}

            <MemberList conversation={conversation} />
          </div>

          <Separator />

          <div className="space-y-2">
            <Button
              variant="destructiveOutline"
              className="w-full"
              onClick={() => setConfirmLeave(true)}
              disabled={actions.pending}
            >
              <LogOut className="size-4" />
              Rời nhóm
            </Button>

            {isOwner && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => setConfirmDelete(true)}
                disabled={actions.pending}
              >
                <Trash2 className="size-4" />
                Xoá nhóm
              </Button>
            )}
          </div>
        </div>
      </SheetContent>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Rời khỏi nhóm này?"
        description={
          isLastMember
            ? "Bạn là thành viên cuối cùng, nên nhóm và toàn bộ tin nhắn sẽ bị xoá."
            : isOwner
              ? "Bạn là chủ nhóm, quyền sẽ được chuyển cho thành viên lâu năm nhất."
              : "Bạn sẽ không còn nhận được tin nhắn của nhóm này."
        }
        confirmLabel="Rời nhóm"
        onConfirm={() => {
          void actions.leave();
          onOpenChange(false);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xoá nhóm này?"
        description="Toàn bộ tin nhắn sẽ bị xoá vĩnh viễn với tất cả thành viên. Không thể hoàn tác."
        confirmLabel="Xoá nhóm"
        onConfirm={() => {
          void actions.remove();
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
};

export default GroupInfoPanel;
