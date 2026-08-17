import { afterAll, afterEach, beforeAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Biến môi trường mà code ứng dụng đọc. Đặt trước khi import bất kỳ module nào
// của app, nên phải nằm ở top level của setup file.
process.env.NODE_ENV = "test";
process.env.ACCESS_TOKEN_SECRET ??= "test-access-token-secret";
process.env.CLIENT_URL ??= "http://localhost:5173";
process.env.CLOUDINARY_CLOUD_NAME ??= "test-cloud";
process.env.CLOUDINARY_API_KEY ??= "test-key";
process.env.CLOUDINARY_API_SECRET ??= "test-secret";

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  // Xoá dữ liệu giữa các test nhưng giữ lại index, để test về index vẫn đúng và
  // không phải build lại index cho mỗi test.
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});
