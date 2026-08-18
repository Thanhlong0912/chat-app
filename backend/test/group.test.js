import { beforeEach, describe, expect, it } from "vitest";
import Conversation from "../src/models/Conversation.js";
import Message from "../src/models/Message.js";
import { ROLES, findParticipant, getRole } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { clearAudienceCache } from "../src/services/audienceService.js";
import { anonAgent, authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeFriendship,
  makeGroupConversation,
  makeUser,
} from "./helpers/factories.js";

let ctx;

beforeEach(async () => {
  clearMembershipCache();
  clearAudienceCache();

  const [owner, admin, member, outsider] = await Promise.all([
    makeUser({ displayName: "Chủ nhóm" }),
    makeUser({ displayName: "Quản trị" }),
    makeUser({ displayName: "Thành viên" }),
    makeUser({ displayName: "Người ngoài" }),
  ]);

  const group = await makeGroupConversation(owner, [
    { user: admin, role: ROLES.ADMIN },
    { user: member, role: ROLES.MEMBER },
  ]);

  // Ai cũng là bạn của owner, để `checkFriendship` không chặn khi thêm thành viên.
  await Promise.all([
    makeFriendship(owner, admin),
    makeFriendship(owner, member),
    makeFriendship(owner, outsider),
    makeFriendship(admin, outsider),
  ]);

  ctx = { owner, admin, member, outsider, group };
});

const reload = (id = ctx.group._id) => Conversation.findById(id);
const roleOf = async (userId) => getRole(await reload(), userId);
const agentFor = (actor) => (actor === "anon" ? anonAgent() : authedAgent(ctx[actor]));

// ---------------------------------------------------------------------------
// Ma trận phân quyền cho các endpoint nhóm
// ---------------------------------------------------------------------------

const ACTORS = ["owner", "admin", "member", "outsider", "anon"];

const CASES = [
  {
    name: "GET /conversations/:id",
    request: (agent) => agent.get(`/api/conversations/${ctx.group._id}`),
    expected: { owner: 200, admin: 200, member: 200, outsider: 403, anon: 401 },
  },
  {
    name: "PATCH /:id/group (đổi tên)",
    request: (agent) =>
      agent.patch(`/api/conversations/${ctx.group._id}/group`).send({ name: "Tên mới" }),
    expected: { owner: 200, admin: 200, member: 403, outsider: 403, anon: 401 },
  },
  {
    name: "POST /:id/members",
    request: (agent) =>
      agent
        .post(`/api/conversations/${ctx.group._id}/members`)
        .send({ memberIds: [String(ctx.outsider._id)] }),
    expected: { owner: 200, admin: 200, member: 403, outsider: 403, anon: 401 },
  },
  {
    name: "PATCH /:id/members/:userId/role",
    request: (agent) =>
      agent
        .patch(`/api/conversations/${ctx.group._id}/members/${ctx.member._id}/role`)
        .send({ role: "admin" }),
    expected: { owner: 200, admin: 403, member: 403, outsider: 403, anon: 401 },
  },
  {
    name: "POST /:id/leave",
    request: (agent) => agent.post(`/api/conversations/${ctx.group._id}/leave`),
    // Owner rời được (quyền tự chuyển cho người khác).
    expected: { owner: 200, admin: 200, member: 200, outsider: 403, anon: 401 },
  },
  {
    name: "DELETE /:id",
    request: (agent) => agent.delete(`/api/conversations/${ctx.group._id}`),
    expected: { owner: 200, admin: 403, member: 403, outsider: 403, anon: 401 },
  },
];

