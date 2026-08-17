import jwt from "jsonwebtoken";
import supertest from "supertest";
import { createApp } from "../../src/app.js";

/**
 * Express app dùng chung cho test.
 *
 * `createApp()` không lắng nghe port, nên supertest tự bind một port ephemeral
 * cho từng request.
 */
export const testApp = () => createApp({ exposeDocs: false });

export const signAccessToken = (user, { expiresIn = "15m" } = {}) =>
  jwt.sign({ userId: String(user._id) }, process.env.ACCESS_TOKEN_SECRET, { expiresIn });

/** Supertest agent đã gắn Authorization header của `user`. */
export const authedAgent = (user, app = testApp()) => {
  const token = signAccessToken(user);
  const agent = supertest.agent(app);

  // supertest.agent hỗ trợ set header mặc định cho mọi request.
  agent.set("Authorization", `Bearer ${token}`);

  return agent;
};

/** Agent không xác thực, để kiểm tra các route yêu cầu đăng nhập. */
export const anonAgent = (app = testApp()) => supertest(app);
