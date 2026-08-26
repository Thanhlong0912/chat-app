/**
 * Chuyển Message document thành hình dạng gửi ra ngoài.
 *
 * MỌI response HTTP và mọi socket emit đều phải đi qua đây. Cố tình là một hàm
 * tường minh chứ không phải `toJSON` transform trên schema: một query `.lean()`
 * bỏ qua transform, còn hàm này thì không thể bị bỏ qua — và đây chính là chỗ nội
 * dung tin nhắn đã xoá bị loại bỏ, nên "không thể bỏ qua" là yêu cầu bảo mật.
 *
 * Đồng thời là lớp tương thích ngược: bản ghi cũ chỉ có `imgUrl` và không có
 * `kind` vẫn được trả về đúng hình dạng mới.
 */
const shapeUser = (user) => {
  if (!user) return null;

  // Chưa populate — chỉ có ObjectId.
  if (!user.displayName) return { _id: String(user._id ?? user) };

  return {
    _id: String(user._id),
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  };
};

const shapeAttachments = (doc) => {
  if (doc.attachments?.length) {
    return doc.attachments.map((a) => ({
      url: a.url,
      mimeType: a.mimeType ?? null,
      bytes: a.bytes ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      originalName: a.originalName ?? null,
      kind: a.kind ?? "image",
      // `publicId` cố tình KHÔNG trả ra: đó là chi tiết nội bộ của Cloudinary,
      // client không cần và không nên biết.
    }));
  }

  // Bản ghi cũ: dựng attachment từ `imgUrl`.
  if (doc.imgUrl) {
    return [{ url: doc.imgUrl, kind: "image", mimeType: null, bytes: null, width: null, height: null, originalName: null }];
  }

  return [];
};

/**
 * Gom biểu cảm thành từng nhóm theo emoji.
 *
 * Gom ở SERVER chứ không đẩy mảng thô cho client: một tin nhắn trong nhóm đông có
 * thể có hàng trăm lượt thả, và client chỉ cần biết "emoji nào, bao nhiêu lượt,
 * mình đã thả chưa". Trả mảng thô sẽ gửi kèm id của mọi người thả trong mọi trang
 * tin nhắn — vừa nặng, vừa là dữ liệu client không cần.
 *
 * Thứ tự theo lượt thả ĐẦU TIÊN, nên các chip không nhảy chỗ khi có người thả thêm.
 */
const shapeReactions = (doc, viewerId) => {
  const raw = doc.reactions ?? [];
  if (raw.length === 0) return [];

  const groups = new Map();

  for (const reaction of raw) {
    let group = groups.get(reaction.emoji);

    if (!group) {
      group = { emoji: reaction.emoji, count: 0, reactedByMe: false };
      groups.set(reaction.emoji, group);
    }

    group.count += 1;

    if (viewerId && String(reaction.userId) === String(viewerId)) {
      group.reactedByMe = true;
    }
  }

  return [...groups.values()];
};

/**
 * Suy ra `kind`.
 *
 * Không thể chỉ dựa vào `doc.kind`: Mongoose áp default `"text"` khi hydrate một
 * document cũ vốn không có field đó, nên "chưa được set" và "đúng là text" trông
 * giống nhau hoàn toàn. Phải suy từ dữ liệu thật — một bản ghi có `imgUrl` mà
 * không có `attachments` chắc chắn là tin nhắn ảnh của thời trước.
 */
const inferKind = (doc) => {
  if (!doc.attachments?.length && doc.imgUrl) return "image";
  return doc.kind ?? "text";
};

export function serializeMessage(doc, { viewerId } = {}) {
  if (!doc) return null;

  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const deleted = Boolean(plain.deletedAt);

  const base = {
    _id: String(plain._id),
    conversationId: String(plain.conversationId),
    senderId: String(plain.senderId?._id ?? plain.senderId),
    sender: shapeUser(plain.senderId),
    kind: inferKind(plain),
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    editedAt: plain.editedAt ?? null,
    deleted,
    clientMessageId: plain.clientMessageId ?? null,
    isOwn: viewerId ? String(plain.senderId?._id ?? plain.senderId) === String(viewerId) : undefined,
  };

  if (deleted) {
    // Nội dung và tệp của tin nhắn đã xoá không bao giờ được lên đường truyền.
    return {
      ...base,
      content: null,
      attachments: [],
      replyTo: null,
      // Biểu cảm của một tin đã xoá cũng biến mất: giữ lại chúng sẽ để lộ rằng
      // tin nhắn từng có phản ứng gì, trên một nội dung không còn được phép đọc.
      reactions: [],
      deletedAt: plain.deletedAt,
    };
  }

  return {
    ...base,
    content: plain.content ?? null,
    attachments: shapeAttachments(plain),
    reactions: shapeReactions(plain, viewerId),
    replyTo: plain.replyTo
      ? {
          messageId: String(plain.replyTo.messageId),
          senderId: plain.replyTo.senderId ? String(plain.replyTo.senderId) : null,
          contentSnapshot: plain.replyTo.contentSnapshot ?? null,
          kindSnapshot: plain.replyTo.kindSnapshot ?? null,
        }
      : null,
    systemEvent: plain.systemEvent
      ? {
          type: plain.systemEvent.type,
          actorId: plain.systemEvent.actorId ? String(plain.systemEvent.actorId) : null,
          targetIds: (plain.systemEvent.targetIds ?? []).map(String),
          meta: plain.systemEvent.meta ?? null,
        }
      : null,
  };
}

export const serializeMessages = (docs, options) =>
  (docs ?? []).map((doc) => serializeMessage(doc, options));

export default serializeMessage;
