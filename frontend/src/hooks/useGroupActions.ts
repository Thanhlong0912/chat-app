import { useCallback, useState } from "react";
import { toast } from "sonner";
import { groupService } from "@/services/groupService";
import { useChatStore } from "@/stores/useChatStore";
import { describeError } from "@/lib/errors";
import type { GroupRole } from "@/types/chat";

/**
 * Các thao tác quản lý nhóm, kèm trạng thái đang xử lý và toast lỗi.
 *
 * Server đã phát `conversation:updated` cho cả room, nên bình thường store tự cập
 * nhật qua socket. Ta vẫn ghi kết quả trả về vào store để giao diện phản hồi ngay
 * cả khi socket đang gián đoạn.
 */
export function useGroupActions(conversationId: string) {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T>(action: () => Promise<T>, successMessage?: string): Promise<T | null> => {
      setPending(true);

      try {
        const result = await action();
        if (successMessage) toast.success(successMessage);
        return result;
      } catch (error) {
        toast.error(describeError(error));
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const upsert = useChatStore((s) => s.upsertConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);

  return {
    pending,

    rename: (name: string) =>
      run(async () => {
        const conversation = await groupService.updateInfo(conversationId, { name });
        upsert(conversation);
        return conversation;
      }, "Đã đổi tên nhóm"),

    updateDescription: (description: string) =>
      run(async () => {
        const conversation = await groupService.updateInfo(conversationId, {
          description: description || null,
        });
        upsert(conversation);
        return conversation;
      }, "Đã cập nhật mô tả"),

    uploadAvatar: (file: File) =>
      run(async () => {
        const conversation = await groupService.uploadAvatar(conversationId, file);
        upsert(conversation);
        return conversation;
      }, "Đã cập nhật ảnh nhóm"),

    addMembers: (memberIds: string[]) =>
      run(async () => {
        const { conversation, added } = await groupService.addMembers(
          conversationId,
          memberIds,
        );
        upsert(conversation);

        // Thêm người đã ở trong nhóm là no-op ở server; nói rõ thay vì báo thành
        // công một việc không xảy ra.
        toast[added.length > 0 ? "success" : "info"](
          added.length > 0
            ? `Đã thêm ${added.length} thành viên`
            : "Những người này đã ở trong nhóm",
        );

        return conversation;
      }),

    removeMember: (userId: string) =>
      run(async () => {
        const conversation = await groupService.removeMember(conversationId, userId);
        upsert(conversation);
        return conversation;
      }, "Đã xoá thành viên khỏi nhóm"),

    setRole: (userId: string, role: GroupRole) =>
      run(async () => {
        const conversation =
          role === "owner"
            ? await groupService.transferOwnership(conversationId, userId)
            : await groupService.setRole(conversationId, userId, role);

        upsert(conversation);
        return conversation;
      }, "Đã cập nhật vai trò"),

    leave: () =>
      run(async () => {
        await groupService.leave(conversationId);
        // Server cũng phát conversation:removed, nhưng dọn ngay để UI không đứng
        // lại ở một cuộc trò chuyện mình vừa rời.
        removeConversation(conversationId);
        return true;
      }, "Đã rời nhóm"),

    remove: () =>
      run(async () => {
        await groupService.remove(conversationId);
        removeConversation(conversationId);
        return true;
      }, "Đã xoá nhóm"),
  };
}
