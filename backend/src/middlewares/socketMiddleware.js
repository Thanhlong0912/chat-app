import jwt from "jsonwebtoken";
import User from "../models/User.js";
import logger from "../utils/logger.js";

/**
 * Lỗi handshake của socket.
 *
 * `data` được socket.io gửi kèm tới client trong `connect_error`, nên client phân
 * biệt được "token hết hạn, hãy refresh rồi thử lại" với "token sai, hãy đăng
 * xuất". Không có nó thì client chỉ thấy một chuỗi message và không thể tự phục hồi.
 */
const handshakeError = (code, message) => {
  const error = new Error(message);
  error.data = { code };
  return error;
};

export const socketAuthMiddleware = async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(handshakeError("NO_ACCESS_TOKEN", "Unauthorized - Token không tồn tại"));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    // Token hết hạn là chuyện bình thường (access token sống ngắn), không phải
    // lỗi hệ thống — log ở mức warn để không gây nhiễu.
    if (error?.name === "TokenExpiredError") {
      logger.warn(`Socket bị từ chối: token hết hạn`);
      return next(handshakeError("TOKEN_EXPIRED", "Unauthorized - Token đã hết hạn"));
    }

    logger.warn(`Socket bị từ chối: token không hợp lệ`);
    return next(handshakeError("TOKEN_INVALID", "Unauthorized - Token không hợp lệ"));
  }

  try {
    const user = await User.findById(decoded.userId).select("-hashedPassword");

    if (!user) {
      return next(handshakeError("USER_NOT_FOUND", "User không tồn tại"));
    }

    socket.user = user;
    // Dùng ở Phase 3 để hẹn giờ yêu cầu client gửi token mới trước khi hết hạn.
    socket.tokenExp = decoded.exp;

    next();
  } catch (error) {
    logger.error("Lỗi khi tra cứu user trong socketMiddleware", error);
    next(handshakeError("INTERNAL_ERROR", "Unauthorized"));
  }
};
