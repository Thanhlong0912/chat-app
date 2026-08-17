import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { resetPresence } from "../src/socket/presence.js";
import { clearAudienceCache } from "../src/services/audienceService.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { resetIo, setIo } from "../src/socket/io.js";
import { emitWithAck, startSocketServer } from "./helpers/socketHarness.js";
import { signAccessToken } from "./helpers/authedAgent.js";
import { makeUser } from "./helpers/factories.js";

let harness;

beforeAll(async () => {
  harness = await startSocketServer();
  setIo(harness.ioServer);
});

afterAll(async () => {
  await harness.close();
  resetIo();
});

beforeEach(() => {
  clearMembershipCache();
  clearAudienceCache();
  resetPresence();
});

const waitFor = (socket, event, timeout = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`hết thời gian chờ '${event}'`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/**
 * Client với listener `auth:reauth` gắn TRƯỚC khi kết nối hoàn tất.
 *
 * Timer gia hạn được hẹn ở exp - 60s, nên với token sống 61s nó bắn sau ~1s — cùng
 * cỡ thời gian với việc server join room và phát `connection:ready`. Nếu đợi
 * `connection:ready` rồi mới gắn listener thì có thể bỏ mất event, và test sẽ
 * flaky chứ không phản ánh lỗi thật.
 */
const clientAwaitingReauth = (user) => {
  const socket = harness.rawClient(user, {
    token: signAccessToken(user, { expiresIn: "61s" }),
  });

  const reauth = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hết thời gian chờ 'auth:reauth'")), 4000);
    socket.once("auth:reauth", (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
    socket.once("connect_error", reject);
  });

  return { socket, reauth };
};

describe("gia hạn xác thực trên socket đang mở", () => {
  it("xin token mới trước khi token hiện tại hết hạn", async () => {
    const user = await makeUser();
    const { reauth } = clientAwaitingReauth(user);

    await expect(reauth).resolves.toBeDefined();
  });

  it("chấp nhận token mới hợp lệ và giữ kết nối", async () => {
    const user = await makeUser();
    const { socket, reauth } = clientAwaitingReauth(user);

    await reauth;

    const ack = await emitWithAck(socket, "auth:token", {
      token: signAccessToken(user, { expiresIn: "15m" }),
    });

    expect(ack).toEqual({ ok: true });
    expect(socket.connected).toBe(true);
  });

  it("từ chối token của user KHÁC và ngắt kết nối", async () => {
    const [victim, attacker] = await Promise.all([makeUser(), makeUser()]);

    const socket = await harness.connect(victim);

    // Nếu không kiểm tra userId, kẻ tấn công có thể dùng token hợp lệ của chính
    // mình để chiếm một socket đang mở của người khác.
    const ack = await emitWithAck(socket, "auth:token", {
      token: signAccessToken(attacker),
    });

    expect(ack).toEqual({ ok: false, code: "TOKEN_INVALID" });
    await new Promise((r) => setTimeout(r, 100));
    expect(socket.connected).toBe(false);
  });

  it("từ chối token rác và ngắt kết nối", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    const ack = await emitWithAck(socket, "auth:token", { token: "khong-phai-jwt" });

    expect(ack).toEqual({ ok: false, code: "TOKEN_INVALID" });
  });

  it("từ chối token đã hết hạn", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    const ack = await emitWithAck(socket, "auth:token", {
      token: signAccessToken(user, { expiresIn: "-1s" }),
    });

    expect(ack).toEqual({ ok: false, code: "TOKEN_INVALID" });
  });

  it("từ chối token có sid của session đã bị thu hồi", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    // `sid` trỏ tới một session không tồn tại — tức đã bị thu hồi.
    const token = jwt.sign(
      { userId: String(user._id), sid: "507f1f77bcf86cd799439011" },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" },
    );

    const ack = await emitWithAck(socket, "auth:token", { token });

    expect(ack).toEqual({ ok: false, code: "TOKEN_INVALID" });
  });

  it("cập nhật displayName trên socket sau khi gia hạn", async () => {
    const user = await makeUser({ displayName: "Tên cũ" });
    const socket = await harness.connect(user);

    const { default: User } = await import("../src/models/User.js");
    await User.updateOne({ _id: user._id }, { $set: { displayName: "Tên mới" } });

    await emitWithAck(socket, "auth:token", { token: signAccessToken(user) });

    // Socket phải dùng bản user mới, vì displayName đi kèm mọi event typing.
    const { default: Conversation } = await import("../src/models/Conversation.js");
    const friend = await makeUser();
    const convo = await Conversation.create({
      type: "direct",
      participants: [{ userId: user._id }, { userId: friend._id }],
    });

    const watcher = await harness.connect(friend);
    const typingPromise = waitFor(watcher, "typing:update");

    socket.emit("typing:start", { conversationId: String(convo._id) });

    expect((await typingPromise).displayName).toBe("Tên mới");
  });
});

describe("transports", () => {
  it("bật cả polling, không chỉ websocket", () => {
    // Một số proxy doanh nghiệp chặn WebSocket; không có fallback thì với những
    // người dùng đó realtime đơn giản là không hoạt động.
    expect(harness.ioServer.engine.opts.transports).toEqual(
      expect.arrayContaining(["websocket", "polling"]),
    );
  });
});
