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
  },
  {
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
