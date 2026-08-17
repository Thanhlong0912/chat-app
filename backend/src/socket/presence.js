/**
 * Sổ theo dõi presence, thuần in-memory.
 *
 * Cố tình KHÔNG import socket.io: nhờ vậy toàn bộ logic đếm tham chiếu multi-tab
 * test được trực tiếp, không cần dựng server.
 *
 * Khoá là userId dạng STRING. Bản trước dùng `Map` với khoá là ObjectId của
 * Mongoose — hai tab của cùng một người tạo ra hai instance ObjectId khác nhau,
 * mà Map so sánh theo SameValueZero, nên mỗi tab thành một entry riêng: danh sách
 * online bị trùng id, và đóng một tab làm người đó "offline" dù tab kia còn mở.
 *
 * Lưu ý phạm vi: state nằm trong tiến trình. Chạy nhiều instance sẽ cần
 * @socket.io/redis-adapter — đã ghi nhận là ngoài phạm vi hiện tại.
 */

export const STATUS = Object.freeze({
  ONLINE: "online",
  AWAY: "away",
  OFFLINE: "offline",
});

/** userId -> Set<socketId> */
const socketsByUser = new Map();
/** userId -> Set<socketId đã báo away> */
const awayByUser = new Map();

const key = (userId) => String(userId);

/**
 * Ghi nhận một socket mới.
 * @returns {{becameOnline: boolean, socketCount: number}}
 */
export function addSocket(userId, socketId) {
  const id = key(userId);
  let sockets = socketsByUser.get(id);

  const becameOnline = !sockets || sockets.size === 0;

  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(id, sockets);
  }

  sockets.add(socketId);

  return { becameOnline, socketCount: sockets.size };
}

/**
 * Bỏ một socket.
 * @returns {{becameOffline: boolean, socketCount: number}}
 */
export function removeSocket(userId, socketId) {
  const id = key(userId);
  const sockets = socketsByUser.get(id);

  if (!sockets) return { becameOffline: false, socketCount: 0 };

  sockets.delete(socketId);
  awayByUser.get(id)?.delete(socketId);

  if (sockets.size === 0) {
    socketsByUser.delete(id);
    awayByUser.delete(id);
    return { becameOffline: true, socketCount: 0 };
  }

  return { becameOffline: false, socketCount: sockets.size };
}

/**
 * Đánh dấu một socket là away (tab bị ẩn, hoặc người dùng không tương tác).
 *
 * Chỉ khi TẤT CẢ socket của một người đều away thì người đó mới là away — còn một
 * tab đang hoạt động nghĩa là họ vẫn ở đây.
 *
 * @returns {{statusChanged: boolean, status: string}}
 */
export function setAway(userId, socketId, away) {
  const id = key(userId);

  if (!socketsByUser.get(id)?.has(socketId)) {
    return { statusChanged: false, status: getStatus(id) };
  }

  const before = getStatus(id);

  let awaySet = awayByUser.get(id);
  if (!awaySet) {
    awaySet = new Set();
    awayByUser.set(id, awaySet);
  }

  if (away) {
    awaySet.add(socketId);
  } else {
    awaySet.delete(socketId);
  }

  const after = getStatus(id);

  return { statusChanged: before !== after, status: after };
}

export function getStatus(userId) {
  const id = key(userId);
  const sockets = socketsByUser.get(id);

  if (!sockets || sockets.size === 0) return STATUS.OFFLINE;

  const awaySet = awayByUser.get(id);
  const allAway = awaySet && awaySet.size >= sockets.size;

  return allAway ? STATUS.AWAY : STATUS.ONLINE;
}

export const isOnline = (userId) => getStatus(userId) !== STATUS.OFFLINE;

export const socketCount = (userId) => socketsByUser.get(key(userId))?.size ?? 0;

/** Toàn bộ user đang có kết nối. Dùng cho snapshot, không dùng để broadcast. */
export const onlineUserIds = () => [...socketsByUser.keys()];

/** Trạng thái của một tập user, dùng khi trả snapshot theo audience. */
export function statusesFor(userIds) {
  return [...new Set(userIds.map(key))].map((userId) => ({
    userId,
    status: getStatus(userId),
  }));
}

/** Chỉ dùng trong test. */
export function resetPresence() {
  socketsByUser.clear();
  awayByUser.clear();
}
