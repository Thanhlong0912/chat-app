import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { clearAudienceCache } from "../src/services/audienceService.js";
import { resetPresence } from "../src/socket/presence.js";
import { resetIo, setIo } from "../src/socket/io.js";
import { startSocketServer } from "./helpers/socketHarness.js";
import { authedAgent } from "./helpers/authedAgent.js";
import { makeFriendship, makeGroupConversation, makeUser } from "./helpers/factories.js";

/**
 * `conversation:updated` phải mang góc nhìn của TỪNG người nhận.
 *
 * `broadcast()` trong groupService từng phát một payload duy nhất, serialize
 * KHÔNG kèm `viewerId`. Serializer khi đó trả `myRole: null`, `unreadCount: 0`,
 * `pinned: false` cho tất cả — và `upsertConversation` phía client thay nguyên
 * object, nên chỉ cần một thao tác nhóm bất kỳ (đổi tên, thêm thành viên) là mọi
 * thành viên, kể cả chủ nhóm, mất sạch vai trò và số chưa đọc cho tới khi F5.
 *
 * Đó cũng là lý do menu "..." trên tin nhắn nhóm rỗng ruột: `canDelete` đọc
 * `conversation.myRole`, và nó vừa bị null hoá.
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

/** Chờ đúng một `conversation:updated` trên một socket. */
const nextUpdate = (socket, { timeout = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("không nhận được conversation:updated")),
      timeout,
    );

    socket.once("conversation:updated", ({ conversation }) => {
      clearTimeout(timer);
      resolve(conversation);
    });
  });

const setup = async () => {
  const [owner, admin, member, invitee] = await Promise.all([
    makeUser({ displayName: "Chủ nhóm" }),
    makeUser({ displayName: "Quản trị" }),
    makeUser({ displayName: "Thành viên" }),
    makeUser({ displayName: "Được mời" }),
  ]);

  const group = await makeGroupConversation(owner, [
    { user: admin, role: ROLES.ADMIN },
    { user: member, role: ROLES.MEMBER },
  ]);

  await Promise.all([
    makeFriendship(owner, admin),
    makeFriendship(owner, member),
    makeFriendship(owner, invitee),
  ]);

  return { owner, admin, member, invitee, group };
};

describe("conversation:updated giữ đúng góc nhìn từng người", () => {
  it("đổi tên nhóm: mỗi người nhận đúng myRole của mình", async () => {
    const { owner, admin, member, group } = await setup();

    const [ownerSocket, adminSocket, memberSocket] = await Promise.all([
      harness.connect(owner),
      harness.connect(admin),
      harness.connect(member),
    ]);

    const updates = Promise.all([
      nextUpdate(ownerSocket),
      nextUpdate(adminSocket),
      nextUpdate(memberSocket),
    ]);

    await authedAgent(owner)
      .patch(`/api/conversations/${group._id}/group`)
      .send({ name: "Tên mới" })
      .expect(200);

    const [forOwner, forAdmin, forMember] = await updates;

    expect(forOwner.myRole).toBe(ROLES.OWNER);
    expect(forAdmin.myRole).toBe(ROLES.ADMIN);
    expect(forMember.myRole).toBe(ROLES.MEMBER);

    // Nội dung chung vẫn phải giống nhau ở mọi người nhận.
    expect(forOwner.group.name).toBe("Tên mới");
    expect(forMember.group.name).toBe("Tên mới");
  });

  it("thêm thành viên: chủ nhóm không bị mất quyền owner", async () => {
    const { owner, member, invitee, group } = await setup();

    const ownerSocket = await harness.connect(owner);
    const update = nextUpdate(ownerSocket);

    await authedAgent(owner)
      .post(`/api/conversations/${group._id}/members`)
      .send({ memberIds: [String(invitee._id)] })
      .expect(200);

    const forOwner = await update;

    expect(forOwner.myRole).toBe(ROLES.OWNER);
    expect(forOwner.participants).toHaveLength(4);

    // Và người vốn là member vẫn là member, không bị nâng cấp hay null hoá.
    expect(
      forOwner.participants.find((p) => p._id === String(member._id)).role,
    ).toBe(ROLES.MEMBER);
  });

  it("đổi vai trò: người được nâng lên admin thấy đúng myRole mới của mình", async () => {
    const { owner, member, group } = await setup();

    const memberSocket = await harness.connect(member);
    const update = nextUpdate(memberSocket);

    await authedAgent(owner)
      .patch(`/api/conversations/${group._id}/members/${member._id}/role`)
      .send({ role: ROLES.ADMIN })
      .expect(200);

    expect((await update).myRole).toBe(ROLES.ADMIN);
  });

  it("số chưa đọc của người nhận không bị xoá trắng bởi một thao tác nhóm", async () => {
    const { owner, member, group } = await setup();

    // Chủ nhóm nhắn hai tin — member chưa đọc tin nào.
    const agent = authedAgent(owner);
    await agent
      .post("/api/messages/group")
      .send({ conversationId: String(group._id), content: "một" })
      .expect(201);
    await agent
      .post("/api/messages/group")
      .send({ conversationId: String(group._id), content: "hai" })
      .expect(201);

    const memberSocket = await harness.connect(member);
    const update = nextUpdate(memberSocket);

    await agent
      .patch(`/api/conversations/${group._id}/group`)
      .send({ name: "Đổi tên trong lúc đang có tin chưa đọc" })
      .expect(200);

    // Trước đây payload dùng chung khiến giá trị này luôn về 0.
    expect((await update).unreadCount).toBe(2);
  });
});
