import { beforeEach, describe, expect, it } from "vitest";
import Conversation from "../src/models/Conversation.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { serializeConversation } from "../src/serializers/conversation.js";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeFriendship,
  makeGroupConversation,
  makeUser,
} from "./helpers/factories.js";

let ctx;

beforeEach(async () => {
  clearMembershipCache();

  const [alice, bob, outsider] = await Promise.all([
    makeUser({ displayName: "Alice" }),
    makeUser({ displayName: "Bob" }),
    makeUser({ displayName: "Người ngoài" }),
  ]);

  await makeFriendship(alice, bob);
  const convo = await makeDirectConversation(alice, bob);

  ctx = { alice, bob, outsider, convo };
});

const settings = (user, conversationId, body) =>
  authedAgent(user).patch(`/api/conversations/${conversationId}/settings`).send(body);

describe("ghim", () => {
  it("ghim rồi bỏ ghim", async () => {
    const pinned = await settings(ctx.alice, ctx.convo._id, { pinned: true });

    expect(pinned.status).toBe(200);
    expect(pinned.body.conversation.pinned).toBe(true);

    const unpinned = await settings(ctx.alice, ctx.convo._id, { pinned: false });

    expect(unpinned.body.conversation.pinned).toBe(false);
  });

  it("ghim hai lần không tạo hai entry trong pinnedBy", async () => {
    await settings(ctx.alice, ctx.convo._id, { pinned: true });
    await settings(ctx.alice, ctx.convo._id, { pinned: true });

    const stored = await Conversation.findById(ctx.convo._id).lean();

    expect(stored.pinnedBy).toHaveLength(1);
  });

  it("ghim là RIÊNG của từng người — người kia không thấy gì đổi", async () => {
    await settings(ctx.alice, ctx.convo._id, { pinned: true });

    const stored = await Conversation.findById(ctx.convo._id).lean();

    expect(serializeConversation(stored, { viewerId: ctx.alice._id }).pinned).toBe(true);
    expect(serializeConversation(stored, { viewerId: ctx.bob._id }).pinned).toBe(false);
  });
});

describe("lưu trữ", () => {
  it("lưu trữ rồi bỏ lưu trữ", async () => {
    const archived = await settings(ctx.alice, ctx.convo._id, { archived: true });

    expect(archived.body.conversation.archived).toBe(true);

    const restored = await settings(ctx.alice, ctx.convo._id, { archived: false });

    expect(restored.body.conversation.archived).toBe(false);
  });

  it("lưu trữ của một người không làm cuộc trò chuyện biến mất với người kia", async () => {
    await settings(ctx.alice, ctx.convo._id, { archived: true });

    const stored = await Conversation.findById(ctx.convo._id).lean();

    expect(serializeConversation(stored, { viewerId: ctx.bob._id }).archived).toBe(false);
  });
});

describe("tắt thông báo", () => {
  it("mutedUntil được đặt vào tương lai", async () => {
    const res = await settings(ctx.alice, ctx.convo._id, { muteMinutes: 60 });

    expect(res.status).toBe(200);

    const until = new Date(res.body.conversation.mutedUntil).getTime();

    expect(until).toBeGreaterThan(Date.now());
    // 60 phút, cho phép lệch vài giây do thời gian chạy test.
    expect(until).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
  });

  it("muteMinutes: null bật lại thông báo", async () => {
    await settings(ctx.alice, ctx.convo._id, { muteMinutes: 60 });
    const res = await settings(ctx.alice, ctx.convo._id, { muteMinutes: null });

    expect(res.body.conversation.mutedUntil).toBeNull();
  });

  it("mốc đã hết hạn được server lọc thành null, không để client tự so sánh", async () => {
    await Conversation.updateOne(
      { _id: ctx.convo._id, "participants.userId": ctx.alice._id },
      { $set: { "participants.$.mutedUntil": new Date(Date.now() - 60_000) } },
    );

    const stored = await Conversation.findById(ctx.convo._id).lean();

    expect(serializeConversation(stored, { viewerId: ctx.alice._id }).mutedUntil).toBeNull();
  });

  it("tắt thông báo chỉ chạm participant của chính người gọi", async () => {
    await settings(ctx.alice, ctx.convo._id, { muteMinutes: 60 });

    const stored = await Conversation.findById(ctx.convo._id).lean();

    const alice = stored.participants.find(
      (p) => String(p.userId) === String(ctx.alice._id),
    );
    const bob = stored.participants.find((p) => String(p.userId) === String(ctx.bob._id));

    expect(alice.mutedUntil).not.toBeNull();
    expect(bob.mutedUntil).toBeNull();
  });
});

describe("nhiều tuỳ chọn cùng lúc", () => {
  it("ghim và tắt thông báo trong một request", async () => {
    const res = await settings(ctx.alice, ctx.convo._id, {
      pinned: true,
      muteMinutes: 30,
    });

    expect(res.body.conversation.pinned).toBe(true);
    expect(res.body.conversation.mutedUntil).not.toBeNull();
  });

  it("chỉ gửi một field thì các field kia giữ nguyên", async () => {
    await settings(ctx.alice, ctx.convo._id, { pinned: true, archived: true });
    const res = await settings(ctx.alice, ctx.convo._id, { archived: false });

    expect(res.body.conversation.pinned).toBe(true);
    expect(res.body.conversation.archived).toBe(false);
  });
});

describe("quyền và validate", () => {
  it("người ngoài không đổi được tuỳ chọn của một conversation họ không tham gia", async () => {
    const res = await settings(ctx.outsider, ctx.convo._id, { pinned: true });

    expect(res.status).toBe(403);

    const stored = await Conversation.findById(ctx.convo._id).lean();
    expect(stored.pinnedBy ?? []).toHaveLength(0);
  });

  it("body rỗng bị từ chối", async () => {
    const res = await settings(ctx.alice, ctx.convo._id, {});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("muteMinutes âm bị từ chối", async () => {
    const res = await settings(ctx.alice, ctx.convo._id, { muteMinutes: -5 });

    expect(res.status).toBe(400);
  });

  it("thành viên thường của nhóm vẫn ghim được — không cần quyền quản trị", async () => {
    const group = await makeGroupConversation(ctx.alice, [ctx.bob]);

    const res = await settings(ctx.bob, group._id, { pinned: true });

    expect(res.status).toBe(200);
    expect(res.body.conversation.pinned).toBe(true);
  });
});
