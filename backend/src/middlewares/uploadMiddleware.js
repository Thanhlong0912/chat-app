import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { badRequest } from "../utils/errors.js";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/**
 * Chỉ nhận ảnh.
 *
 * Lưu ý mimetype do client khai báo nên không đáng tin tuyệt đối. Lớp chặn thật
 * nằm ở Cloudinary với `resource_type: "image"` — nó tự từ chối dữ liệu không
 * phải ảnh. Filter này để loại sớm, tiết kiệm băng thông và quota.
 */
const imageOnly = (req, file, cb) => {
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    return cb(null, true);
  }

  cb(badRequest("UNSUPPORTED_FILE_TYPE", `Định dạng không được hỗ trợ: ${file.mimetype}`));
};

/** Avatar: nhỏ, luôn crop vuông. */
export const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: imageOnly,
});

/** Ảnh gửi trong tin nhắn: cho phép lớn hơn avatar. */
export const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: imageOnly,
});

/**
 * Giữ tên `upload` cho tương thích với code cũ.
 * @deprecated dùng `uploadAvatar` hoặc `uploadAttachment`
 */
export const upload = uploadAvatar;

/**
 * Đẩy buffer lên Cloudinary.
 *
 * `...options` được spread SAU các giá trị mặc định, nên folder / transformation /
 * resource_type đều ghi đè được — đó là lý do hàm này dùng lại được cho cả avatar
 * và ảnh tin nhắn mà không cần sửa gì.
 */
export const uploadImageFromBuffer = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "moji_chat/avatars",
        resource_type: "image",
        transformation: [{ width: 200, height: 200, crop: "fill" }],
        ...options,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(buffer);
  });
};

/** Xoá asset theo public_id. Bỏ qua lỗi — đây là dọn dẹp, không phải thao tác chính. */
export const destroyImage = async (publicId) => {
  if (!publicId) return;

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // Ảnh mồ côi trên Cloudinary không đáng để làm fail request của người dùng.
  }
};
