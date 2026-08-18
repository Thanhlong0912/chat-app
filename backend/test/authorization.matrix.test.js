import { beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { anonAgent, authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeFriendship,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from "./helpers/factories.js";

/**
 * Ma trận phân quyền.
 *
 * Đây là lưới chắn cho bốn lỗ IDOR đã có trên production: đọc lịch sử tin nhắn
 * của conversation bất kỳ, mark-as-seen conversation bất kỳ, chèn tin nhắn vào
 * conversation bất kỳ, và subscribe socket vào conversation bất kỳ.
 *
 * Bảng hoá theo {endpoint} × {vai trò} để thêm endpoint mới ở Phase 6 chỉ là thêm
 * một dòng, và không ai vô tình bỏ sót một ô nào.
 */

// Ai thao tác. "outsider" là user hợp lệ nhưng không thuộc conversation.
const ACTORS = ["owner", "admin", "member", "outsider", "anon"];

let ctx;

beforeEach(async () => {
  clearMembershipCache();

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

  // Tin nhắn cuối do owner gửi, nên admin/member đi hết nhánh mark-as-seen.
  await makeMessage(group, owner, { content: "xin chào" });
  group.lastMessage = {
    _id: String((await makeMessage(group, owner, { content: "tin cuối" }))._id),
    content: "tin cuối",
    senderId: owner._id,
    createdAt: new Date(),
  };
  group.unreadCounts = new Map([
    [String(admin._id), 1],
    [String(member._id), 1],
  ]);
  await group.save();

  ctx = { owner, admin, member, outsider, group };
});

const agentFor = (actor) =>
  actor === "anon" ? anonAgent() : authedAgent(ctx[actor]);

/**
 * @typedef {{name: string, request: (agent, ctx) => import("supertest").Test,
 *            expected: Record<string, number>}} EndpointCase
 */
/** @type {EndpointCase[]} */
const CASES = [
  {
    name: "GET /conversations/:id/messages",
    request: (agent, { group }) => agent.get(`/api/conversations/${group._id}/messages`),
    // Lỗ #1: trước đây trả 200 cho outsider — đọc được toàn bộ lịch sử.
    expected: { owner: 200, admin: 200, member: 200, outsider: 403, anon: 401 },
  },
  {
    name: "PATCH /conversations/:id/seen",
    request: (agent, { group }) => agent.patch(`/api/conversations/${group._id}/seen`),
    // Lỗ #2: trước đây outsider tự thêm mình được vào `seenBy`.
    expected: { owner: 200, admin: 200, member: 200, outsider: 403, anon: 401 },
  },
  {
    name: "POST /messages/group",
    request: (agent, { group }) =>
      agent.post("/api/messages/group").send({ conversationId: group._id, content: "chào" }),
    expected: { owner: 201, admin: 201, member: 201, outsider: 403, anon: 401 },
  },
];

describe("ma trận phân quyền", () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      for (const actor of ACTORS) {
        const expected = testCase.expected[actor];

        it(`${actor} → ${expected}`, async () => {
          const res = await testCase.request(agentFor(actor), ctx);

          expect(res.status).toBe(expected);
        });
      }
    });
  }
});

describe("lỗ #1: đọc tin nhắn của conversation không thuộc về mình", () => {
  it("outsider nhận 403 với code NOT_A_MEMBER và không thấy nội dung nào", async () => {
    const res = await authedAgent(ctx.outsider)
      .get(`/api/conversations/${ctx.group._id}/messages`)
      .expect(403);

    expect(res.body.code).toBe("NOT_A_MEMBER");
    expect(res.body.messages).toBeUndefined();
    // Nội dung tin nhắn không được xuất hiện ở bất kỳ đâu trong response.
    expect(JSON.stringify(res.body)).not.toContain("tin cuối");
  });

  it("thành viên vẫn đọc được bình thường", async () => {
    const res = await authedAgent(ctx.member)
      .get(`/api/conversations/${ctx.group._id}/messages`)
      .expect(200);

    expect(res.body.messages.map((m) => m.content)).toContain("tin cuối");
  });
});

