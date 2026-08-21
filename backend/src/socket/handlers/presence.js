import User from "../../models/User.js";
import { CLIENT_EVENTS, LEGACY_EVENTS, SERVER_EVENTS, userRoom } from "../events.js";
import {
  STATUS,
  addSocket,
  getStatus,
  onlineUserIds,
  removeSocket,
  setAway,
  statusesFor,
} from "../presence.js";
import { getAudience, invalidateAudience } from "../../services/audienceService.js";
import { getIo } from "../io.js";
import logger from "../../utils/logger.js";

/**
 * Ghi `lastSeenAt`, có tiết chế.
 *
 * Heartbeat quan trọng ở chỗ: nếu tiến trình bị kill, handler `disconnect` không
 * bao giờ chạy, và `lastSeenAt` sẽ đứng im mãi ở lần cuối ghi được. Heartbeat
 * định kỳ giữ cho giá trị đó không lệch quá xa dù server chết đột ngột.
 */
const WRITE_THROTTLE_MS = 55_000;
const lastWrittenAt = new Map(); // userId -> timestamp

const touchLastSeen = async (userId, { force = false } = {}) => {
  const id = String(userId);
  const now = Date.now();

  if (!force && now - (lastWrittenAt.get(id) ?? 0) < WRITE_THROTTLE_MS) return;

  lastWrittenAt.set(id, now);

  try {
    await User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } });
  } catch (error) {
    // Presence không đáng để làm sập kết nối.
    logger.warn(`Không ghi được lastSeenAt cho ${id}`, error);
  }
};

/**
 * Phát thay đổi trạng thái tới đúng những người quan tâm.
 *
 * Bản cũ dùng `io.emit("online-users", [toàn bộ danh sách])` cho MỌI socket ở mỗi
 * lần connect/disconnect — O(số user) dữ liệu × O(số socket) người nhận. Ở đây chỉ
 * gửi tới các room `u:<id>` trong audience; socket.io nhận một mảng room và tự
 * loại trùng người nhận.
 */
const broadcastStatus = async (io, userId, status) => {
  const audience = await getAudience(userId);

  if (audience.length === 0) return;

  const payload = {
    userId: String(userId),
    status,
    lastSeenAt: status === STATUS.OFFLINE ? new Date() : null,
  };

  io.to(audience.map(userRoom)).emit(SERVER_EVENTS.PRESENCE_UPDATE, payload);
};

/**
 * Hai người vừa có quan hệ với nhau — cho mỗi bên biết trạng thái của bên kia NGAY.
 *
 * Vì sao cần: presence chỉ được phát tới "audience" của một người, và audience
 * được cache 5 phút (`audienceService`). Trước đây cache đó chỉ bị xoá từ
 * groupService, không từ luồng kết bạn hay tạo conversation — nên hai người vừa
 * kết bạn không nằm trong audience đã cache của nhau và không ai nhận được
 * `presence:update` của ai. `presence:snapshot` cũng chỉ gửi đúng một lần lúc kết
 * nối, nên người bạn mới không có trong ảnh chụp: dấu online đứng im màu xám cho
 * tới khi cả hai tải lại trang VÀ cache hết hạn.
 *
 * Hàm này làm hai việc: xoá cache audience của tất cả những người liên quan, rồi
 * gửi cho mỗi người trạng thái hiện tại của những người còn lại.
 *
 * `lastSeenAt` được tra thật cho những ai đang offline — client dùng nó để hiện
 * "hoạt động 5 phút trước", và một giá trị bịa sẽ hiện sai.
 */
export async function announcePresenceAmong(userIds) {
  const ids = [...new Set((userIds ?? []).map(String))];

  // Xoá cache kể cả khi chưa có io (ví dụ trong test HTTP thuần): lần kết nối sau
  // vẫn phải tính lại audience.
  ids.forEach((id) => invalidateAudience(id, ids));

  const io = getIo();
  if (!io || ids.length < 2) return;

  const statuses = new Map(ids.map((id) => [id, getStatus(id)]));
  const offline = ids.filter((id) => statuses.get(id) === STATUS.OFFLINE);

  const lastSeen = new Map();

  if (offline.length > 0) {
    try {
      const users = await User.find({ _id: { $in: offline } })
        .select("lastSeenAt")
        .lean();

      users.forEach((user) => lastSeen.set(String(user._id), user.lastSeenAt ?? null));
    } catch (error) {
      // Không tra được `lastSeenAt` thì vẫn phải báo online/offline.
      logger.warn("Không đọc được lastSeenAt khi thông báo presence", error);
    }
  }

  ids.forEach((viewer) => {
    ids.forEach((about) => {
      if (viewer === about) return;

      const status = statuses.get(about);

      io.to(userRoom(viewer)).emit(SERVER_EVENTS.PRESENCE_UPDATE, {
        userId: about,
        status,
        lastSeenAt: status === STATUS.OFFLINE ? (lastSeen.get(about) ?? null) : null,
      });
    });
  });
}

export function registerPresenceHandlers(io, socket) {
  const userId = String(socket.user._id);

  socket.on(CLIENT_EVENTS.PRESENCE_AWAY, (payload) => {
    const away = typeof payload === "boolean" ? payload : Boolean(payload?.away);
    const { statusChanged, status } = setAway(userId, socket.id, away);

    if (statusChanged) {
      broadcastStatus(io, userId, status).catch((error) =>
        logger.warn("Không phát được presence:update", error),
      );
    }
  });

  socket.on(CLIENT_EVENTS.PRESENCE_HEARTBEAT, () => {
    touchLastSeen(userId);
  });

  socket.on("disconnect", async () => {
    const { becameOffline } = removeSocket(userId, socket.id);

    // Chỉ khi socket CUỐI CÙNG của người đó đóng lại thì họ mới thực sự offline.
    // Bản cũ báo offline ngay ở tab đầu tiên bị đóng.
    if (!becameOffline) return;

    await touchLastSeen(userId, { force: true });
    lastWrittenAt.delete(userId);

    await broadcastStatus(io, userId, STATUS.OFFLINE).catch(() => {});

    // Alias tương thích: client cũ vẫn đợi danh sách online đầy đủ.
    io.emit(LEGACY_EVENTS.ONLINE_USERS, onlineUserIds());
  });
}

/**
 * Ghi nhận socket vừa kết nối và gửi snapshot cho riêng nó.
 *
 * Snapshot chỉ chứa audience của chính người này, không phải toàn bộ người đang
 * online — client không cần biết về những người nó không có liên hệ gì.
 */
export async function onPresenceConnect(io, socket) {
  const userId = String(socket.user._id);
  const { becameOnline } = addSocket(userId, socket.id);

  socket.join(userRoom(userId));

  await touchLastSeen(userId, { force: true });

  const audience = await getAudience(userId);

  socket.emit(SERVER_EVENTS.PRESENCE_SNAPSHOT, { users: statusesFor(audience) });

  // Alias tương thích cho bundle cũ, vốn đợi `online-users` để vẽ dấu online.
  socket.emit(LEGACY_EVENTS.ONLINE_USERS, onlineUserIds());

  if (becameOnline) {
    await broadcastStatus(io, userId, getStatus(userId));
    io.emit(LEGACY_EVENTS.ONLINE_USERS, onlineUserIds());
  }
}
