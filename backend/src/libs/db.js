import mongoose from "mongoose";
import logger from "../utils/logger.js";

export const connectDB = async () => {
  const uri = process.env.MONGODB_CONNECTION_STRING;

  if (!uri) {
    logger.error("Thiếu MONGODB_CONNECTION_STRING");
    process.exit(1);
  }

  /*
    `dbName` là TUỲ CHỌN, và chỉ truyền khi thực sự được đặt.

    Truyền vô điều kiện sẽ đè lên tên database viết trong URI, làm hỏng mọi URI
    dạng `mongodb://host/ten-db` — kiểu vẫn dùng khi chạy local hay khi trỏ vào
    một database tạm để kiểm thử.
  */
  const dbName = process.env.MONGODB_DB_NAME;

  try {
    await mongoose.connect(uri, dbName ? { dbName } : {});

    /*
      In tên database THẬT SỰ đang dùng, không phải tên mình tưởng.

      URI production không ghi tên database nào, nên mongoose rơi về mặc định là
      `test`. Đó đúng là chỗ dữ liệu đang nằm, nhưng nhìn config thì không ai đoán
      ra — và `mongosh` không tham số lại vào một chỗ khác. Log ra để không bao giờ
      phải đoán, nhất là trước khi chạy migration.
    */
    logger.info(`MongoDB đã kết nối — database "${mongoose.connection.name}"`);
  } catch (error) {
    logger.error(`Không kết nối được MongoDB: ${error.message}`);
    process.exit(1);
  }
};
