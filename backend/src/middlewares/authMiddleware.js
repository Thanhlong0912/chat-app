import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isSessionActive } from "../services/sessionService.js";
import { unauthorized } from "../utils/errors.js";

/**
 * Xác minh access token và gắn `req.user`.
 *
 * Dùng `jwt.verify` dạng đồng bộ (không callback): trước đây callback được khai
 * báo `async`, nên rejection từ `User.findById` thoát khỏi try/catch bao ngoài và
 * trở thành unhandled rejection thay vì một response lỗi.
 *
 * Mọi thất bại ở đây là 401 (chưa xác thực). 403 được dành riêng cho phân quyền —
 * đã xác thực nhưng không có quyền — xem `membershipMiddleware.js`.
 */
export const protectedRoute = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

  if (!token) {
    throw unauthorized("NO_ACCESS_TOKEN", "Không tìm thấy access token");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    // Phân biệt hết hạn với không hợp lệ: client dùng code này để quyết định có
    // nên gọi refresh hay đăng xuất hẳn.
    if (error?.name === "TokenExpiredError") {
      throw unauthorized("TOKEN_EXPIRED", "Access token đã hết hạn");
    }

    throw unauthorized("TOKEN_INVALID", "Access token không hợp lệ");
  }

  // Access token mang `sid`, nên đăng xuất thu hồi được nó ngay thay vì phải chờ
  // hết hạn. Token cũ (chưa có `sid`) vẫn được chấp nhận cho tới khi hết hạn.
  if (decoded.sid && !(await isSessionActive(decoded.sid))) {
    throw unauthorized("SESSION_REVOKED", "Phiên đăng nhập đã kết thúc");
  }

  const user = await User.findById(decoded.userId).select("-hashedPassword");

  if (!user) {
    throw unauthorized("USER_NOT_FOUND", "Người dùng không tồn tại");
  }

  req.user = user;
  req.auth = decoded;

  next();
};
