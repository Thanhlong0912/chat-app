import { uploadImageFromBuffer } from "../middlewares/uploadMiddleware.js";
import User from "../models/User.js";
import { badRequest } from "../utils/errors.js";

export const authMe = async (req, res) => {
  // req.user do protectedRoute gắn, đã bỏ hashedPassword.
  return res.status(200).json({ user: req.user });
};

export const searchUserByUsername = async (req, res) => {
  const { username } = req.query;

  // Chặn kiểu dữ liệu trước khi đưa vào query: Express 5 parse `?username[$ne]=x`
  // thành object, và tuy Mongoose sẽ cast lỗi trên field String, việc chặn tường
  // minh ở đây rẻ hơn là dựa vào hành vi cast.
  if (typeof username !== "string" || username.trim() === "") {
    throw badRequest("USERNAME_REQUIRED", "Cần cung cấp username trong query.");
  }

  const user = await User.findOne({ username: username.trim() }).select(
    "_id displayName username avatarUrl",
  );

  return res.status(200).json({ user });
};

/**
 * Cập nhật hồ sơ của chính mình.
 *
 * Chỉ nhận đúng các field cho phép — không bao giờ spread `req.body` vào update,
 * nếu không client có thể tự nâng quyền bằng cách gửi kèm những field khác.
 */
export const updateMe = async (req, res) => {
  const { displayName, bio, phone, preferences } = req.body;

  const update = {};

  if (displayName !== undefined) update.displayName = displayName;
  if (bio !== undefined) update.bio = bio;
  if (phone !== undefined) update.phone = phone;

  // Ghi từng khoá preferences một, để cập nhật một tuỳ chọn không xoá các tuỳ
  // chọn còn lại.
  if (preferences) {
    for (const [key, value] of Object.entries(preferences)) {
      update[`preferences.${key}`] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    throw badRequest("NOTHING_TO_UPDATE", "Không có thông tin nào để cập nhật");
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).select("-hashedPassword");

  return res.status(200).json({ user });
};

export const uploadAvatar = async (req, res) => {
  const file = req.file;
  const userId = req.user._id;

  if (!file) {
    throw badRequest("NO_FILE", "Chưa chọn tệp nào");
  }

  const result = await uploadImageFromBuffer(file.buffer);

  // TODO(Phase 1): xoá asset Cloudinary cũ theo `avatarId` — hiện mỗi lần đổi
  // avatar để lại một ảnh mồ côi.
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      avatarUrl: result.secure_url,
      avatarId: result.public_id,
    },
    { returnDocument: "after" },
  ).select("avatarUrl");

  return res.status(200).json({ avatarUrl: updatedUser.avatarUrl });
};
