import { Download, X } from "lucide-react";
import type { Attachment } from "@/types/chat";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";

interface MediaPreviewModalProps {
  attachment: Attachment | null;
  onClose: () => void;
}

/**
 * Xem ảnh / video cỡ lớn.
 *
 * Trước đây ảnh trong tin nhắn bị giới hạn `max-h-64` và không bấm được, nên
 * không có cách nào xem một ảnh cho rõ ngoài việc mở URL Cloudinary ở tab khác.
 *
 * Không dùng `DialogHeader` mặc định: khung xem nên là chính tệp đó, không phải
 * một hộp thoại có viền. Tiêu đề vẫn có nhưng chỉ dành cho screen reader —
 * Radix bắt buộc phải có `DialogTitle`, thiếu nó là cảnh báo a11y lúc chạy.
 */
const MediaPreviewModal = ({ attachment, onClose }: MediaPreviewModalProps) => {
  const isOpen = attachment !== null;
  const label = attachment?.originalName ?? (attachment?.kind === "video" ? "Video" : "Ảnh");

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        // Bỏ padding và nền của hộp thoại: nội dung nên chiếm trọn khung nhìn.
        className="max-w-[95vw] border-none bg-transparent p-0 shadow-none sm:max-w-4xl"
        // Nút đóng mặc định của Radix nằm chồng lên ảnh sáng và biến mất; ta tự
        // đặt một nút có nền riêng ở dưới.
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>

        <div className="relative flex max-h-[90vh] items-center justify-center">
          {attachment?.kind === "video" ? (
            <video
              src={attachment.url}
              controls
              autoPlay
              // `playsInline` để iOS không tự chuyển sang phát toàn màn hình, vốn
              // làm mất luôn hộp thoại phía dưới.
              playsInline
              className="max-h-[90vh] max-w-full rounded-lg"
            >
              Trình duyệt của bạn không phát được video này.
            </video>
          ) : (
            attachment && (
              <img
                src={attachment.url}
                alt={attachment.originalName ?? "Ảnh đã gửi"}
                className="max-h-[90vh] max-w-full rounded-lg object-contain"
              />
            )
          )}

          <div className="absolute right-2 top-2 flex gap-1">
            {/*
              Tải xuống mở tab mới thay vì dùng `download`.

              Cloudinary là origin khác, và thuộc tính `download` cross-origin bị
              trình duyệt bỏ qua — nút sẽ trông như hỏng. Mở tab mới thì người
              dùng luôn lưu được bằng menu chuột phải.
            */}
            {attachment && (
              <Button
                variant="secondary"
                size="icon"
                asChild
                aria-label="Mở tệp ở tab mới"
              >
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                </a>
              </Button>
            )}

            <Button
              variant="secondary"
              size="icon"
              onClick={onClose}
              aria-label="Đóng"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MediaPreviewModal;
