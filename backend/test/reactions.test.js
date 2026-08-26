import { beforeEach, describe, expect, it } from "vitest";
import Message from "../src/models/Message.js";
import { MAX_REACTIONS_PER_MESSAGE } from "../src/models/Message.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { toggleReaction } from "../src/services/messageService.js";
import { serializeMessage } from "../src/serializers/message.js";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeFriendship,
  makeGroupConversation,
  makeMessage,
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
  const message = await makeMessage(convo, alice, { content: "xin chào" });

  ctx = { alice, bob, outsider, convo, message };
});

const react = (user, messageId, emoji) =>
  authedAgent(user).put(`/api/messages/${messageId}/reactions`).send({ emoji });

describe("thả biểu cảm", () => {
  it("thả rồi gỡ lại chính emoji đó — cùng một endpoint", async () => {
    const first = await react(ctx.bob, ctx.message._id, "👍");

    expect(first.status).toBe(200);
    expect(first.body.active).toBe(true);
    expect(first.body.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);

    const second = await react(ctx.bob, ctx.message._id, "👍");

    expect(second.status).toBe(200);
    expect(second.body.active).toBe(false);
    // Nhóm rỗng phải biến mất hẳn, không phải còn lại `count: 0`.
    expect(second.body.reactions).toEqual([]);
  });

  it("nhiều người cùng thả một emoji thì cộng dồn vào một nhóm", async () => {
    await react(ctx.alice, ctx.message._id, "❤️");
    const res = await react(ctx.bob, ctx.message._id, "❤️");

    expect(res.body.reactions).toEqual([
      { emoji: "❤️", count: 2, reactedByMe: true },
    ]);
  });

  it("một người thả được nhiều emoji khác nhau trên cùng tin nhắn", async () => {
    await react(ctx.bob, ctx.message._id, "👍");
    const res = await react(ctx.bob, ctx.message._id, "😂");

    expect(res.body.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
      { emoji: "😂", count: 1, reactedByMe: true },
    ]);
  });

  it("thả hai lần liên tiếp cùng emoji không tạo hai entry", async () => {
    await react(ctx.bob, ctx.message._id, "👍");
    await react(ctx.bob, ctx.message._id, "👍"); // gỡ
    await react(ctx.bob, ctx.message._id, "👍"); // thả lại

    const stored = await Message.findById(ctx.message._id).lean();

    expect(stored.reactions).toHaveLength(1);
  });
});

describe("quyền", () => {
  it("người ngoài conversation không thả được — 403, không phải 404", async () => {
    const res = await react(ctx.outsider, ctx.message._id, "👍");

    expect(res.status).toBe(403);

    const stored = await Message.findById(ctx.message._id).lean();
    expect(stored.reactions ?? []).toHaveLength(0);
  });

  it("thành viên nhóm thả được lên tin nhắn của người khác", async () => {
    const group = await makeGroupConversation(ctx.alice, [ctx.bob]);
    const message = await makeMessage(group, ctx.alice);

    const res = await react(ctx.bob, message._id, "🙏");

    expect(res.status).toBe(200);
    expect(res.body.reactions).toEqual([{ emoji: "🙏", count: 1, reactedByMe: true }]);
  });

  it("chưa đăng nhập thì 401", async () => {
    const res = await authedAgent(ctx.outsider)
      .put(`/api/messages/${ctx.message._id}/reactions`)
      .set("Authorization", "")
      .send({ emoji: "👍" });

    expect(res.status).toBe(401);
  });
});

describe("validate", () => {
  it("emoji ngoài bộ cố định bị từ chối", async () => {
    const res = await react(ctx.bob, ctx.message._id, "🚀");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("chuỗi tuỳ ý không phải emoji cũng bị từ chối", async () => {
    const res = await react(ctx.bob, ctx.message._id, "một chuỗi bất kỳ");

    expect(res.status).toBe(400);
  });

  it("messageId sai định dạng → 400 INVALID_ID chứ không phải CastError 500", async () => {
    const res = await react(ctx.bob, "không-phải-objectid", "👍");

    expect(res.status).toBe(400);
  });
});

describe("tin nhắn đã xoá", () => {
  it("không thả được biểu cảm lên tin nhắn đã xoá", async () => {
    await Message.updateOne(
      { _id: ctx.message._id },
      { $set: { deletedAt: new Date(), content: null } },
    );

    const res = await react(ctx.bob, ctx.message._id, "👍");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MESSAGE_DELETED");
  });

  it("biểu cảm không lọt ra ngoài qua serializer khi tin nhắn bị xoá sau đó", async () => {
    await react(ctx.bob, ctx.message._id, "👍");

    await Message.updateOne({ _id: ctx.message._id }, { $set: { deletedAt: new Date() } });

    const stored = await Message.findById(ctx.message._id);
    const serialized = serializeMessage(stored, { viewerId: ctx.bob._id });

    expect(serialized.reactions).toEqual([]);
    expect(serialized.content).toBeNull();
  });
});

describe("trần số biểu cảm", () => {
  it("vượt trần thì bị từ chối thay vì để document phình vô hạn", async () => {
    // Đổ đầy tới sát trần bằng ghi thẳng, nhanh hơn nhiều so với gọi API.
    const filler = Array.from({ length: MAX_REACTIONS_PER_MESSAGE }, () => ({
      emoji: "😮",
      userId: ctx.alice._id,
      createdAt: new Date(),
    }));

    await Message.updateOne(
      { _id: ctx.message._id },
      { $set: { reactions: filler } },
    );

    await expect(
      toggleReaction({ messageId: ctx.message._id, actor: ctx.bob, emoji: "👍" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REACTIONS" });
  });
});

describe("serializer", () => {
  it("reactedByMe đúng theo từng người xem, không dùng chung", async () => {
    await react(ctx.bob, ctx.message._id, "👍");

    const stored = await Message.findById(ctx.message._id);

    expect(serializeMessage(stored, { viewerId: ctx.bob._id }).reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);

    expect(serializeMessage(stored, { viewerId: ctx.alice._id }).reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: false },
    ]);
  });

  it("tin nhắn cũ không có field reactions trả về mảng rỗng, không phải undefined", async () => {
    const stored = await Message.findById(ctx.message._id);

    expect(serializeMessage(stored, { viewerId: ctx.alice._id }).reactions).toEqual([]);
  });
});

describe("đường đọc chính", () => {
  it("biểu cảm có mặt khi tải lại trang tin nhắn, đúng góc nhìn từng người", async () => {
    await react(ctx.bob, ctx.message._id, "👍");

    const asBob = await authedAgent(ctx.bob).get(
      `/api/conversations/${ctx.convo._id}/messages`,
    );
    const asAlice = await authedAgent(ctx.alice).get(
      `/api/conversations/${ctx.convo._id}/messages`,
    );

    const bobView = asBob.body.messages.find((m) => m._id === String(ctx.message._id));
    const aliceView = asAlice.body.messages.find((m) => m._id === String(ctx.message._id));

    expect(bobView.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
    expect(aliceView.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: false }]);
  });
});
