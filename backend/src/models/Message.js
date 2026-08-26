import mongoose from "mongoose";

export const MESSAGE_KINDS = ["text", "image", "video", "file", "system"];

export const SYSTEM_EVENTS = [
  "group_created",
  "member_added",
  "member_removed",
  "member_left",
  "group_renamed",
  "group_avatar_changed",
  "role_changed",
];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    // Cloudinary public_id — cần để xoá được asset khi xoá tin nhắn.
    publicId: { type: String },
    mimeType: { type: String },
    bytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    originalName: { type: String, maxlength: 255 },
    kind: { type: String, enum: ["image", "video", "file"], default: "image" },
  },
  { _id: false }
);

/**
 * Ảnh chụp của tin nhắn được trả lời, KHÔNG phải reference.
 *
 * Nếu dùng ref thì mỗi trang 50 tin nhắn cần thêm một lượt populate (hoặc
 * $lookup) chỉ để hiển thị đoạn trích, và tin nhắn gốc bị xoá sẽ để lại ref treo.
 * Một ảnh chụp 140 ký tự tốn ~140 byte mỗi lượt trả lời và render không cần I/O
 * thêm. `messageId` vẫn được giữ để "nhảy tới tin gốc" hoạt động — lúc đó mới
 * kiểm tra `deletedAt` của tin gốc.
 */
const replyToSchema = new mongoose.Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    contentSnapshot: { type: String, maxlength: 140 },
    kindSnapshot: { type: String, enum: MESSAGE_KINDS },
  },
  { _id: false }
);

/**
 * Bộ biểu cảm được phép, cố định.
 *
 * Cố tình KHÔNG cho emoji tự do: field này là chuỗi do client gửi lên, nên nếu
 * không có allowlist thì nó trở thành một ô text tuỳ ý gắn vào tin nhắn của người
 * khác — và mỗi giá trị lạ lại tạo thêm một nhóm trong `serializeMessage`, nên
 * một client cố tình có thể thổi payload của mọi trang tin nhắn lên.
 */
export const REACTION_EMOJIS = Object.freeze(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

/**
 * Trần số biểu cảm trên MỘT tin nhắn.
 *
 * Document MongoDB có trần cứng 16MB, và mảng lồng trong document lớn dần sẽ làm
 * chậm mọi lượt đọc trang tin nhắn — không chỉ tin nhắn đó. Trần này ứng với
 * `MAX_GROUP_MEMBERS × số emoji`, tức là ai cũng thả được mọi biểu cảm.
 */
export const MAX_REACTIONS_PER_MESSAGE = 600;

/**
 * Một lượt thả biểu cảm. Là subdocument chứ không phải collection riêng.
 *
 * Cùng lý do với `replyTo`: một collection riêng bắt mỗi trang 50 tin nhắn phải
 * thêm một lượt $lookup chỉ để đếm biểu cảm. Nhúng vào đây thì trang tin nhắn
 * không tốn thêm I/O nào, và `{emoji, userId}` chỉ vài chục byte mỗi lượt.
 */
const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true, enum: REACTION_EMOJIS },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const systemEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SYSTEM_EVENTS },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    targetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    kind: {
      type: String,
      enum: MESSAGE_KINDS,
      default: "text",
    },
    content: {
      type: String,
      trim: true,
      maxlength: 4000,
    },
    attachments: {
      type: [attachmentSchema],
      default: undefined,
    },
    replyTo: {
      type: replyToSchema,
      default: undefined,
    },
    /**
     * Id do client sinh, dùng để đối chiếu tin nhắn lạc quan và để retry idempotent.
     * Unique theo từng conversation (xem partial index bên dưới).
     */
    clientMessageId: {
      type: String,
      maxlength: 64,
    },
    /**
     * `default: undefined` chứ không phải `[]`: một mảng rỗng mặc định sẽ ghi
     * thêm một field vào MỌI tin nhắn, kể cả tin không ai thả biểu cảm — cùng lý
     * do đã dùng cho `attachments`.
     */
    reactions: {
      type: [reactionSchema],
      default: undefined,
    },
    editedAt: { type: Date, default: null },
    // Xoá mềm: giữ lại bản ghi để chuỗi trả lời và mốc thời gian không bị hổng.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    systemEvent: {
      type: systemEventSchema,
      default: undefined,
    },
    /**
     * @deprecated Chỉ đọc, dành cho dữ liệu cũ. Ghi mới dùng `attachments`.
     * `serializeMessage` tự dựng `attachments` từ field này cho bản ghi cũ.
     */
    imgUrl: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index cho cursor keyset. Khớp chính xác sort {createdAt:-1, _id:-1}.
// Hai index cũ ({conversationId} và {conversationId, createdAt}) là prefix của
// index này nên dư thừa; migration fixIndexes.js sẽ drop chúng.
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

/*
 * Chặn trùng khi client retry.
 *
 * partialFilterExpression lọc theo $type: "string" nên mọi bản ghi cũ (không có
 * `clientMessageId`) đều nằm ngoài index — thêm index này vào dữ liệu đang chạy là
 * an toàn, không sợ đụng unique trên hàng loạt giá trị null.
 */
messageSchema.index(
  { conversationId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: "string" } },
  }
);

const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

export default Message;
