import type { Conversation, Message } from "@/types/chat";
import { useAuthStore } from "@/stores/useAuthStore";

/**
 * Tin nhắn hệ thống ("Long đã thêm Mai vào nhóm").
 *
 * Server ghi chúng như một message bình thường với `kind: "system"`, nên chúng đi
 * qua đúng đường realtime và đúng thứ tự phân trang như mọi tin nhắn khác — vừa là
 * thông báo, vừa là dấu vết kiểm toán ngay trong luồng chat.
 */
const SystemMessage = ({
  message,
  conversation,
}: {
  message: Message;
  conversation: Conversation;
}) => {
  const meId = useAuthStore((s) => s.user?._id);

  const nameOf = (userId: string | null) => {
    if (!userId) return "Ai đó";
    if (userId === meId) return "Bạn";

    return (
      conversation.participants.find((p) => p._id === userId)?.displayName ?? "Một thành viên"
    );
  };

  const event = message.systemEvent;
  if (!event) return null;

  const actor = nameOf(event.actorId);
  const targets = event.targetIds.map(nameOf).join(", ");
  const meta = (event.meta ?? {}) as { to?: string; role?: string };

  const text = (() => {
    switch (event.type) {
      case "group_created":
        return `${actor} đã tạo nhóm`;
      case "member_added":
        return `${actor} đã thêm ${targets} vào nhóm`;
      case "member_removed":
        return `${actor} đã xoá ${targets} khỏi nhóm`;
      case "member_left":
        return `${actor} đã rời nhóm`;
      case "group_renamed":
        return `${actor} đã đổi tên nhóm thành "${meta.to}"`;
      case "group_avatar_changed":
        return `${actor} đã đổi ảnh nhóm`;
      case "role_changed":
        return meta.role === "owner"
          ? `${actor} đã chuyển quyền chủ nhóm cho ${targets}`
          : meta.role === "admin"
            ? `${actor} đã bổ nhiệm ${targets} làm quản trị viên`
            : `${actor} đã gỡ quyền quản trị của ${targets}`;
      default:
        return null;
    }
  })();

  if (!text) return null;

  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground">
        {text}
      </span>
    </div>
  );
};

export default SystemMessage;
