/**
 * Vạch "Tin nhắn chưa đọc".
 *
 * Vị trí được tính MỘT LẦN khi mở cuộc trò chuyện rồi giữ nguyên cho tới khi đóng.
 * Nếu tính lại theo `lastReadAt` hiện tại thì vạch sẽ tự trôi xuống ngay khi
 * `markAsSeen` chạy — tức là biến mất đúng lúc người dùng cần nó nhất.
 */
const UnreadDivider = () => (
  <div className="flex items-center gap-3 py-2">
    <span className="h-px flex-1 bg-destructive/40" />
    <span className="text-xs font-medium text-destructive">Tin nhắn chưa đọc</span>
    <span className="h-px flex-1 bg-destructive/40" />
  </div>
);

export default UnreadDivider;