describe("ma trận phân quyền nhóm", () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      for (const actor of ACTORS) {
        const expected = testCase.expected[actor];

        it(`${actor} → ${expected}`, async () => {
          const res = await testCase.request(agentFor(actor));
          expect(res.status).toBe(expected);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bất biến
// ---------------------------------------------------------------------------

describe("bất biến: luôn có đúng một owner", () => {
  it("owner rời nhóm thì quyền chuyển cho admin lâu năm nhất", async () => {
    await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/leave`)
      .expect(200);

    const fresh = await reload();

    // Nhóm không có owner thì không ai sửa được cài đặt nữa.
    expect(getRole(fresh, ctx.admin._id)).toBe(ROLES.OWNER);
    expect(findParticipant(fresh, ctx.owner._id)).toBeNull();
    expect(String(fresh.group.createdBy)).toBe(String(ctx.admin._id));
  });

  it("không có admin thì chuyển cho thành viên lâu năm nhất", async () => {
    const [owner, first, second] = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
    ]);
    const group = await makeGroupConversation(owner, [
      { user: first, role: ROLES.MEMBER },
      { user: second, role: ROLES.MEMBER },
    ]);

    // `first` tham gia trước.
    group.participants[1].joinedAt = new Date("2026-01-01");
    group.participants[2].joinedAt = new Date("2026-02-01");
    await group.save();

    await authedAgent(owner).post(`/api/conversations/${group._id}/leave`).expect(200);

    expect(getRole(await Conversation.findById(group._id), first._id)).toBe(ROLES.OWNER);
  });

  it("người cuối cùng rời thì nhóm và tin nhắn bị xoá", async () => {
    const solo = await makeUser();
    const group = await makeGroupConversation(solo);

    const res = await authedAgent(solo)
      .post(`/api/conversations/${group._id}/leave`)
      .expect(200);

    expect(res.body.deleted).toBe(true);
    expect(await Conversation.findById(group._id)).toBeNull();
    expect(await Message.countDocuments({ conversationId: group._id })).toBe(0);
  });

  it("chuyển quyền sở hữu hạ owner cũ xuống admin, không tạo hai owner", async () => {
    await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/transfer-ownership`)
      .send({ userId: String(ctx.member._id) })
      .expect(200);

    const fresh = await reload();
    const owners = fresh.participants.filter((p) => getRole(fresh, p) === ROLES.OWNER);

    expect(owners).toHaveLength(1);
    expect(getRole(fresh, ctx.member._id)).toBe(ROLES.OWNER);
    expect(getRole(fresh, ctx.owner._id)).toBe(ROLES.ADMIN);
  });

  it("không thể phong owner qua endpoint đổi vai trò", async () => {
    const res = await authedAgent(ctx.owner)
      .patch(`/api/conversations/${ctx.group._id}/members/${ctx.member._id}/role`)
      .send({ role: "owner" })
      .expect(200);

    // Được chuyển hướng sang luồng chuyển quyền sở hữu, vẫn giữ đúng một owner.
    const fresh = await reload();
    expect(fresh.participants.filter((p) => getRole(fresh, p) === ROLES.OWNER)).toHaveLength(1);
    expect(res.body.conversation).toBeDefined();
  });
});

describe("bất biến: xoá thành viên", () => {
  it("admin xoá được member thường", async () => {
    await authedAgent(ctx.admin)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.member._id}`)
      .expect(200);

    expect(findParticipant(await reload(), ctx.member._id)).toBeNull();
  });

  it("admin KHÔNG xoá được admin khác", async () => {
    const another = await makeUser();
    ctx.group.participants.push({ userId: another._id, role: ROLES.ADMIN });
    await ctx.group.save();
    clearMembershipCache();

    const res = await authedAgent(ctx.admin)
      .delete(`/api/conversations/${ctx.group._id}/members/${another._id}`)
      .expect(403);

    expect(res.body.code).toBe("INSUFFICIENT_ROLE");
    expect(findParticipant(await reload(), another._id)).not.toBeNull();
  });

  it("không ai xoá được owner", async () => {
    const res = await authedAgent(ctx.admin)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.owner._id}`)
      .expect(403);

    expect(res.body.code).toBe("INSUFFICIENT_ROLE");
    expect(await roleOf(ctx.owner._id)).toBe(ROLES.OWNER);
  });

  it("member thường không xoá được ai", async () => {
    await authedAgent(ctx.member)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.admin._id}`)
      .expect(403);
  });

  it("tự xoá mình bị từ chối, phải dùng rời nhóm", async () => {
    const res = await authedAgent(ctx.admin)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.admin._id}`)
      .expect(400);

    expect(res.body.code).toBe("USE_LEAVE_INSTEAD");
  });

  it("xoá người không ở trong nhóm → 404", async () => {
    await authedAgent(ctx.owner)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.outsider._id}`)
      .expect(404);
  });
});

describe("thêm thành viên", () => {
  it("thêm người mới thành công", async () => {
    const res = await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/members`)
      .send({ memberIds: [String(ctx.outsider._id)] })
      .expect(200);

    expect(res.body.added).toEqual([String(ctx.outsider._id)]);
    expect(findParticipant(await reload(), ctx.outsider._id)).not.toBeNull();
  });

  it("thêm người đã ở trong nhóm là no-op, không tạo participant trùng", async () => {
    const before = (await reload()).participants.length;

    const res = await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/members`)
      .send({ memberIds: [String(ctx.member._id)] })
      .expect(200);

    expect(res.body.added).toEqual([]);
    expect((await reload()).participants).toHaveLength(before);
  });

  it("chỉ thêm được bạn bè", async () => {
    const stranger = await makeUser();

    const res = await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/members`)
      .send({ memberIds: [String(stranger._id)] })
      .expect(403);

    expect(res.body.code).toBe("NOT_FRIENDS");
  });

  it("từ chối user không tồn tại", async () => {
    // Là bạn bè theo bản ghi Friend nhưng user đã bị xoá.
    const ghost = await makeUser();
    await makeFriendship(ctx.owner, ghost);
    const ghostId = String(ghost._id);
    await ghost.deleteOne();

    const res = await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/members`)
      .send({ memberIds: [ghostId] })
      .expect(400);

    expect(res.body.code).toBe("USER_NOT_FOUND");
  });
});

describe("thao tác nhóm không áp dụng cho chat 1-1", () => {
  it("đổi tên một conversation direct bị từ chối", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const direct = await makeDirectConversation(a, b);

    const res = await authedAgent(a)
      .patch(`/api/conversations/${direct._id}/group`)
      .send({ name: "Không hợp lệ" })
      .expect(400);

    expect(res.body.code).toBe("WRONG_CONVERSATION_TYPE");
  });

  it("rời một conversation direct bị từ chối", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const direct = await makeDirectConversation(a, b);

    await authedAgent(a).post(`/api/conversations/${direct._id}/leave`).expect(400);
  });
});

describe("tin nhắn hệ thống", () => {
  it("ghi lại việc đổi tên nhóm", async () => {
    await authedAgent(ctx.owner)
      .patch(`/api/conversations/${ctx.group._id}/group`)
      .send({ name: "Tên nhóm mới" })
      .expect(200);

    const systemMessages = await Message.find({
      conversationId: ctx.group._id,
      kind: "system",
    }).lean();

    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].systemEvent.type).toBe("group_renamed");
    expect(systemMessages[0].systemEvent.meta.to).toBe("Tên nhóm mới");
  });

  it("ghi lại việc thêm và xoá thành viên", async () => {
    await authedAgent(ctx.owner)
      .post(`/api/conversations/${ctx.group._id}/members`)
      .send({ memberIds: [String(ctx.outsider._id)] })
      .expect(200);

    await authedAgent(ctx.owner)
      .delete(`/api/conversations/${ctx.group._id}/members/${ctx.outsider._id}`)
      .expect(200);

    const types = (
      await Message.find({ conversationId: ctx.group._id, kind: "system" })
        .sort({ createdAt: 1 })
        .lean()
    ).map((m) => m.systemEvent.type);

    // Dấu vết kiểm toán nằm ngay trong luồng chat.
    expect(types).toEqual(["member_added", "member_removed"]);
  });

  it("đổi tên thành cùng giá trị cũ không tạo tin nhắn hệ thống", async () => {
    const currentName = ctx.group.group.name;

    await authedAgent(ctx.owner)
      .patch(`/api/conversations/${ctx.group._id}/group`)
      .send({ name: currentName })
      .expect(200);

    expect(
      await Message.countDocuments({ conversationId: ctx.group._id, kind: "system" }),
    ).toBe(0);
  });

  it("không lộ nội dung ở tin nhắn hệ thống", async () => {
    await authedAgent(ctx.owner)
      .patch(`/api/conversations/${ctx.group._id}/group`)
      .send({ name: "Nhóm X" })
      .expect(200);

    const res = await authedAgent(ctx.member)
      .get(`/api/conversations/${ctx.group._id}/messages`)
      .expect(200);

    const system = res.body.messages.find((m) => m.kind === "system");

    expect(system.content).toBeNull();
    expect(system.systemEvent.type).toBe("group_renamed");
  });
});

describe("xoá nhóm", () => {
  it("owner xoá được nhóm và toàn bộ tin nhắn", async () => {
    await authedAgent(ctx.owner)
      .delete(`/api/conversations/${ctx.group._id}`)
      .expect(200);

    expect(await Conversation.findById(ctx.group._id)).toBeNull();
    expect(await Message.countDocuments({ conversationId: ctx.group._id })).toBe(0);
  });
});

describe("tạo conversation", () => {
  it("loại chính mình khỏi memberIds thay vì tạo participant trùng", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({
        type: "group",
        name: "Nhóm thử",
        memberIds: [String(alice._id), String(bob._id)],
      })
      .expect(201);

    expect(res.body.conversation.participants).toHaveLength(2);
  });

  it("từ chối khi chỉ có chính mình", async () => {
    const alice = await makeUser();

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "Một mình", memberIds: [String(alice._id)] })
      .expect(400);

    expect(res.body.code).toBe("NO_OTHER_MEMBERS");
  });

  it("người tạo là owner của nhóm mới", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "Nhóm mới", memberIds: [String(bob._id)] })
      .expect(201);

    expect(await roleOf.call(null, alice._id)).toBeDefined();
    const convo = await Conversation.findById(res.body.conversation._id);
    expect(getRole(convo, alice._id)).toBe(ROLES.OWNER);
    expect(getRole(convo, bob._id)).toBe(ROLES.MEMBER);
  });
});
