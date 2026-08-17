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
