import jwt from "jsonwebtoken";
import User from "../../models/User.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../events.js";
import { isSessionActive } from "../../services/sessionService.js";
import logger from "../../utils/logger.js";

/**
 * Gia hạn xác thực cho một socket đang mở.
 *
 * Trước đây access token chỉ được kiểm tra một lần lúc handshake, rồi socket sống
 * vô thời hạn — nên một người đã đăng xuất vẫn tiếp tục nhận tin nhắn realtime cho
 * tới khi họ tự đóng tab.
 *
 * Cách làm: hẹn giờ trước thời điểm token hết hạn, xin client một token mới, và
 * ngắt kết nối nếu không nhận được. Client cũng cần token còn hiệu lực để kết nối
 * lại, nên việc này không tạo thêm gánh nặng nào cho nó.
 */

/** Xin token mới trước khi hết hạn bao lâu. */
const REAUTH_LEAD_MS = 60_000;

/** Chờ client trả lời bao lâu trước khi ngắt. */
const REAUTH_GRACE_MS = 30_000;

export function registerAuthHandlers(socket) {
  let reauthTimer = null;
  let disconnectTimer = null;

  const clearTimers = () => {
    if (reauthTimer) clearTimeout(reauthTimer);
    if (disconnectTimer) clearTimeout(disconnectTimer);
    reauthTimer = null;
    disconnectTimer = null;
  };

  const scheduleReauth = (expSeconds) => {
    clearTimers();

    if (!expSeconds) return;

    const msUntilExpiry = expSeconds * 1000 - Date.now();
    // Nếu token đã gần hết hạn thì hỏi ngay.
    const delay = Math.max(msUntilExpiry - REAUTH_LEAD_MS, 0);

    reauthTimer = setTimeout(() => {
      socket.emit(SERVER_EVENTS.AUTH_REAUTH, {});

      disconnectTimer = setTimeout(() => {
        logger.warn(`Ngắt socket ${socket.id}: không gia hạn token`);
        socket.disconnect(true);
      }, REAUTH_GRACE_MS);
    }, delay);
  };

  socket.on(CLIENT_EVENTS.AUTH_TOKEN, async (payload, ack) => {
    const token = typeof payload === "string" ? payload : payload?.token;

    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

      // Token mới phải thuộc CÙNG một user. Nếu không, một người có thể "cướp"
      // socket đang mở của người khác bằng token của chính mình.
      if (String(decoded.userId) !== String(socket.user._id)) {
        throw new Error("token thuộc user khác");
      }

      if (decoded.sid && !(await isSessionActive(decoded.sid))) {
        throw new Error("session đã bị thu hồi");
      }

      // Làm mới bản sao user trên socket: displayName / avatar có thể đã đổi.
      const fresh = await User.findById(decoded.userId).select("-hashedPassword");
      if (!fresh) throw new Error("user không tồn tại");

      socket.user = fresh;
      socket.tokenExp = decoded.exp;
      scheduleReauth(decoded.exp);

      if (typeof ack === "function") ack({ ok: true });
    } catch (error) {
      logger.warn(`Gia hạn token thất bại cho socket ${socket.id}: ${error.message}`);

      if (typeof ack === "function") ack({ ok: false, code: "TOKEN_INVALID" });

      socket.disconnect(true);
    }
  });

  socket.on("disconnect", clearTimers);

  scheduleReauth(socket.tokenExp);
}
