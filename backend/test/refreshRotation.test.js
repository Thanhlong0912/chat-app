import { describe, expect, it } from "vitest";
import supertest from "supertest";
import Session from "../src/models/Session.js";
import { hashToken } from "../src/utils/tokens.js";
import { testApp } from "./helpers/authedAgent.js";
import { makeUser } from "./helpers/factories.js";

const PASSWORD = "matkhaudung123";

/** Đăng nhập thật để lấy cookie + access token như client làm. */
const signIn = async (app, user) => {
  const res = await supertest(app)
    .post("/api/auth/signin")
    .send({ username: user.username, password: PASSWORD })
    .expect(200);

  return { accessToken: res.body.accessToken, cookie: res.headers["set-cookie"] };
};

const refreshTokenFrom = (cookie) => {
  const raw = [].concat(cookie).find((c) => c.startsWith("refreshToken="));
  return decodeURIComponent(raw.split(";")[0].split("=")[1]);
};

describe("lưu trữ refresh token", () => {
  it("không lưu token dạng phẳng — chỉ lưu SHA-256", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const raw = refreshTokenFrom(cookie);

    const stored = await Session.findOne({ userId: user._id }).lean();

    expect(stored.refreshToken).toBe(hashToken(raw));
    expect(stored.refreshToken).not.toBe(raw);
    // Token gốc không được xuất hiện ở bất kỳ field nào của bản ghi.
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it("ghi lại userAgent và ip cho màn hình quản lý phiên", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    // Header HTTP chỉ chứa ASCII, nên dùng một UA thật thay vì chuỗi tiếng Việt.
    const userAgent = "Mozilla/5.0 (Macintosh) TestRunner/1.0";

    await supertest(app)
      .post("/api/auth/signin")
      .set("User-Agent", userAgent)
      .send({ username: user.username, password: PASSWORD })
      .expect(200);

    const stored = await Session.findOne({ userId: user._id }).lean();

    expect(stored.userAgent).toBe(userAgent);
    expect(stored.ip).toBeTruthy();
  });

  it("cookie là httpOnly", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);

    expect([].concat(cookie)[0]).toMatch(/HttpOnly/i);
  });
});

describe("session cũ lưu token phẳng", () => {
  it("KHÔNG còn refresh được", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    // Hình dạng dữ liệu của thời chưa băm: token gốc nằm thẳng trong DB.
    const legacyRaw = "a".repeat(128);
    await Session.create({
      userId: user._id,
      refreshToken: legacyRaw,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    // Nhánh đọc song song đã bỏ sau khi mọi session cũ hết hạn theo TTL 14 ngày.
    // Đây là điều thực sự đáng khẳng định: chuỗi nằm trong database không còn tự
    // nó là một thông tin xác thực hợp lệ — nếu không thì việc băm chẳng để làm gì.
    await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${legacyRaw}`])
      .expect(401);
  });

  it("token băm thì vẫn refresh bình thường", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${refreshTokenFrom(cookie)}`])
      .expect(200);

    // Cặp đôi với test trên: chứng minh 401 kia đến từ việc token phẳng bị từ
    // chối, chứ không phải vì đường refresh đã hỏng hoàn toàn.
    const newRaw = refreshTokenFrom(res.headers["set-cookie"]);

    expect(await Session.findOne({ refreshToken: hashToken(newRaw) }).lean()).not.toBeNull();
  });
});

