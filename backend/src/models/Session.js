import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /*
     * SHA-256 của refresh token, KHÔNG phải token gốc.
     *
     * Vẫn dùng đúng tên field cũ một cách có chủ đích: field này đang có unique
     * index non-sparse, nên nếu session mới bỏ trống nó thì bản ghi thứ hai sẽ
     * đụng unique trên giá trị null. Ghi hash vào đây giữ index tiếp tục đúng và
     * tránh phải migrate index — trong khi vẫn không còn lưu token dạng phẳng.
     *
     * Bản ghi cũ (tạo trước thay đổi này) vẫn chứa token gốc; việc tra cứu chấp
     * nhận cả hai dạng cho tới khi chúng hết hạn theo TTL 14 ngày. Đổi tên field
     * và bỏ nhánh tương thích ở Phase 9.
     *
     * Dùng SHA-256 chứ không phải bcrypt: đây là 64 byte ngẫu nhiên từ CSPRNG,
     * không có gì để brute force, nên bcrypt chỉ tốn CPU mỗi lần refresh.
     */
    refreshToken: {
      type: String,
      required: true,
      unique: true,
    },
    /**
     * Nhóm các session sinh ra từ cùng một lần đăng nhập.
     *
     * Khi phát hiện một token đã bị rotate được dùng lại, ta thu hồi cả họ —
     * dấu hiệu token đã bị đánh cắp.
     */
    familyId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    /** Thời điểm token này bị thay thế. `null` nghĩa là còn hiệu lực. */
    rotatedAt: {
      type: Date,
      default: null,
    },
    userAgent: {
      type: String,
      maxlength: 400,
    },
    ip: {
      type: String,
      maxlength: 60,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// tự động xoá khi hết hạn
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Session || mongoose.model("Session", sessionSchema);
