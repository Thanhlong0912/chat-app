import { Server } from "socket.io";
import { socketAuthMiddleware } from "../middlewares/socketMiddleware.js";
import { getUserConversationIds } from "../services/conversationService.js";
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
  io.on("connection", async (socket) => {
    const user = socket.user;

    onlineUsers.set(user._id, socket.id);
    io.emit("online-users", Array.from(onlineUsers.keys()));

    const conversationIds = await getUserConversationIds(user._id);
    conversationIds.forEach((id) => socket.join(id));

    // FIXME(Phase 1): chưa kiểm tra quyền — bất kỳ user đã đăng nhập nào cũng có
    // thể join room của một conversation không thuộc về mình và nhận toàn bộ
    // tin nhắn realtime của nó.
    socket.on("join-conversation", (conversationId) => {
      socket.join(conversationId);
    });

    // Room riêng của user, dùng để gửi event nhắm đúng một người.
    socket.join(user._id.toString());

    socket.on("disconnect", () => {
      onlineUsers.delete(user._id);
      io.emit("online-users", Array.from(onlineUsers.keys()));
    });

    socket.on("error", (error) => {
      logger.warn(`Lỗi socket ${socket.id}`, error);
    });
  });
}

export default createIo;
