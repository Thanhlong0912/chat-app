import { useState } from "react";
import { useFriendStore } from "@/stores/useFriendStore";
import { Card } from "../ui/card";
import { Dialog, DialogTrigger } from "../ui/dialog";
import { MessageCircle } from "lucide-react";
import FriendListModal from "../createNewChat/FriendListModal";

const CreateNewChat = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex gap-2">
      <Dialog
        open={open}
        /*
          Nạp danh sách bạn bè khi MỞ modal.

          Trước đây `onClick` nằm trên <Card> bọc ngoài <Dialog>. Radix portal nội
          dung modal ra <body>, nhưng sự kiện React vẫn nổi bọt theo CÂY REACT — nên
          mỗi lần bấm vào bất cứ đâu bên trong modal đều gọi lại `getFriends()`.
        */
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void useFriendStore.getState().getFriends();
        }}
      >
        {/*
          Trigger bọc cả thẻ, và tự nó là <button> thật: bấm vào đâu trong thẻ cũng
          mở được, thay vì chỉ trúng phần nội dung bên trong như trước.
        */}
        <DialogTrigger className="group/card flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Card className="cursor-pointer p-3 glass transition-smooth hover:shadow-soft">
            <div className="flex items-center gap-4">
              <div className="size-8 bg-gradient-chat rounded-full flex items-center justify-center group-hover/card:scale-110 transition-bounce">
                <MessageCircle className="size-4 text-white" />
              </div>
              <span className="text-sm font-medium capitalize">
                gửi tin nhắn mới
              </span>
            </div>
          </Card>
        </DialogTrigger>

        <FriendListModal onCreated={() => setOpen(false)} />
      </Dialog>
    </div>
  );
};

export default CreateNewChat;
