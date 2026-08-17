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
   * Grid ba hàng thay vì flex.
   *
   * `minmax(0, 1fr)` cho hàng giữa là điểm mấu chốt: một grid row mặc định không co
   * xuống dưới kích thước nội dung của nó, nên nếu để `1fr` thì hàng tin nhắn sẽ
   * phình ra theo số tin và vùng cuộn lại tràn ra ngoài — đúng thứ đã xảy ra ở bản
   * cũ. Số 0 ở min mới cho phép hàng co lại và trao việc cuộn cho phần tử bên trong.
   *
   * `messageLoading` cũng không còn chặn cả cửa sổ: trước đây một cờ loading toàn
   * store làm layout bị thay bằng skeleton, tức MessageInput bị unmount và text
   * đang gõ biến mất mỗi lần tải thêm một trang tin nhắn cũ.
   */
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      {/*
        Header và banner phải nằm CHUNG một ô grid.

        `ConnectionBanner` trả về `null` khi đang kết nối bình thường, nên nếu để nó
        là một grid item riêng thì số con thay đổi theo trạng thái: lúc không có
        banner, mọi thứ dịch lên một hàng — danh sách tin nhắn nhận hàng `auto` (nở
        theo nội dung) và composer nhận hàng `1fr` (bị bóp còn ~24px rồi tràn ra
        ngoài). Bọc lại để số grid item luôn là ba.
      */}
      <div>
        <ChatWindowHeader />
        <ConnectionBanner />
      </div>

      <ChatWindowBody />
      <MessageInput selectedConvo={selectedConvo} />
    </div>
  );
};

export default ChatWindowLayout;
