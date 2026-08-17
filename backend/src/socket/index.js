import { Server } from "socket.io";
import { socketAuthMiddleware } from "../middlewares/socketMiddleware.js";
import { getUserConversationIds } from "../services/conversationService.js";
import { withMembership } from "./authorize.js";
import logger from "../utils/logger.js";

// {userId: socketId}
// FIXME(Phase 3): key là ObjectId chứ không phải string, nên hai tab của cùng một
// user tạo ra hai entry khác nhau — presence multi-tab sai và danh sách online bị
// trùng. Sẽ thay bằng Map<string, Set<socketId>> có đếm tham chiếu.
const onlineUsers = new Map();

/**
 * Tạo Socket.IO server gắn vào một http server có sẵn.
 *
 * Không tự tạo express app / http server như trước, và không import controller,
 * nên test có thể dựng io độc lập.
 */
export function createIo(httpServer, { corsOrigin } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
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
    const user = socket.user;

    // Chỉ join được room của conversation mà mình là thành viên. Trước đây event
    // này không kiểm tra gì cả, nên bất kỳ user đã đăng nhập nào cũng subscribe
    // được vào luồng tin nhắn realtime của một conversation bất kỳ.
    const subscribe = withMembership(async (s, payload, { conversationId, ack }) => {
      await s.join(conversationId);

      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("conversation:subscribe", (payload, ack) => subscribe(socket, payload, ack));

    // Alias tương thích: bundle frontend đang mở tab vẫn phát tên event cũ. Nay
    // đã được kiểm tra quyền. Sẽ bỏ ở Phase 9.
    socket.on("join-conversation", (payload, ack) => subscribe(socket, payload, ack));

    socket.on("conversation:unsubscribe", (payload) => {
      const conversationId = typeof payload === "string" ? payload : payload?.conversationId;
      // Rời room không cần kiểm tra quyền — bỏ nhận tin luôn an toàn.
      if (conversationId) socket.leave(conversationId);
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(user._id);
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    socket.on("error", (error) => {
      logger.warn(`Lỗi socket ${socket.id}`, error);
    });

    onlineUsers.set(user._id, socket.id);
    io.emit("online-users", Array.from(onlineUsers.keys()));

    // Room riêng của user, dùng để gửi event nhắm đúng một người.
    socket.join(user._id.toString());

    // Phần async đặt xuống cuối, sau khi listener đã sẵn sàng.
    joinExistingConversations(socket, user);
  });
}

async function joinExistingConversations(socket, user) {
  const conversationIds = await getUserConversationIds(user._id);

  // Socket có thể đã ngắt trong lúc chờ query.
  if (!socket.connected) return;

  conversationIds.forEach((id) => socket.join(id));

  // Báo cho client biết đã vào xong các room. Sự kiện `connect` của socket.io chỉ
  // nói rằng transport đã sẵn sàng, không nói rằng server đã join room — nên nếu
  // không có tín hiệu này thì tồn tại một khoảng client tưởng mình đang nhận tin
  // của conversation nhưng thực tế thì chưa.
  socket.emit("connection:ready", { conversationIds });
}

export default createIo;
