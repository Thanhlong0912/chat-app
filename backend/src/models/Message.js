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
