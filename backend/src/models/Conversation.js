import mongoose from "mongoose";
import { ROLE_VALUES, ROLES } from "../domain/groupPermissions.js";

// Mọi field thêm mới ở đây đều optional và không có default bắt buộc, để deploy
// được mà không cần backfill trước: `getRole()` tự suy ra vai trò từ
// `group.createdBy` cho document cũ.
const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    // Cố tình KHÔNG có default: một default "member" sẽ ghi đè lên fallback theo
    // `group.createdBy` trong `getRole()`, khiến người tạo nhóm mới bị coi là
    // member thường. Để trống thì fallback đúng cho cả document cũ và mới.
    role: {
      type: String,
      enum: ROLE_VALUES,
    },
    // Con trỏ "đã đọc đến đâu". Là nguồn dữ liệu duy nhất cho read receipt:
    // rẻ hơn hẳn mảng readBy[] trên từng message, vốn tốn O(message × thành viên)
    // và phải ghi vào mọi message chưa đọc mỗi lần user đọc.
    lastReadAt: {
      type: Date,
      default: null,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    mutedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    avatarUrl: {
      type: String,
    },
    // Cloudinary public_id, cần để xoá được ảnh cũ.
    avatarId: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    _id: false,
  }
);

const lastMessageSchema = new mongoose.Schema(
  {
    // Trước đây khai báo là String trong khi code gán ObjectId vào, nên giá trị bị
    // ép thành chuỗi và không bao giờ dùng được cho populate/$lookup. Dữ liệu cũ
    // là chuỗi hex nên cast sang ObjectId sạch, không cần migrate.
    _id: { type: mongoose.Schema.Types.ObjectId },
    content: {
      type: String,
      default: null,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
    },
    participants: {
      type: [participantSchema],
      required: true,
    },
    group: {
      type: groupSchema,
    },
    lastMessageAt: {
      type: Date,
    },
    /**
     * @deprecated Thay bằng `participants[].lastReadAt`.
     *
     * Chỉ mô tả được trạng thái đọc của tin nhắn CUỐI, và bị reset về [] mỗi khi
     * có tin mới, nên không dựng được read receipt cho từng tin nhắn. Vẫn tiếp tục
     * ghi thêm một release để client cũ không hỏng; bỏ ở Phase 9.
     */
    seenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastMessage: {
      type: lastMessageSchema,
      default: null,
    },
    /**
     * Số tin chưa đọc theo từng user, phi chuẩn hoá để render badge không phải
     * đếm. Được tính LẠI từ `lastReadAt` thay vì $inc/$set độc lập — cách cũ khiến
     * hai nguồn trôi khỏi nhau.
     */
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    // Ghim / lưu trữ theo từng người, không phải theo cả conversation.
    pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
  }
);

// Trước đây key là "participant.userId" (số ít) — một path không tồn tại, nên
// index này vô dụng và mọi query nóng đều full scan. Index cũ sẽ được drop trong
// migration ở Phase 2; ở đây chỉ khai báo đúng để deployment mới tạo ra nó.
conversationSchema.index({
  "participants.userId": 1,
  lastMessageAt: -1,
});

const Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
export default Conversation;
