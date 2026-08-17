import http from "http";

import { createApp } from "./app.js";
import { createIo } from "./socket/index.js";
import { setIo } from "./socket/io.js";
import { connectDB } from "./libs/db.js";
import { configureCloudinary } from "./libs/cloudinary.js";
import logger from "./utils/logger.js";

const port = process.env.PORT || 5001;

configureCloudinary();

const app = createApp();
const httpServer = http.createServer(app);

setIo(createIo(httpServer, { corsOrigin: process.env.CLIENT_URL }));

connectDB()
  .then(() => {
    httpServer.listen(port, () => {
      logger.info(`Server đang chạy ở port ${port}`);
    });
  })
  .catch((error) => {
    logger.error("Không khởi động được server:", error);
    process.exit(1);
  });

export { app, httpServer };
