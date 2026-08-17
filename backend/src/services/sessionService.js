import Session from "../models/Session.js";

/*
 * Cache "session này còn sống không".
 *
 * Access token mang `sid`, nên đăng xuất có thể thu hồi nó ngay thay vì phải chờ
 * hết 15 phút. Nhưng kiểm tra DB trên mọi request sẽ thêm một round trip vào
 * đường nóng, nên cache lại trong thời gian ngắn.
 *
 * Hệ quả: ở môi trường nhiều instance, một lần đăng xuất chỉ chắc chắn có hiệu
 * lực trên instance xử lý nó, cho tới khi TTL hết ở các instance khác. Chấp nhận
 * được ở quy mô một instance hiện tại; muốn chính xác tuyệt đối thì cần Redis
 * (đã ghi nhận là ngoài phạm vi).
 */
const TTL_MS = 30_000;
const cache = new Map(); // sid -> { active, expiresAt }

export async function isSessionActive(sessionId) {
  if (!sessionId) return true; // Token cũ không có `sid` — không thể kiểm tra.

  const hit = cache.get(sessionId);
  if (hit && hit.expiresAt > Date.now()) return hit.active;

  const session = await Session.findById(sessionId).select("_id rotatedAt expiresAt").lean();

  const active = Boolean(
    session && !session.rotatedAt && (!session.expiresAt || session.expiresAt > new Date()),
  );

  cache.set(sessionId, { active, expiresAt: Date.now() + TTL_MS });

  return active;
}

/** Gọi khi đăng xuất hoặc thu hồi, để access token chết ngay lập tức. */
export function invalidateSessionCache(sessionId) {
  if (sessionId) cache.set(String(sessionId), { active: false, expiresAt: Date.now() + TTL_MS });
}

export function clearSessionCache() {
  cache.clear();
}
