import fs from "fs";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import swaggerUi from "swagger-ui-express";

import { protectedRoute } from "./middlewares/authMiddleware.js";
import { requestId, notFoundHandler, errorHandler } from "./middlewares/errorMiddleware.js";
import authRoute from "./routes/authRoute.js";
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

  app.use(requestId);
  app.use(express.json());
  app.use(cookieParser());
  app.use(cors({ origin: clientUrl, credentials: true }));

  // API docs — mở trước protectedRoute nên phải tự giới hạn: không expose ở production.
  if (docsEnabled) {
    // Đọc theo đường dẫn của module, không theo cwd, để chạy được từ mọi thư mục.
    const swaggerDocument = JSON.parse(
      fs.readFileSync(new URL("./swagger.json", import.meta.url), "utf8"),
    );
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }

  app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

  // Public
  app.use("/api/auth", authRoute);

  // Mọi thứ đăng ký sau dòng này đều yêu cầu đăng nhập (default-deny).
  app.use(protectedRoute);
  app.use("/api/users", userRoute);
  app.use("/api/friends", friendRoute);
  app.use("/api/messages", messageRoute);
  app.use("/api/conversations", conversationRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
