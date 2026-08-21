import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import FriendRequest from "../src/models/FriendRequest.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { clearAudienceCache, getAudience } from "../src/services/audienceService.js";
import { resetPresence } from "../src/socket/presence.js";
import { resetIo, setIo } from "../src/socket/io.js";
import { startSocketServer } from "./helpers/socketHarness.js";
import { authedAgent } from "./helpers/authedAgent.js";
import { makeFriendship, makeUser } from "./helpers/factories.js";

/**
 * Presence chỉ được phát tới "audience" của một người — bạn bè cộng với thành
 * viên các conversation chung — và tập đó được cache 5 phút.
 *
 * Cache ấy chưa từng được xoá khi quan hệ THAY ĐỔI: `invalidateAudience` chỉ được
 * gọi từ groupService, không từ luồng chấp nhận lời mời kết bạn, cũng không từ
 * luồng tạo conversation. Hệ quả: hai người vừa kết bạn không nằm trong audience
 * đã cache của nhau, nên không ai nhận được `presence:update` của ai. Thêm nữa,
 * `presence:snapshot` chỉ được gửi đúng một lần lúc kết nối, nên người bạn mới
 * cũng không xuất hiện trong ảnh chụp — dấu online đứng im màu xám cho tới khi cả
 * hai tải lại trang VÀ cache hết hạn.
 */
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

/** Chờ một `presence:update` về đúng `aboutUserId`. */
const nextPresenceFor = (socket, aboutUserId, { timeout = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`không nhận được presence:update cho ${aboutUserId}`)),
      timeout,
    );

    const handler = (payload) => {
      if (String(payload.userId) !== String(aboutUserId)) return;
      clearTimeout(timer);
      socket.off("presence:update", handler);
      resolve(payload);
    };

    socket.on("presence:update", handler);
  });

describe("audience được tính lại khi quan hệ thay đổi", () => {
  it("chấp nhận lời mời kết bạn đưa mỗi người vào audience của người kia", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);

    // Làm nóng cache TRƯỚC khi kết bạn — đây chính là tình huống thật: cả hai
    // đang mở app, audience đã được tính và chưa có nhau trong đó.
    expect(await getAudience(alice._id)).toEqual([]);
    expect(await getAudience(bob._id)).toEqual([]);

    const request = await FriendRequest.create({ from: alice._id, to: bob._id });

    await authedAgent(bob)
      .post(`/api/friends/requests/${request._id}/accept`)
      .expect(200);

    expect(await getAudience(alice._id)).toEqual([String(bob._id)]);
    expect(await getAudience(bob._id)).toEqual([String(alice._id)]);
  });

  it("tạo conversation 1-1 đưa hai người vào audience của nhau", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    clearAudienceCache();
    await getAudience(alice._id);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "direct", memberIds: [String(bob._id)] })
      .expect(201);

    expect(await getAudience(alice._id)).toContain(String(bob._id));
    expect(await getAudience(bob._id)).toContain(String(alice._id));
  });

  it("người bạn mới thấy dấu online NGAY, không cần tải lại trang", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);

    // Cả hai đang online và chưa quen nhau.
    const aliceSocket = await harness.connect(alice);
    await harness.connect(bob);

    const aliceHearsAboutBob = nextPresenceFor(aliceSocket, bob._id);

    const request = await FriendRequest.create({ from: alice._id, to: bob._id });
    await authedAgent(bob)
      .post(`/api/friends/requests/${request._id}/accept`)
      .expect(200);

    expect((await aliceHearsAboutBob).status).toBe("online");
  });

  it("người vừa kết bạn nhận được trạng thái của phía kia, cả hai chiều", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);

    await harness.connect(alice);
    const bobSocket = await harness.connect(bob);

    const bobHearsAboutAlice = nextPresenceFor(bobSocket, alice._id);

    const request = await FriendRequest.create({ from: alice._id, to: bob._id });
    await authedAgent(bob)
      .post(`/api/friends/requests/${request._id}/accept`)
      .expect(200);

    expect((await bobHearsAboutAlice).status).toBe("online");
  });

  it("bạn mới đang offline thì báo đúng là offline, không phải im lặng", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);

    // Chỉ alice online.
    const aliceSocket = await harness.connect(alice);

    const aliceHearsAboutBob = nextPresenceFor(aliceSocket, bob._id);

    const request = await FriendRequest.create({ from: bob._id, to: alice._id });
    await authedAgent(alice)
      .post(`/api/friends/requests/${request._id}/accept`)
      .expect(200);

    expect((await aliceHearsAboutBob).status).toBe("offline");
  });

  it("mở chat 1-1 với người đang online cho thấy dấu online ngay", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const aliceSocket = await harness.connect(alice);
    await harness.connect(bob);

    const aliceHearsAboutBob = nextPresenceFor(aliceSocket, bob._id);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "direct", memberIds: [String(bob._id)] })
      .expect(201);

    expect((await aliceHearsAboutBob).status).toBe("online");
  });
});
