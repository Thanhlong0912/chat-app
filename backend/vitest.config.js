import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.js"],

    // Tất cả test file chạy tuần tự trong một process duy nhất, dùng chung một
    // MongoDB in-memory. Chạy song song sẽ khiến các file ghi/xoá lẫn dữ liệu
    // của nhau, vì `afterEach` xoá sạch collection.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },

    // Lần chạy đầu có thể phải tải binary mongod.
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
