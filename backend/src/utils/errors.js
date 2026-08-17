/**
 * Lỗi có chủ đích của ứng dụng.
 *
 * `code` là một chuỗi ổn định dành cho máy đọc (ví dụ "NOT_A_MEMBER"), để client
 * phân nhánh mà không phải parse `message` — vốn là tiếng Việt và dành cho người đọc.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    // Bỏ constructor khỏi stack trace cho dễ đọc.
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (code, message, details) =>
  new AppError(400, code, message ?? "Yêu cầu không hợp lệ", details);

export const unauthorized = (code, message, details) =>
  new AppError(401, code, message ?? "Bạn cần đăng nhập", details);

export const forbidden = (code, message, details) =>
  new AppError(403, code, message ?? "Bạn không có quyền thực hiện việc này", details);

export const notFound = (code, message, details) =>
  new AppError(404, code, message ?? "Không tìm thấy", details);

export const conflict = (code, message, details) =>
  new AppError(409, code, message ?? "Dữ liệu bị trùng", details);

export const payloadTooLarge = (code, message, details) =>
  new AppError(413, code, message ?? "Dữ liệu quá lớn", details);

export const tooManyRequests = (code, message, details) =>
  new AppError(429, code, message ?? "Bạn thao tác quá nhanh, hãy thử lại sau", details);

export const isAppError = (error) => error instanceof AppError;
