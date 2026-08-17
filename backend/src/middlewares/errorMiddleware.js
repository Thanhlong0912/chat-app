import { randomUUID } from "crypto";
import multer from "multer";
import { AppError } from "../utils/errors.js";
import logger from "../utils/logger.js";

/** Gắn một request id để log và response có thể đối chiếu với nhau. */
export const requestId = (req, res, next) => {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
};

/** Route không khớp — đặt sau tất cả các route, trước errorHandler. */
export const notFoundHandler = (req, res, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `Không tìm thấy ${req.method} ${req.originalUrl}`));
};

/**
 * Chuyển các loại lỗi đã biết thành AppError.
 * Trả về `null` nếu không nhận ra lỗi (sẽ thành 500).
 */
const normalize = (error) => {
  if (error instanceof AppError) return error;

  // Mongoose: id sai định dạng — là lỗi của client, không phải 500.
  if (error?.name === "CastError") {
    return new AppError(400, "INVALID_ID", `Giá trị không hợp lệ cho '${error.path}'`);
  }

  if (error?.name === "ValidationError") {
    return new AppError(400, "VALIDATION_ERROR", "Dữ liệu không hợp lệ", {
      fields: Object.keys(error.errors ?? {}),
    });
  }

  // Trùng unique index. `keyPattern` cho biết field nào, nên client hiển thị được
  // lỗi đúng chỗ thay vì nhận một 500 chung chung.
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern ?? error.keyValue ?? {})[0];
    return new AppError(409, "DUPLICATE_KEY", field ? `'${field}' đã được sử dụng` : "Dữ liệu bị trùng", {
      field,
    });
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return new AppError(status, `UPLOAD_${error.code}`, uploadMessage(error));
  }

  // express.json() khi body không phải JSON hợp lệ.
  if (error?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_JSON", "Body không phải JSON hợp lệ");
  }

  if (error?.type === "entity.too.large") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu quá lớn");
  }

  return null;
};

const uploadMessage = (error) => {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return "Tệp vượt quá dung lượng cho phép";
    case "LIMIT_FILE_COUNT":
      return "Chỉ được tải lên một tệp";
    case "LIMIT_UNEXPECTED_FILE":
      return `Trường tệp không mong đợi: '${error.field}'`;
    default:
      return "Tải tệp lên không thành công";
  }
};

/**
 * Error handler cuối cùng. Express 5 tự chuyển promise rejection từ handler async
 * sang đây, nên controller chỉ cần `throw` — không cần asyncHandler wrapper.
 */
// eslint-disable-next-line no-unused-vars -- Express nhận diện error handler qua arity 4
export const errorHandler = (error, req, res, next) => {
  const log = logger.child(req.id ?? "-");
  const normalized = normalize(error);

  if (!normalized) {
    // Lỗi ngoài dự kiến: log đầy đủ stack, nhưng không lộ chi tiết ra ngoài.
    log.error(`${req.method} ${req.originalUrl} thất bại`, error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Lỗi hệ thống",
      requestId: req.id,
    });
  }

  // 5xx là lỗi của chúng ta, 4xx là lỗi của client — log ở mức khác nhau.
  if (normalized.status >= 500) {
    log.error(`${req.method} ${req.originalUrl} → ${normalized.status}`, error);
  } else {
    log.warn(`${req.method} ${req.originalUrl} → ${normalized.status} ${normalized.code}`);
  }

  return res.status(normalized.status).json({
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details ? { details: normalized.details } : {}),
    requestId: req.id,
  });
};
