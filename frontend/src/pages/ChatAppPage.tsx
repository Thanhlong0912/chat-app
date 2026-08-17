import ChatWindowLayout from "@/components/chat/ChatWindowLayout";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const ChatAppPage = () => {
  return (
    /*
      Chiều cao được cố định ở PROVIDER, không phải ở inset.

      Wrapper của SidebarProvider mặc định là `min-h-svh` — tức nó nở ra theo nội
      dung. Nếu đặt `h-dvh` lên `SidebarInset` thì phần margin `m-2` (mà variant
      "inset" thêm vào) bị cộng THÊM vào chiều cao đó, wrapper nở thành 100dvh+16px
      và cả trang có thanh cuộn dọc — composer bị đẩy xuống dưới mép màn hình.

      Ghim `h-dvh` ở wrapper rồi để inset tự co bằng flex thì margin được tính vào
      trong, không cộng thêm ra ngoài. `dvh` thay vì `vh` vì `100vh` không trừ thanh
      địa chỉ của trình duyệt mobile.
    */
    <SidebarProvider className="h-dvh overflow-hidden">
      <AppSidebar />

      {/*
        `SidebarInset` phải là SIBLING trực tiếp của phần tử mang `group peer`
        (chính là Sidebar). Trước đây nó bị bọc trong một <div> phụ, nên toàn bộ
        các class `md:peer-data-[variant=inset]:*` bên trong nó không bao giờ khớp
        — đó là lý do phải tự thêm `rounded-sm shadow-md` bằng tay.
      */}
      <SidebarInset className="min-h-0 overflow-hidden">
        <ChatWindowLayout />
      </SidebarInset>
    </SidebarProvider>
  );
};

export default ChatAppPage;
