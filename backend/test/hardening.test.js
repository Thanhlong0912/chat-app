import { afterEach, describe, expect, it } from "vitest";
import {
  resetRateLimits,
  setRateLimitEnabled,
} from "../src/middlewares/rateLimitMiddleware.js";
import { anonAgent, authedAgent } from "./helpers/authedAgent.js";
import { makeFriendship, makeUser } from "./helpers/factories.js";

const validSignUp = (overrides = {}) => ({
  username: `nguoidung${Math.random().toString(36).slice(2, 8)}`,
  password: "matkhaudai123",
  email: `${Math.random().toString(36).slice(2, 8)}@example.com`,
  firstName: "Long",
  lastName: "Đinh",
  ...overrides,
});

describe("validate() trên signup", () => {
  it("nhận payload hợp lệ", async () => {
    await anonAgent().post("/api/auth/signup").send(validSignUp()).expect(204);
  });

  it("từ chối email sai định dạng, kèm tên field", async () => {
    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ email: "khong-phai-email" }))
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.fields).toHaveProperty("email");
  });

  it("từ chối mật khẩu ngắn hơn 8 ký tự", async () => {
    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ password: "ngan" }))
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("password");
  });

  it("từ chối mật khẩu dài quá 72 byte", async () => {
    // bcrypt âm thầm cắt ở 72 byte: nếu cho phép dài hơn thì hai mật khẩu khác
    // nhau nhưng trùng 72 byte đầu sẽ cùng đăng nhập được.
    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ password: "a".repeat(73) }))
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("password");
  });

  it("đếm theo byte chứ không theo ký tự", async () => {
    // 40 ký tự "ế" là 120 byte trong UTF-8 — phải bị từ chối dù chỉ 40 ký tự.
    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ password: "ế".repeat(40) }))
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("password");
  });

  it("chấp nhận đúng 72 byte", async () => {
    await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ password: "a".repeat(72) }))
      .expect(204);
  });

  it("từ chối username có ký tự lạ", async () => {
    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ username: "nguoi dung!" }))
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("username");
  });

  it("email trùng → 409 chứ không phải 500 từ unique index", async () => {
    const payload = validSignUp();
    await anonAgent().post("/api/auth/signup").send(payload).expect(204);

    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ email: payload.email }))
      .expect(409);

    expect(res.body.code).toBe("DUPLICATE_USER");
    expect(res.body.details.field).toBe("email");
  });

  it("username trùng → 409", async () => {
    const payload = validSignUp();
    await anonAgent().post("/api/auth/signup").send(payload).expect(204);

    const res = await anonAgent()
      .post("/api/auth/signup")
      .send(validSignUp({ username: payload.username }))
      .expect(409);

    expect(res.body.details.field).toBe("username");
  });
});

describe("validate() trên gửi tin nhắn", () => {
  it("từ chối nội dung rỗng", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/messages/direct")
      .send({ recipientId: String(bob._id), content: "   " })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("content");
  });

  it("từ chối nội dung dài quá 4000 ký tự", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/messages/direct")
      .send({ recipientId: String(bob._id), content: "a".repeat(4001) })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("content");
  });

  it("từ chối recipientId không phải ObjectId", async () => {
    const alice = await makeUser();

    const res = await authedAgent(alice)
      .post("/api/messages/direct")
      .send({ recipientId: "khong-phai-id", content: "chào" })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("recipientId");
  });

  it("cắt bỏ field lạ, chặn mass assignment", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(bob._id),
        content: "chào",
        // Cố ghi đè người gửi.
        senderId: String(bob._id),
      })
      .expect(201);

    // senderId phải luôn lấy từ token, không phải từ body.
    expect(String(res.body.message.senderId)).toBe(String(alice._id));
  });
});

