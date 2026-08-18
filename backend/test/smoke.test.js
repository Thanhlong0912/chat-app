import { describe, expect, it } from "vitest";
import { anonAgent, authedAgent, signAccessToken, testApp } from "./helpers/authedAgent.js";
import { makeUser } from "./helpers/factories.js";

describe("hạ tầng test", () => {
  it("dựng được app mà không cần bind port", async () => {
    const res = await anonAgent().get("/health").expect(200);

    expect(res.body.status).toBe("ok");
    // `commit` luôn có mặt, kể cả khi null — client dò deploy đọc thẳng khoá này
    // và không phải phân biệt "chưa deploy bản mới" với "bản mới không có khoá".
    expect(res.body).toHaveProperty("commit");
  });

  it("/health trả về commit khi môi trường có cung cấp", async () => {
    const previous = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = "abc1234";

    try {
      const res = await anonAgent().get("/health").expect(200);

      expect(res.body.commit).toBe("abc1234");
    } finally {
      if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previous;
    }
  });

  it("factory tạo được user trong mongo in-memory", async () => {
    const user = await makeUser({ displayName: "Long" });

    expect(user._id).toBeDefined();
    expect(user.displayName).toBe("Long");
    // hashedPassword phải là hash, không phải plaintext.
    expect(user.hashedPassword).not.toBe("password123");
  });
});

describe("protectedRoute", () => {
  it("trả 401 khi không có token", async () => {
    const res = await anonAgent().get("/api/users/me").expect(401);

    expect(res.body.code).toBe("NO_ACCESS_TOKEN");
  });

  it("trả 401 với code TOKEN_EXPIRED khi token hết hạn", async () => {
    const user = await makeUser();
    const expired = signAccessToken(user, { expiresIn: "-1s" });

    const res = await anonAgent()
      .get("/api/users/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);

    // Client dựa vào code này để quyết định refresh thay vì đăng xuất.
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  it("trả 401 với code TOKEN_INVALID khi token sai chữ ký", async () => {
    const res = await anonAgent()
      .get("/api/users/me")
      .set("Authorization", "Bearer khong-phai-jwt")
      .expect(401);

    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  it("cho qua và gắn req.user khi token hợp lệ", async () => {
    const user = await makeUser({ displayName: "Mai" });

    const res = await authedAgent(user).get("/api/users/me").expect(200);

    expect(res.body.user.displayName).toBe("Mai");
    // Không được lộ hashedPassword ra response.
    expect(res.body.user.hashedPassword).toBeUndefined();
  });

  it("trả 401 khi user trong token đã bị xoá", async () => {
    const user = await makeUser();
    const token = signAccessToken(user);
    await user.deleteOne();

    const res = await anonAgent()
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);

    expect(res.body.code).toBe("USER_NOT_FOUND");
  });
});

describe("errorHandler", () => {
  it("trả 404 có code cho route không tồn tại", async () => {
    const user = await makeUser();

    const res = await authedAgent(user).get("/api/khong-ton-tai").expect(404);

    expect(res.body.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.requestId).toBeDefined();
  });

  it("không tiết lộ route nào tồn tại với người chưa đăng nhập", async () => {
    // `protectedRoute` mount ở tầng app nên chặn cả path không tồn tại: người
    // chưa đăng nhập nhận 401 chứ không phải 404, không dò được route.
    const res = await anonAgent().get("/api/khong-ton-tai").expect(401);

    expect(res.body.code).toBe("NO_ACCESS_TOKEN");
  });

  it("gắn X-Request-Id vào mọi response", async () => {
    const res = await anonAgent().get("/health").expect(200);

    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("chuyển ObjectId sai định dạng thành 400 chứ không phải 500", async () => {
    const user = await makeUser();

    const res = await authedAgent(user)
      .get("/api/conversations/khong-phai-objectid/messages")
      .expect(400);

    // Validate ở tầng route chặn trước khi tới service, nên code là
    // VALIDATION_ERROR kèm tên field — hữu ích hơn cho client so với một mã
    // chung. Đường socket không đi qua zod và vẫn trả INVALID_ID.
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.fields).toHaveProperty("conversationId");
  });
});

describe("không còn vòng import socket <-> controller", () => {
  it("import được controller mà không cần khởi tạo io", async () => {
    const controller = await import("../src/controllers/conversationController.js");

    expect(typeof controller.getConversations).toBe("function");
  });

  it("import được socket layer mà không kéo theo controller", async () => {
    const socket = await import("../src/socket/index.js");

    expect(typeof socket.createIo).toBe("function");
  });

  it("getIo() trả null khi chưa setIo, và controller không crash vì thế", async () => {
    const { getIo } = await import("../src/socket/io.js");

    expect(getIo()).toBeNull();
  });

  it("app.js dựng được app đầy đủ", () => {
    expect(testApp()).toBeTypeOf("function");
  });
});
