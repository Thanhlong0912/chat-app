import { SidebarInset } from "../ui/sidebar";
import ChatWelcomeScreen from "./ChatWelcomeScreen";
import ChatWindowHeader from "./ChatWindowHeader";
import ChatWindowBody from "./ChatWindowBody";
import MessageInput from "./MessageInput";
import ConnectionBanner from "./ConnectionBanner";
import { useActiveConversation } from "@/stores/useChatStore";

const ChatWindowLayout = () => {
  const selectedConvo = useActiveConversation();

  if (!selectedConvo) {
    return <ChatWelcomeScreen />;
  }

  /*
   * `messageLoading` không còn chặn cả cửa sổ.
   *
   * Trước đây một cờ loading toàn store làm cả layout bị thay bằng skeleton, tức
   * MessageInput bị unmount — và text người dùng đang gõ biến mất mỗi lần tải thêm
   * một trang tin nhắn cũ. Trạng thái tải nay nằm trong danh sách tin nhắn.
   */
  return (
    <SidebarInset className="flex h-full flex-1 flex-col overflow-hidden rounded-sm shadow-md">
      <ChatWindowHeader />

      <ConnectionBanner />

      <div className="flex min-h-0 flex-1 flex-col bg-primary-foreground">
        <ChatWindowBody />
      </div>

      <MessageInput selectedConvo={selectedConvo} />
    </SidebarInset>
  );
};

export default ChatWindowLayout;
