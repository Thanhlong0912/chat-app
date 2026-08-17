import { Server } from "socket.io";
import { socketAuthMiddleware } from "../middlewares/socketMiddleware.js";
import { getUserConversationIds } from "../services/conversationService.js";
import { SERVER_EVENTS, conversationRoom } from "./events.js";
import { registerAuthHandlers } from "./handlers/auth.js";
import { registerConversationHandlers } from "./handlers/conversation.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { onPresenceConnect, registerPresenceHandlers } from "./handlers/presence.js";
import { registerReadHandlers } from "./handlers/read.js";
import { registerSyncHandlers } from "./handlers/sync.js";
import { registerTypingHandlers } from "./handlers/typing.js";
import logger from "../utils/logger.js";

/**
 * Tạo Socket.IO server gắn vào một http server có sẵn.
 *
 * Không tự tạo express app / http server, và không import controller nào, nên test
 * có thể dựng io độc lập.
 */
export function createIo(httpServer, { corsOrigin } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    /*
     * Cho phép cả polling, không chỉ websocket.
     *
     * Một số proxy doanh nghiệp chặn WebSocket; không có fallback thì với những
     * người dùng đó realtime đơn giản là không hoạt động. Đây cũng là lý do việc
     * sửa CORS origin (Phase 0) trở nên thực sự quan trọng: handshake polling đi
     * qua preflight, còn nâng cấp WebSocket thì không.
     */
    transports: ["websocket", "polling"],
  });

  io.use(socketAuthMiddleware);
  registerHandlers(io);

  return io;
}

function registerHandlers(io) {
  // Cố tình KHÔNG phải async handler.
  //
  // Mọi listener phải được đăng ký đồng bộ, trước bất kỳ `await` nào: nếu handler
  // dừng ở await, socket.io vẫn tiếp tục nhận dữ liệu, và event nào tới trong
  // khoảng đó sẽ bị bỏ im lặng vì chưa có listener. Điều đó khiến một client emit
  // `conversation:subscribe` ngay sau khi connect có thể không bao giờ được xử lý,
  // và một socket ngắt kết nối thật nhanh sẽ để lại entry presence rác vì
  // `disconnect` chưa kịp được đăng ký.
  io.on("connection", (socket) => {
    registerAuthHandlers(socket);
    registerConversationHandlers(socket);
    registerMessageHandlers(socket);
    registerReadHandlers(socket);
    registerSyncHandlers(socket);
    registerTypingHandlers(socket);
    registerPresenceHandlers(io, socket);

    socket.on("error", (error) => {
      logger.warn(`Lỗi socket ${socket.id}`, error);
    });

    // Phần async đặt sau khi listener đã sẵn sàng.
    bootstrapConnection(io, socket).catch((error) => {
      logger.error(`Lỗi khi khởi tạo socket ${socket.id}`, error);
    });
  });
}

/**
 * Việc cần I/O sau khi kết nối: vào các room, ghi presence, gửi snapshot.
 */
async function bootstrapConnection(io, socket) {
  const user = socket.user;

  await onPresenceConnect(io, socket);

  const conversationIds = await getUserConversationIds(user._id);

  // Socket có thể đã ngắt trong lúc chờ query.
  if (!socket.connected) return;

  conversationIds.forEach((id) => socket.join(conversationRoom(id)));

  // Báo cho client biết đã vào xong các room. Sự kiện `connect` của socket.io chỉ
  // nói rằng transport đã sẵn sàng, không nói rằng server đã join room — nên nếu
  // không có tín hiệu này thì tồn tại một khoảng client tưởng mình đang nhận tin
  // của conversation nhưng thực tế thì chưa.
  socket.emit(SERVER_EVENTS.CONNECTION_READY, { conversationIds });
}

export default createIo;
