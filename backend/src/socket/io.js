/**
 * Singleton giữ instance Socket.IO.
 *
 * Tồn tại để phá vòng import: trước đây `socket/index.js` import controller để
 * lấy danh sách conversation, còn controller lại import `io` từ `socket/index.js`.
 * Vòng lặp đó khiến không thể khởi tạo `io` trong test mà không kéo theo toàn bộ
 * controller, và ngược lại.
 *
 * Controller gọi `getIo()` tại thời điểm chạy thay vì import biến `io` trực tiếp.
 */
let currentIo = null;

export const setIo = (io) => {
  currentIo = io;
};

/**
 * Trả về instance Socket.IO, hoặc `null` nếu chưa được khởi tạo.
 *
 * Trả `null` thay vì throw là có chủ đích: trong unit test của controller thường
 * không có server socket nào chạy, và việc không phát được realtime event không
 * nên làm fail một request HTTP vốn đã ghi dữ liệu thành công.
 */
export const getIo = () => currentIo;

export const resetIo = () => {
  currentIo = null;
};
