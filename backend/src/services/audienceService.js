import Conversation from "../models/Conversation.js";
import Friend from "../models/Friend.js";
import logger from "../utils/logger.js";

/**
 * "Khán giả" của một user: những người cần biết khi trạng thái online của họ đổi.
 *
 *   audience(U) = bạn bè của U ∪ thành viên các conversation của U
 *
 * Vì sao cần: bản cũ phát `io.emit("online-users", [toàn bộ danh sách])` cho MỌI
 * socket mỗi lần có ai kết nối hoặc ngắt kết nối. Đó là O(số user) dữ liệu × O(số
 * socket) người nhận cho mỗi lần đổi trạng thái — với 1000 người online, một lần
 * mở tab tạo ra 1000 message mỗi cái chứa 1000 id. Fan-out theo audience giữ chi
 * phí tỉ lệ với số người thực sự quan tâm.
 */
export async function computeAudience(userId) {
  const id = String(userId);

  try {
    const [friendships, conversations] = await Promise.all([
      Friend.find({ $or: [{ userA: userId }, { userB: userId }] })
        .select("userA userB")
        .lean(),
      Conversation.find({ "participants.userId": userId })
        .select("participants.userId")
        .lean(),
    ]);

    const audience = new Set();

    for (const f of friendships) {
      audience.add(String(f.userA));
      audience.add(String(f.userB));
    }

    for (const convo of conversations) {
      for (const p of convo.participants ?? []) {
        audience.add(String(p.userId));
      }
    }

    // Chính mình không nằm trong audience — client tự biết trạng thái của nó.
    audience.delete(id);

    return [...audience];
  } catch (error) {
    // Không tính được audience thì chỉ mất cập nhật presence, không nên làm sập
    // cả kết nối socket.
    logger.error(`Không tính được audience cho ${id}`, error);
    return [];
  }
}

/*
 * Cache audience theo socket.
 *
 * Tính lại trên mỗi lần đổi trạng thái sẽ là hai query cho mỗi lần mở/đóng tab.
 * Audience chỉ đổi khi kết bạn hoặc thay đổi thành viên nhóm, và cả hai chỗ đó
 * đều gọi `invalidateAudience`.
 */
const cache = new Map(); // userId -> { members: string[], expiresAt: number }
const TTL_MS = 5 * 60 * 1000;

export async function getAudience(userId) {
  const id = String(userId);
  const hit = cache.get(id);

  if (hit && hit.expiresAt > Date.now()) return hit.members;

  const members = await computeAudience(id);
  cache.set(id, { members, expiresAt: Date.now() + TTL_MS });

  return members;
}

/**
 * Xoá cache cho một user và cho những người trong audience của họ.
 *
 * Quan hệ là hai chiều: khi A và B kết bạn, audience của cả hai đều đổi.
 */
export function invalidateAudience(userId, alsoInvalidate = []) {
  cache.delete(String(userId));
  alsoInvalidate.forEach((id) => cache.delete(String(id)));
}

export function clearAudienceCache() {
  cache.clear();
}
