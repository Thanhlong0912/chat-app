import { useCallback } from "react";
import { useChatStore } from "@/stores/useChatStore";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Chọn một conversation.
 *
 * Gom một chỗ vì mỗi card trước đây tự làm, và tất cả đều thiếu
 * `setOpenMobile(false)`: trên điện thoại, sidebar là một Sheet phủ toàn màn hình,
 * nên chọn một cuộc trò chuyện xong thì lớp phủ vẫn che đúng cái vừa mở — không có
 * cách nào thấy tin nhắn ngoài việc tự đóng sheet.
 */
export function useSelectConversation() {
  const { setOpenMobile, isMobile } = useSidebar();

  return useCallback(
    (conversationId: string) => {
      const { setActiveConversation, messages, fetchMessages } = useChatStore.getState();

      setActiveConversation(conversationId);

      // Chỉ tải khi chưa có; mở lại một cuộc trò chuyện đã đọc không cần gọi API.
      if (!messages[conversationId]) {
        void fetchMessages(conversationId);
      }

      if (isMobile) setOpenMobile(false);
    },
    [isMobile, setOpenMobile],
  );
}