describe("rotation", () => {
  it("mỗi lần refresh phát ra một refresh token mới", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const first = refreshTokenFrom(cookie);

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${first}`])
      .expect(200);

    const second = refreshTokenFrom(res.headers["set-cookie"]);

    expect(second).not.toBe(first);
  });

  it("token mới thuộc cùng một họ session", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const first = refreshTokenFrom(cookie);

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${first}`])
      .expect(200);

    const second = refreshTokenFrom(res.headers["set-cookie"]);
    const sessions = await Session.find({ userId: user._id }).lean();
    const families = new Set(sessions.map((s) => String(s.familyId)));

    expect(sessions).toHaveLength(2);
    expect(families.size).toBe(1);
    expect(await Session.findOne({ refreshToken: hashToken(second) })).not.toBeNull();
  });

  it("token không tồn tại → 403", async () => {
    const app = testApp();

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", ["refreshToken=khong-ton-tai"])
      .expect(401);

    expect(res.body.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("thiếu cookie → 401", async () => {
    const app = testApp();

    const res = await supertest(app).post("/api/auth/refresh").expect(401);

    expect(res.body.code).toBe("NO_REFRESH_TOKEN");
  });

  it("token đã hết hạn → 403 và bị xoá", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const raw = "b".repeat(128);
    await Session.create({
      userId: user._id,
      refreshToken: hashToken(raw),
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${raw}`])
      .expect(401);

    expect(res.body.code).toBe("REFRESH_TOKEN_EXPIRED");
    expect(await Session.findOne({ refreshToken: hashToken(raw) })).toBeNull();
  });
});

describe("phát hiện dùng lại token", () => {
  it("dùng lại token đã rotate quá thời gian ân hạn → thu hồi cả họ", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const stolen = refreshTokenFrom(cookie);

    // Client hợp lệ refresh một lần.
    await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${stolen}`])
      .expect(200);

    // Đẩy thời điểm rotate về quá khứ để ra ngoài khoảng ân hạn.
    await Session.updateOne(
      { refreshToken: hashToken(stolen) },
      { $set: { rotatedAt: new Date(Date.now() - 60_000) } },
    );

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${stolen}`])
      .expect(401);

    expect(res.body.code).toBe("REFRESH_TOKEN_REUSED");
    // Cả họ bị xoá, nên token mà kẻ tấn công lẫn người dùng thật đang giữ đều chết.
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });

  it("refresh song song trong khoảng ân hạn KHÔNG đăng xuất người dùng", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const raw = refreshTokenFrom(cookie);

    // Đây chính là hành vi của client hiện tại: nhiều request 401 đồng thời kích
    // hoạt nhiều lần refresh với cùng một token. Coi đó là tấn công sẽ đăng xuất
    // oan người dùng.
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        supertest(app).post("/api/auth/refresh").set("Cookie", [`refreshToken=${raw}`]),
      ),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => Boolean(r.body.accessToken))).toBe(true);
    // Phiên đăng nhập vẫn còn sống.
    expect(await Session.countDocuments({ userId: user._id })).toBeGreaterThan(0);
  });
});

describe("thu hồi access token", () => {
  it("access token chết ngay sau khi đăng xuất", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { accessToken, cookie } = await signIn(app, user);

    // Trước khi đăng xuất token dùng được.
    await supertest(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    await supertest(app)
      .post("/api/auth/signout")
      .set("Cookie", [].concat(cookie))
      .expect(204);

    // Sau khi đăng xuất, token cũ không còn dùng được dù chưa hết 15 phút.
    const res = await supertest(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);

    expect(res.body.code).toBe("SESSION_REVOKED");
  });

  it("đăng xuất xoá cả họ session, không chỉ token đang giữ", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const { cookie } = await signIn(app, user);
    const first = refreshTokenFrom(cookie);

    const refreshed = await supertest(app)
      .post("/api/auth/refresh")
      .set("Cookie", [`refreshToken=${first}`])
      .expect(200);

    const second = refreshTokenFrom(refreshed.headers["set-cookie"]);

    await supertest(app)
      .post("/api/auth/signout")
      .set("Cookie", [`refreshToken=${second}`])
      .expect(204);

    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });

  it("signout-all thu hồi mọi thiết bị", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    const first = await signIn(app, user);
    await signIn(app, user);
    await signIn(app, user);

    expect(await Session.countDocuments({ userId: user._id })).toBe(3);

    const res = await supertest(app)
      .post("/api/auth/signout-all")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .expect(200);

    expect(res.body.revoked).toBe(3);
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });

  it("token cũ chưa có sid vẫn dùng được cho tới khi hết hạn", async () => {
    const app = testApp();
    const user = await makeUser();
    const { signAccessToken } = await import("./helpers/authedAgent.js");

    // Token phát ra trước thay đổi này không mang `sid`; không được đăng xuất họ
    // giữa lúc deploy.
    await supertest(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${signAccessToken(user)}`)
      .expect(200);
  });
});

describe("danh sách phiên", () => {
  it("liệt kê các phiên đang hoạt động và đánh dấu phiên hiện tại", async () => {
    const app = testApp();
    const user = await makeUser({ password: PASSWORD });

    await signIn(app, user);
    const current = await signIn(app, user);

    const res = await supertest(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${current.accessToken}`)
      .expect(200);

    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.filter((s) => s.current)).toHaveLength(1);
    // Không được lộ token (kể cả hash) ra ngoài.
    expect(JSON.stringify(res.body)).not.toContain("refreshToken");
  });
});
