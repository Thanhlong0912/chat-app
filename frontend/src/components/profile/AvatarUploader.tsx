import { useUserStore } from "@/stores/useUserStore";
import { useRef } from "react";
import { Button } from "../ui/button";
import { Camera } from "lucide-react";

const AvatarUploader = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { updateAvatarUrl } = useUserStore();

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();

    formData.append("file", file);

    try {
      await updateAvatarUrl(formData);
    } finally {
      // Xoá giá trị input để chọn LẠI đúng file đó vẫn bắn `change`. Không có dòng
      // này thì một lần tải lên hỏng sẽ khoá luôn việc thử lại với cùng tấm ảnh —
      // trình duyệt coi là không có gì thay đổi nên không bắn sự kiện.
      e.target.value = "";
    }
  };

  return (
    <>
      <Button
        size="icon"
        variant="secondary"
        onClick={handleClick}
        aria-label="Đổi ảnh đại diện"
        className="absolute -bottom-2 -right-2 size-9 rounded-full shadow-md hover:scale-115 transition duration-300 hover:bg-background"
      >
        <Camera className="size-4" />
      </Button>

      <input
        type="file"
        hidden
        // Backend vẫn tự lọc mimetype — `accept` chỉ để hộp thoại chọn file khỏi
        // hiện những thứ chắc chắn sẽ bị từ chối.
        accept="image/*"
        ref={fileInputRef}
        onChange={handleUpload}
      />
    </>
  );
};

export default AvatarUploader;