describe("validate() trên tạo conversation", () => {
  it("nhóm bắt buộc có tên", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", memberIds: [String(bob._id)] })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("name");
  });

  it("loại bỏ memberIds trùng lặp", async () => {
    const [alice, bob, carol] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await Promise.all([makeFriendship(alice, bob), makeFriendship(alice, carol)]);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({
        type: "group",
        name: "Nhóm thử",
        memberIds: [String(bob._id), String(bob._id), String(carol._id)],
      })
      .expect(201);

    // alice + bob + carol = 3, không phải 4.
    expect(res.body.conversation.participants).toHaveLength(3);
  });

  it("direct chỉ nhận đúng một người nhận", async () => {
    const [alice, bob, carol] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await Promise.all([makeFriendship(alice, bob), makeFriendship(alice, carol)]);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "direct", memberIds: [String(bob._id), String(carol._id)] })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("memberIds");
  });

  it("từ chối type lạ", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "broadcast", memberIds: [String(bob._id)] })
      .expect(400);
  });

  it("người tạo nhóm là owner", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "Nhóm mới", memberIds: [String(bob._id)] })
      .expect(201);

    const { default: Conversation } = await import("../src/models/Conversation.js");
    const convo = await Conversation.findById(res.body.conversation._id).lean();
    const creator = convo.participants.find((p) => String(p.userId) === String(alice._id));

    expect(creator.role).toBe("owner");
  });
});

describe("chặn trên cho limit khi phân trang", () => {
  it("từ chối limit vượt 100 thay vì trả toàn bộ collection", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const { makeDirectConversation } = await import("./helpers/factories.js");
    const convo = await makeDirectConversation(alice, bob);

    const res = await authedAgent(alice)
      .get(`/api/conversations/${convo._id}/messages?limit=999999`)
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("limit");
  });

  it("limit không phải số bị từ chối, không rơi vào NaN", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const { makeDirectConversation } = await import("./helpers/factories.js");
    const convo = await makeDirectConversation(alice, bob);

    // Trước đây Number("rác") ra NaN và .limit(NaN) trả về mọi tin nhắn.
    await authedAgent(alice)
      .get(`/api/conversations/${convo._id}/messages?limit=rac`)
      .expect(400);
  });
});

describe("helmet", () => {
  it("gắn các security header", async () => {
    const res = await anonAgent().get("/health").expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    // helmet ẩn việc backend chạy Express.
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  afterEach(() => {
    // Store là module-level nên phải dọn, nếu không các test khác sẽ bị 429.
    setRateLimitEnabled(false);
    resetRateLimits();
  });

  it("chặn brute force đăng nhập sau 10 lần thất bại", async () => {
    const user = await makeUser({ password: "matkhaudung123" });

    setRateLimitEnabled(true);
    resetRateLimits();

    const attempt = () =>
      anonAgent()
        .post("/api/auth/signin")
        .send({ username: user.username, password: "matkhausai" });

    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await attempt()).status);
    }

    // 10 lần đầu là 401, sau đó bị chặn.
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("lỗi 429 dùng cùng hình dạng response như mọi lỗi khác", async () => {
    const user = await makeUser();

    setRateLimitEnabled(true);
    resetRateLimits();

    // Dừng ngay khi bị chặn: mỗi lần thử là một lượt bcrypt, và chạy thừa chỉ làm
    // test nhạy cảm hơn với tải của máy mà không kiểm chứng thêm điều gì.
    let res;
    for (let i = 0; i < 12; i += 1) {
      res = await anonAgent()
        .post("/api/auth/signin")
        .send({ username: user.username, password: "matkhausai" });

      if (res.status === 429) break;
    }

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    expect(res.body.requestId).toBeDefined();
  });

  it("đăng nhập thành công không bị tính vào giới hạn", async () => {
    const user = await makeUser({ password: "matkhaudung123" });

    setRateLimitEnabled(true);
    resetRateLimits();

    // Nhiều lần đăng nhập đúng liên tiếp vẫn phải được phục vụ.
    for (let i = 0; i < 12; i += 1) {
      await anonAgent()
        .post("/api/auth/signin")
        .send({ username: user.username, password: "matkhaudung123" })
        .expect(200);
    }
  });
});
