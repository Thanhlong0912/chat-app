import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { protectedRoute } from "./middlewares/authMiddleware.js";
import { requestId, notFoundHandler, errorHandler } from "./middlewares/errorMiddleware.js";
import { globalLimiter } from "./middlewares/rateLimitMiddleware.js";
import authRoute, { authProtectedRoute } from "./routes/authRoute.js";
import userRoute from "./routes/userRoute.js";
import friendRoute from "./routes/friendRoute.js";
import messageRoute from "./routes/messageRoute.js";
import conversationRoute from "./routes/conversationRoute.js";

/**
 * Dựng Express app mà không lắng nghe port.
 *
 * Tách khỏi `server.js` để test có thể `createApp()` rồi đưa thẳng vào supertest,
 * thay vì phải bind một port thật.
 */
export function createApp({ clientUrl = process.env.CLIENT_URL, exposeDocs } = {}) {
  const app = express();

  const docsEnabled = exposeDocs ?? process.env.NODE_ENV !== "production";

  // Bắt buộc khi chạy sau reverse proxy (Render). Không có dòng này thì
  // express-rate-limit thấy mọi request đến từ cùng một IP là proxy, và sẽ
  // rate limit toàn bộ người dùng chung một quota.
  app.set("trust proxy", 1);

  app.use(requestId);

  // Swagger mount TRƯỚC helmet: CSP của helmet chặn inline script của swagger-ui.
  // Docs chỉ bật ngoài production nên đánh đổi này là chấp nhận được.
  if (docsEnabled) {
    // Đọc theo đường dẫn của module, không theo cwd, để chạy được từ mọi thư mục.
    const swaggerDocument = JSON.parse(
      fs.readFileSync(new URL("./swagger.json", import.meta.url), "utf8"),
    );
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }

  app.use(helmet());

  // Limiter tự bỏ qua trong môi trường test (xem rateLimitMiddleware).
  app.use(globalLimiter);

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(cors({ origin: clientUrl, credentials: true }));

  app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

  // Public
  app.use("/api/auth", authRoute);

  // Mọi thứ đăng ký sau dòng này đều yêu cầu đăng nhập (default-deny).
  app.use(protectedRoute);
  app.use("/api/auth", authProtectedRoute);
  app.use("/api/users", userRoute);
  app.use("/api/friends", friendRoute);
  app.use("/api/messages", messageRoute);
  app.use("/api/conversations", conversationRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
