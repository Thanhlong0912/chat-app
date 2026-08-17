import { CLIENT_EVENTS } from "../events.js";
import { withErrorHandling } from "../authorize.js";
import { loadMembership } from "../../services/membershipService.js";
import Message from "../../models/Message.js";
import { serializeMessages } from "../../serializers/message.js";
import { decodeCursor, encodeCursor, newerThan } from "../../utils/cursor.js";
import { socketSyncSinceSchema } from "../../schemas/messageSchemas.js";
import { badRequest, isAppError } from "../../utils/errors.js";
import logger from "../../utils/logger.js";

/**
 * Đồng bộ lại sau khi mất kết nối.
 *
 * Không có bước này, mọi tin nhắn gửi trong lúc socket đứt sẽ bị mất im lặng:
 * phân trang chỉ lật về quá khứ, nên không có đường nào lấy được khoảng trống ở
 * giữa. Client gửi cursor mới nhất nó đang có cho từng conversation đang mở, và
 * nhận lại phần thiếu.
 */

/** Trần mỗi conversation cho một lần sync. */
const PER_CONVERSATION_LIMIT = 200;

export function registerSyncHandlers(socket) {
  const sync = withErrorHandling(async (s, payload, { ack }) => {
    const parsed = socketSyncSinceSchema.safeParse(payload);

    if (!parsed.success) {
      throw badRequest("VALIDATION_ERROR", parsed.error.issues[0]?.message);
    }

    const results = await Promise.all(
      parsed.data.cursors.map((entry) => syncOne(s, entry)),
    );

    if (typeof ack === "function") {
      ack({ ok: true, conversations: results.filter(Boolean) });
    }
  });

  socket.on(CLIENT_EVENTS.SYNC_SINCE, (payload, ack) => sync(socket, payload, ack));
}

const syncOne = async (socket, { conversationId, cursor }) => {
  try {
    // Từng conversation phải được kiểm tra quyền riêng: client có thể gửi kèm một
    // id không thuộc về nó trong cùng một lời gọi.
    await loadMembership(socket.user._id, conversationId, { lean: true });
  } catch (error) {
    if (isAppError(error)) {
      logger.warn(`sync:since bị từ chối ${conversationId}: ${error.code}`);
      return { conversationId: String(conversationId), error: error.code };
    }
    throw error;
  }

  const decoded = decodeCursor(cursor);
  const query = { conversationId };

  if (decoded) Object.assign(query, newerThan(decoded));

  const docs = await Message.find(query)
    .sort({ createdAt: 1, _id: 1 })
    .limit(PER_CONVERSATION_LIMIT + 1)
    .populate({ path: "senderId", select: "displayName avatarUrl" });

  const truncated = docs.length > PER_CONVERSATION_LIMIT;
  const page = truncated ? docs.slice(0, PER_CONVERSATION_LIMIT) : docs;

  return {
    conversationId: String(conversationId),
    messages: serializeMessages(page, { viewerId: socket.user._id }),
    // Khoảng trống lớn hơn một lần trả về: client nên bỏ cache của conversation
    // này và tải lại từ đầu, thay vì ghép một dải còn thiếu ở giữa.
    truncated,
    nextCursor: page.length ? encodeCursor(page[page.length - 1]) : (cursor ?? null),
  };
};
