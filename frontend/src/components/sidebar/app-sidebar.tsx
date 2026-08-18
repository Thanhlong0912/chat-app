import { NavUser } from "@/components/sidebar/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Moon, Sun } from "lucide-react";
import ConversationSearch from "./ConversationSearch";
import { Switch } from "../ui/switch";
import CreateNewChat from "../chat/CreateNewChat";
import NewGroupChatModal from "../chat/NewGroupChatModal";
import GroupChatList from "../chat/GroupChatList";
import AddFriendModal from "../chat/AddFriendModal";
import DirectMessageList from "../chat/DirectMessageList";
import { useThemeStore } from "@/stores/useThemeStore";
import { useAuthStore } from "@/stores/useAuthStore";
import ConversationSkeleton from "../skeleton/ConversationSkeleton";
import { useChatStore } from "@/stores/useChatStore";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { isDark, toggleTheme } = useThemeStore();
  const { user } = useAuthStore();
  const { convoLoading } = useChatStore();

  return (
    <Sidebar
      variant="inset"
      {...props}
    >
      {/* Header */}
      <SidebarHeader>
        {/*
          Là <div>, KHÔNG phải `<a href="#">` bọc quanh một <Switch>.

          Cấu trúc cũ vừa lồng control trong control (HTML không hợp lệ, và bấm vào
          switch cũng kích hoạt cả link), vừa là một liên kết chẳng dẫn đi đâu — screen
          reader đọc nó ra như một liên kết có thể theo được. Nay switch là control
          duy nhất, và có nhãn hẳn hoi.
        */}
        <div className="flex w-full items-center justify-between rounded-md bg-gradient-primary px-4 py-3">
          <h1 className="text-xl font-bold text-white">Moji</h1>

          <div className="flex items-center gap-2">
            <Sun
              className="size-4 text-white/80"
              aria-hidden="true"
            />
            <Switch
              checked={isDark}
              onCheckedChange={toggleTheme}
              aria-label="Chế độ tối"
              className="data-[state=checked]:bg-background/80"
            />
            <Moon
              className="size-4 text-white/80"
              aria-hidden="true"
            />
          </div>
        </div>

        <ConversationSearch />
      </SidebarHeader>

      {/* Content */}
      <SidebarContent className="beautiful-scrollbar">
        {/* New Chat */}
        <SidebarGroup>
          <SidebarGroupContent>
            <CreateNewChat />
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Group Chat */}
        <SidebarGroup>
          <div className="flex items-center justify-between">
            <SidebarGroupLabel className="uppercase">nhóm chat</SidebarGroupLabel>
            <NewGroupChatModal />
          </div>

          <SidebarGroupContent>
            {convoLoading ? <ConversationSkeleton /> : <GroupChatList />}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Dirrect Message */}
        <SidebarGroup>
          {/*
            Không bọc trong `SidebarGroupAction`: component đó tự render một
            <button>, và trigger của Dialog cũng là một <button> — lồng button trong
            button là HTML không hợp lệ và làm hỏng cả điều hướng bàn phím. Dùng cùng
            một hàng flex như nhóm chat ở trên, để trigger tự là button duy nhất.
          */}
          <div className="flex items-center justify-between">
            <SidebarGroupLabel className="uppercase">bạn bè</SidebarGroupLabel>
            <AddFriendModal />
          </div>

          <SidebarGroupContent>
            {convoLoading ? <ConversationSkeleton /> : <DirectMessageList />}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>{user && <NavUser user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
