import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { clearAudienceCache } from "../src/services/audienceService.js";
import { resetPresence } from "../src/socket/presence.js";
import { resetIo, setIo } from "../src/socket/io.js";
import { collectEvents, emitWithAck, startSocketServer } from "./helpers/socketHarness.js";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeFriendship,
  makeGroupConversation,
  makeUser,
} from "./helpers/factories.js";

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

const setup = async () => {
  const [owner, member, invitee] = await Promise.all([
    makeUser({ displayName: "Chủ nhóm" }),
    makeUser({ displayName: "Thành viên" }),
    makeUser({ displayName: "Được mời" }),
  ]);

  const group = await makeGroupConversation(owner, [{ user: member, role: ROLES.MEMBER }]);

  await Promise.all([makeFriendship(owner, member), makeFriendship(owner, invitee)]);

  return { owner, member, invitee, group };
};

describe("thay đổi thành viên khi đang mở cuộc trò chuyện", () => {
  it("người bị xoá NGỪNG nhận tin nhắn ngay lập tức", async () => {
    const { owner, member, group } = await setup();

    const ownerSocket = await harness.connect(owner);
    const memberSocket = await harness.connect(member);

    // Xác nhận trước khi xoá thì họ vẫn nhận được tin.
    const beforeInbox = collectEvents(memberSocket, "message:new");
    await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "trước khi bị xoá",
    });
    expect(await beforeInbox).toHaveLength(1);

    await authedAgent(owner)
      .delete(`/api/conversations/${group._id}/members/${member._id}`)
      .expect(200);

    const afterInbox = collectEvents(memberSocket, "message:new");
    await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "sau khi bị xoá",
    });

    /*
     * Đây là lý do handler xoá phải chủ động `socketsLeave`.
     *
     * Cache membership có TTL 30 giây; nếu chỉ dựa vào cache hết hạn thì người vừa
     * bị xoá vẫn còn trong room và tiếp tục nhận tin nhắn trong tối đa nửa phút.
     */
    expect(await afterInbox).toHaveLength(0);
  });

  it("người bị xoá nhận được conversation:removed", async () => {
    const { owner, member, group } = await setup();

    const memberSocket = await harness.connect(member);
    const inbox = collectEvents(memberSocket, "conversation:removed");

    await authedAgent(owner)
      .delete(`/api/conversations/${group._id}/members/${member._id}`)
      .expect(200);

    const events = await inbox;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: String(group._id),
      reason: "removed",
    });
  });

  it("người mới được thêm nhận tin nhắn NGAY, không cần tải lại trang", async () => {
    const { owner, invitee, group } = await setup();

    // Kết nối TRƯỚC khi được thêm — lúc này chưa ở trong room.
    const inviteeSocket = await harness.connect(invitee);
    const ownerSocket = await harness.connect(owner);

    await authedAgent(owner)
      .post(`/api/conversations/${group._id}/members`)
      .send({ memberIds: [String(invitee._id)] })
      .expect(200);

    const inbox = collectEvents(inviteeSocket, "message:new");

    await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "chào thành viên mới",
    });

    // Không có `socketsJoin` thì họ phải F5 mới thấy tin nhắn realtime.
    const events = await inbox;
    expect(events).toHaveLength(1);
    expect(events[0].message.content).toBe("chào thành viên mới");
  });

  it("người mới nhận conversation:created", async () => {
    const { owner, invitee, group } = await setup();

    const inviteeSocket = await harness.connect(invitee);
    const inbox = collectEvents(inviteeSocket, "conversation:created");

    await authedAgent(owner)
      .post(`/api/conversations/${group._id}/members`)
      .send({ memberIds: [String(invitee._id)] })
      .expect(200);

    const events = await inbox;
    expect(events).toHaveLength(1);
    expect(events[0].conversation._id).toBe(String(group._id));
  });

  it("thành viên còn lại nhận conversation:updated khi nhóm đổi tên", async () => {
    const { owner, member, group } = await setup();

    const memberSocket = await harness.connect(member);
    const inbox = collectEvents(memberSocket, "conversation:updated");

    await authedAgent(owner)
      .patch(`/api/conversations/${group._id}/group`)
      .send({ name: "Tên nhóm đã đổi" })
      .expect(200);

    const events = await inbox;
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1).conversation.group.name).toBe("Tên nhóm đã đổi");
  });

  it("xoá nhóm thì mọi thành viên nhận conversation:removed", async () => {
    const { owner, member, group } = await setup();

    const memberSocket = await harness.connect(member);
    const inbox = collectEvents(memberSocket, "conversation:removed");

    await authedAgent(owner).delete(`/api/conversations/${group._id}`).expect(200);

    const events = await inbox;
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("deleted");
  });
});

describe("xoá tin nhắn cuối", () => {
  it("phát conversation:updated để sidebar không giữ nội dung đã xoá", async () => {
    const { owner, member, group } = await setup();

    const ownerSocket = await harness.connect(owner);
    const memberSocket = await harness.connect(member);

    const sent = await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "tin nhắn cuối sẽ bị xoá",
    });

    const inbox = collectEvents(memberSocket, "conversation:updated");

    await authedAgent(owner)
      .delete(`/api/messages/${sent.message._id}`)
      .expect(200);

    const events = await inbox;

    // `message:deleted` chỉ nói về một tin nhắn; nếu không phát thêm cái này thì
    // sidebar vẫn hiển thị nội dung vừa bị xoá.
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events.at(-1))).not.toContain("tin nhắn cuối sẽ bị xoá");
  });
});

describe("tạo conversation", () => {
  it("NGƯỜI TẠO cũng nhận được event, không chỉ người khác", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const aliceSocket = await harness.connect(alice);
    const inbox = collectEvents(aliceSocket, "conversation:created");

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "Nhóm mới", memberIds: [String(bob._id)] })
      .expect(201);

    // Bản cũ truyền ObjectId vào `io.to()` trong khi room đặt tên bằng string, nên
    // người tạo không bao giờ nhận được event về nhóm mình vừa tạo.
    expect(await inbox).toHaveLength(1);
  });

  it("thành viên được mời cũng vào room ngay", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const bobSocket = await harness.connect(bob);
    const aliceSocket = await harness.connect(alice);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "Nhóm mới", memberIds: [String(bob._id)] })
      .expect(201);

    const inbox = collectEvents(bobSocket, "message:new");

    await emitWithAck(aliceSocket, "message:send", {
      conversationId: res.body.conversation._id,
      content: "tin đầu tiên",
    });

    expect(await inbox).toHaveLength(1);
  });
});
