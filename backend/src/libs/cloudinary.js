import { v2 as cloudinary } from "cloudinary";

/**
 * Cấu hình Cloudinary.
 *
 * Là một hàm chứ không phải side effect khi import, để đảm bảo nó chỉ chạy sau
 * khi biến môi trường đã được nạp.
 */
export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export { cloudinary };
