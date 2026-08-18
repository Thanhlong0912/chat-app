import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    hashedPassword: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String, // link CDN để hiển thị hình
    },
    avatarId: {
      type: String, // Cloudinary public_id để xoá hình
    },
    bio: {
      type: String,
      maxlength: 500, // tuỳ
    },
    // `sparse` không có tác dụng gì nếu không đi cùng `unique` — comment cũ nói
    // field này không được trùng, nhưng thực tế chưa bao giờ có ràng buộc đó. Bỏ
    // `sparse` để mô tả đúng hành vi thật, thay vì thêm `unique` và có nguy cơ
    // làm hỏng dữ liệu đang có nếu tồn tại số điện thoại trùng.
    phone: {
      type: String,
    },
    /** Lần cuối online, do tầng socket ghi khi socket cuối cùng ngắt kết nối. */
    lastSeenAt: {
      type: Date,
      default: null,
    },
    /**
     * Tuỳ chọn của người dùng.
     *
     * Lưu ở server thay vì localStorage để đồng bộ giữa các thiết bị — người dùng
     * tắt thông báo trên máy tính thì điện thoại cũng phải im.
     */
    preferences: {
      type: new mongoose.Schema(
        {
          /** Bật thông báo trong ứng dụng (toast). */
          inAppNotifications: { type: Boolean, default: true },
          /** Bật thông báo của trình duyệt. */
          browserNotifications: { type: Boolean, default: false },
          /** Cho người khác thấy trạng thái online của mình. */
          showPresence: { type: Boolean, default: true },
          /** Gửi bằng phím Enter (tắt thì Enter xuống dòng, Ctrl+Enter gửi). */
          enterToSend: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
