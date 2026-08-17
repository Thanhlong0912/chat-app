import type { Participant } from "@/types/chat";
import UserAvatar from "./UserAvatar";
import { cn } from "@/lib/utils";

interface GroupChatAvatarProps {
  participants: Participant[];
  type: "chat" | "sidebar";
}

/** Kích thước phải khớp preset của UserAvatar, nếu không viên "+N" sẽ lệch hàng. */
const PILL_SIZE: Record<GroupChatAvatarProps["type"], string> = {
  chat: "size-8 text-[10px]",
  sidebar: "size-12 text-xs",
};

const MAX_AVATARS = 3;

const GroupChatAvatar = ({ participants, type }: GroupChatAvatarProps) => {
  const shown = participants.slice(0, MAX_AVATARS);
  const overflow = participants.length - shown.length;

  return (
    <div className="relative flex -space-x-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:ring-2">
      {shown.map((member) => (
        <UserAvatar
          key={member._id}
          type={type}
          name={member.displayName ?? ""}
          avatarUrl={member.avatarUrl ?? undefined}
        />
      ))}

      {overflow > 0 && (
        <div
          className={cn(
            "z-10 flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background",
            // Trước đây kích thước bị gán cứng `size-8`, nên khi dùng preset
            // "sidebar" (48px) viên này nhỏ hơn hẳn các avatar bên cạnh.
            PILL_SIZE[type]
          )}
          aria-label={`còn ${overflow} thành viên khác`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
};

export default GroupChatAvatar;