describe("lỗ #2: mark-as-seen conversation không thuộc về mình", () => {
  it("outsider không được thêm vào seenBy", async () => {
    await authedAgent(ctx.outsider)
      .patch(`/api/conversations/${ctx.group._id}/seen`)
      .expect(403);

    const { default: Conversation } = await import("../src/models/Conversation.js");
    const fresh = await Conversation.findById(ctx.group._id).lean();

    expect(fresh.seenBy.map(String)).not.toContain(String(ctx.outsider._id));
  });
});

describe("lỗ #3: chèn tin nhắn vào conversation không thuộc về mình", () => {
  it("từ chối conversationId của một group mà người gửi không tham gia", async () => {
    // Kẻ tấn công có một người bạn hợp lệ, nên `checkFriendship` sẽ cho qua —
    // đó chính là lý do lỗ này tồn tại.
    const attacker = ctx.outsider;
    const accomplice = await makeUser();
    await makeFriendship(attacker, accomplice);

    const res = await authedAgent(attacker)
      .post("/api/messages/direct")
      .send({
        recipientId: String(accomplice._id),
        conversationId: String(ctx.group._id),
        content: "tin nhắn chèn vào",
      })
      .expect(403);

    expect(res.body.code).toBe("NOT_A_MEMBER");

    const { default: Message } = await import("../src/models/Message.js");
    const injected = await Message.findOne({
      conversationId: ctx.group._id,
      content: "tin nhắn chèn vào",
    });

    expect(injected).toBeNull();
  });

  it("từ chối conversation direct của hai người khác", async () => {
    const [victimA, victimB] = await Promise.all([makeUser(), makeUser()]);
    const victimConvo = await makeDirectConversation(victimA, victimB);

    const attacker = ctx.outsider;
    const accomplice = await makeUser();
    await makeFriendship(attacker, accomplice);

    const res = await authedAgent(attacker)
      .post("/api/messages/direct")
      .send({
        recipientId: String(accomplice._id),
        conversationId: String(victimConvo._id),
        content: "xin chào người lạ",
      })
      .expect(403);

    expect(res.body.code).toBe("NOT_A_MEMBER");
  });

  it("từ chối khi recipientId không phải phía còn lại của conversation", async () => {
    // Người gửi *là* thành viên, nhưng recipientId trỏ tới người khác. Nếu âm
    // thầm rơi xuống nhánh tìm/tạo thì tin nhắn sẽ đến sai cuộc trò chuyện.
    const [alice, bob, carol] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const aliceBob = await makeDirectConversation(alice, bob);
    await makeFriendship(alice, carol);

    const res = await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(carol._id),
        conversationId: String(aliceBob._id),
        content: "gửi sai chỗ",
      })
      .expect(400);

    expect(res.body.code).toBe("RECIPIENT_MISMATCH");
  });

  it("vẫn cho phép gửi đúng vào conversation direct của mình", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);
    const convo = await makeDirectConversation(alice, bob);

    await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(bob._id),
        conversationId: String(convo._id),
        content: "tin nhắn hợp lệ",
      })
      .expect(201);
  });

  it("group message bị từ chối nếu conversation là direct", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/messages/group")
      .send({ conversationId: String(convo._id), content: "chào" })
      .expect(400);

    expect(res.body.code).toBe("WRONG_CONVERSATION_TYPE");
  });
});

describe("id không hợp lệ và không tồn tại", () => {
  it("id sai định dạng → 400, không phải 500", async () => {
    const res = await authedAgent(ctx.member)
      .get("/api/conversations/khong-phai-id/messages")
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.fields).toHaveProperty("conversationId");
  });

  it("id đúng định dạng nhưng không tồn tại → 404", async () => {
    const res = await authedAgent(ctx.member)
      .get("/api/conversations/507f1f77bcf86cd799439011/messages")
      .expect(404);

    expect(res.body.code).toBe("CONVERSATION_NOT_FOUND");
  });
});
