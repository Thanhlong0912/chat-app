import { AxiosError } from "axios";

/** Hình dạng lỗi mà backend trả về (xem `utils/errors.js`). */
interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: { fields?: Record<string, string>; field?: string };
  requestId?: string;
}

/**
 * Thông báo lỗi để hiển thị cho người dùng.
 *
 * Backend trả `{code, message}` với `message` là tiếng Việt dành cho người đọc, nên
 * ưu tiên dùng nó. Chỉ khi không có mới rơi về câu chung — tuyệt đối không hiển thị
 * message của Error dạng "Request failed with status code 500".
 */
export function describeError(error: unknown): string {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined;

    if (body?.message) return body.message;

    /*
     * Không có response nghĩa là request chưa từng đến được server.
     *
     * Nguyên nhân hay gặp nhất không phải mạng người dùng, mà là backend đang ngủ:
     * nó chạy trên gói free của Render, không ai gọi trong ~15 phút thì tắt, và
     * request đánh thức mất 20–50 giây. Câu cũ chỉ nói "kiểm tra mạng", nên người
     * đọc đi kiểm tra đúng thứ không hỏng.
     */
    if (!error.response) {
      return "Không kết nối được tới server. Có thể server đang khởi động hoặc mạng có vấn đề, thử lại sau giây lát.";
    }

    return "Có lỗi xảy ra, vui lòng thử lại.";
  }

  if (error instanceof Error && error.message) return error.message;

  if (typeof error === "string") return error;

  return "Có lỗi xảy ra, vui lòng thử lại.";
}

/** Mã lỗi máy đọc, để phân nhánh mà không phải so chuỗi tiếng Việt. */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    return (error.response?.data as ApiErrorBody | undefined)?.code;
  }
  return undefined;
}

/** Lỗi theo từng field, để form tô đỏ đúng chỗ. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiErrorBody | undefined;
    return body?.details?.fields ?? {};
  }
  return {};
}
