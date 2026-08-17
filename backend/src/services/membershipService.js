import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import { findParticipant, getRole } from "../domain/groupPermissions.js";
import { badRequest, forbidden, notFound } from "../utils/errors.js";

/**
 * Nguồn sự thật duy nhất cho câu hỏi "user X có ở trong conversation Y, với quyền gì".
 *
 * Logic này trước đây nằm trong `checkGroupMembership` nhưng bị gắn cứng vào
 * Express và `req.body`, nên các route đọc id từ `req.params` không dùng lại được
 * — và thực tế là không kiểm tra quyền gì cả. Tách ra thành hàm thuần rồi bọc
 * hai lớp mỏng: một cho HTTP, một cho socket.
 *
 * @returns {{conversation, participant, role}}
 * @throws {AppError} 400 id sai định dạng, 404 không tồn tại, 403 không phải thành viên
 */
export async function loadMembership(userId, conversationId, { lean = false } = {}) {
  // Kiểm tra trước khi query: nếu để Mongoose cast thất bại thì thành CastError
  // và (trước khi có error middleware) là 500, dù đây rõ ràng là lỗi của client.
  if (!mongoose.isValidObjectId(conversationId)) {
    throw badRequest("INVALID_ID", "conversationId không hợp lệ");
  }

  const query = Conversation.findById(conversationId);
  const conversation = lean ? await query.lean() : await query;

  if (!conversation) {
    throw notFound("CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện");
  }

  const participant = findParticipant(conversation, userId);

  if (!participant) {
    throw forbidden("NOT_A_MEMBER", "Bạn không ở trong cuộc trò chuyện này");
  }

  return { conversation, participant, role: getRole(conversation, participant) };
}

/*
 * Cache membership với TTL ngắn.
 *
 * Cần cho đường socket: `typing:start`/`typing:stop` bắn nhiều lần mỗi giây cho
 * mỗi user, và một round trip DB cho mỗi cụm gõ phím là không chấp nhận được.
 *
 * Cửa sổ stale 30s khi kick một người là chấp nhận được *bởi vì* handler kick
 * đồng thời buộc socket đó rời room ngay lập tức — cache chỉ là lớp phòng bị thứ hai.
 */
const TTL_MS = 30_000;
const cache = new Map(); // `${userId}:${conversationId}` -> { role, expiresAt }

const keyOf = (userId, conversationId) => `${userId}:${conversationId}`;

export async function loadMembershipCached(userId, conversationId) {
  const key = keyOf(userId, conversationId);
  const hit = cache.get(key);

  if (hit && hit.expiresAt > Date.now()) {
    return { role: hit.role, cached: true };
  }

  // Cố tình không cache kết quả thất bại: người vừa được thêm vào nhóm phải dùng
  // được ngay, không phải chờ TTL hết.
  const { role } = await loadMembership(userId, conversationId, { lean: true });

  cache.set(key, { role, expiresAt: Date.now() + TTL_MS });

  return { role, cached: false };
}

/**
 * Xoá cache cho một conversation (hoặc một cặp user–conversation cụ thể).
 * Phải gọi ở mọi chỗ thay đổi thành viên hoặc vai trò.
 */
export function invalidateMembership(conversationId, userId) {
  if (userId) {
    cache.delete(keyOf(userId, conversationId));
    return;
  }

  const suffix = `:${conversationId}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
}

/** Chỉ dùng trong test. */
export function clearMembershipCache() {
  cache.clear();
}
