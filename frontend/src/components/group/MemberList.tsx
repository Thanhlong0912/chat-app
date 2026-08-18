import { useState } from "react";
import { Crown, MoreVertical, Shield, UserMinus } from "lucide-react";
import type { Conversation, GroupRole, Participant } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePresence } from "@/stores/useSocketStore";
import { useGroupActions } from "@/hooks/useGroupActions";
import UserAvatar from "../chat/UserAvatar";
import StatusBadge from "../chat/StatusBadge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import ConfirmDialog from "./ConfirmDialog";

const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "Chủ nhóm",
  admin: "Quản trị viên",
  member: "Thành viên",
};

/**
 * Ai được làm gì với ai.
 *
 * Bản sao rút gọn của `domain/groupPermissions.js` phía server, dùng để ẩn/hiện
 * nút. Server vẫn là nơi ép quyền thật — ở đây chỉ để không hiện những nút mà bấm
 * vào sẽ nhận 403.
 */
const canRemove = (actorRole: GroupRole | null, targetRole: GroupRole) => {
  if (targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
};

const MemberRow = ({
  participant,
  conversation,
}: {
  participant: Participant;
  conversation: Conversation;
}) => {
  const meId = useAuthStore((s) => s.user?._id);
  const presence = usePresence(participant._id);
  const actions = useGroupActions(conversation._id);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const role = (participant.role ?? "member") as GroupRole;
  const myRole = conversation.myRole;
  const isMe = participant._id === meId;

  const showMenu =
    !isMe && (canRemove(myRole, role) || (myRole === "owner" && role !== "owner"));

  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <div className="relative shrink-0">
        <UserAvatar
          type="chat"
          name={participant.displayName ?? ""}
          avatarUrl={participant.avatarUrl ?? undefined}
        />
        <StatusBadge status={presence} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {participant.displayName}
          {isMe && <span className="text-muted-foreground"> (bạn)</span>}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {role === "owner" && <Crown className="size-3" />}
          {role === "admin" && <Shield className="size-3" />}
          {ROLE_LABEL[role]}
        </p>
      </div>

      {/*
        `modal={false}` — xem ghi chú cùng lý do ở `MessageActions`: menu ở chế độ
        modal chồng lớp với `ConfirmDialog` mở ngay sau nó, và để lại
        `pointer-events: none` trên thẻ body.
      */}
      {showMenu && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Tuỳ chọn cho ${participant.displayName}`}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {myRole === "owner" && role === "member" && (
              <DropdownMenuItem onClick={() => actions.setRole(participant._id, "admin")}>
                <Shield className="size-4" />
                Bổ nhiệm quản trị viên
              </DropdownMenuItem>
            )}

            {myRole === "owner" && role === "admin" && (
              <DropdownMenuItem onClick={() => actions.setRole(participant._id, "member")}>
                <Shield className="size-4" />
                Gỡ quyền quản trị
              </DropdownMenuItem>
            )}

            {myRole === "owner" && (
              <DropdownMenuItem onClick={() => actions.setRole(participant._id, "owner")}>
                <Crown className="size-4" />
                Chuyển quyền chủ nhóm
              </DropdownMenuItem>
            )}

            {canRemove(myRole, role) && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmRemove(true)}
              >
                <UserMinus className="size-4" />
                Xoá khỏi nhóm
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Xoá ${participant.displayName} khỏi nhóm?`}
        description="Họ sẽ không còn nhận được tin nhắn của nhóm này nữa."
        confirmLabel="Xoá khỏi nhóm"
        onConfirm={() => actions.removeMember(participant._id)}
      />
    </li>
  );
};

const MemberList = ({ conversation }: { conversation: Conversation }) => {
  // Chủ nhóm trước, rồi quản trị viên, rồi thành viên.
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  const sorted = [...conversation.participants].sort(
    (a, b) => (order[a.role ?? "member"] ?? 2) - (order[b.role ?? "member"] ?? 2),
  );

  return (
    <ul className="divide-y divide-border/60">
      {sorted.map((participant) => (
        <MemberRow
          key={participant._id}
          participant={participant}
          conversation={conversation}
        />
      ))}
    </ul>
  );
};

export default MemberList;
