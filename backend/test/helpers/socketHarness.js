import { createServer } from "http";
import { io as ioClient } from "socket.io-client";
import { createIo } from "../../src/socket/index.js";
import { signAccessToken } from "./authedAgent.js";

/**
 * Dựng một Socket.IO server thật trên port ephemeral.
 *
 * Dùng client và server thật thay vì mock: những bug ở tầng này (phân quyền
 * event, room fan-out, presence multi-tab) chỉ xuất hiện khi có nhiều kết nối
 * thực sự, và mock sẽ cho qua hết.
 */
export async function startSocketServer() {
  const httpServer = createServer();
  const ioServer = createIo(httpServer, { corsOrigin: "*" });

  await new Promise((resolve) => httpServer.listen(0, resolve));

  const { port } = httpServer.address();
  const clients = [];

  /**
   * Kết nối một client đã xác thực.
   *
   * Mặc định chờ `connection:ready` chứ không chỉ chờ `connect`: `connect` chỉ
   * báo transport đã sẵn sàng, còn việc server join các room của user là async.
   * Chờ đúng tín hiệu giúp test không bị flaky.
   */
  const connect = async (user, { token = signAccessToken(user), waitForReady = true } = {}) => {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });

    clients.push(socket);

    await new Promise((resolve, reject) => {
      socket.once("connect_error", reject);

      if (waitForReady) {
        socket.once("connection:ready", resolve);
      } else {
        socket.once("connect", resolve);
      }
    });

    return socket;
  };

  /**
   * Tạo client nhưng KHÔNG chờ gì cả, để test tự gắn listener trước khi server
   * kịp phát event.
   */
  const rawClient = (user, { token = signAccessToken(user) } = {}) => {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });

    clients.push(socket);
    return socket;
  };

  /** Kết nối với kỳ vọng bị từ chối; trả về `{message, code}`. */
  const connectExpectingFailure = async (token) => {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });

    clients.push(socket);

    return new Promise((resolve, reject) => {
      socket.once("connect_error", (error) =>
        resolve({ message: error.message, code: error.data?.code }),
      );
      socket.once("connect", () => reject(new Error("đáng ra phải bị từ chối")));
    });
  };

  const close = async () => {
    clients.forEach((socket) => socket.close());
    await ioServer.close();
    await new Promise((resolve) => httpServer.close(resolve));
  };

  return { port, ioServer, connect, rawClient, connectExpectingFailure, close };
}

/** Emit kèm ack, có timeout để test không treo khi server không trả lời. */
export function emitWithAck(socket, event, payload, { timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout cho '${event}'`)), timeout);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/**
 * Thu các event nhận được trong một khoảng thời gian.
 *
 * Dùng để khẳng định điều *không* xảy ra (ví dụ người ngoài không nhận tin nhắn),
 * nên phải chờ một khoảng thật rồi mới kết luận.
 */
export function collectEvents(socket, event, { duration = 300 } = {}) {
  const received = [];
  const handler = (payload) => received.push(payload);

  socket.on(event, handler);

  return new Promise((resolve) =>
    setTimeout(() => {
      socket.off(event, handler);
      resolve(received);
    }, duration),
  );
}
