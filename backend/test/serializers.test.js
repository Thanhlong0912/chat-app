import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import Conversation from "../src/models/Conversation.js";
import Message from "../src/models/Message.js";
import { serializeMessage } from "../src/serializers/message.js";
import { serializeConversation } from "../src/serializers/conversation.js";
import { ROLES } from "../src/domain/groupPermissions.js";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeGroupConversation,
  makeMessage,
  makeUser,
} from "./helpers/factories.js";

describe("serializeMessage — tương thích ngược", () => {
  it("bản ghi cũ chỉ có imgUrl được suy ra kind image và một attachment", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    // Hình dạng dữ liệu cũ: không có `kind`, không có `attachments`.
    const { insertedId } = await mongoose.connection.db.collection("messages").insertOne({
      conversationId: convo._id,
      senderId: alice._id,
      content: null,
      imgUrl: "https://cdn.example.com/anh.png",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const doc = await Message.findById(insertedId);
    const out = serializeMessage(doc);

    expect(out.kind).toBe("image");
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].url).toBe("https://cdn.example.com/anh.png");
  });

  it("bản ghi cũ chỉ có content được suy ra kind text", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const { insertedId } = await mongoose.connection.db.collection("messages").insertOne({
      conversationId: convo._id,
      senderId: alice._id,
      content: "chào",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const out = serializeMessage(await Message.findById(insertedId));

    expect(out.kind).toBe("text");
    expect(out.attachments).toEqual([]);
  });
});

describe("serializeMessage — tin nhắn đã xoá", () => {
  it("KHÔNG để nội dung tin nhắn đã xoá lên đường truyền", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const message = await makeMessage(convo, alice, {
      content: "nội dung bí mật",
      deletedAt: new Date(),
      deletedBy: alice._id,
    });

    const out = serializeMessage(message);

    expect(out.deleted).toBe(true);
    expect(out.content).toBeNull();
    // Đây là lý do dùng hàm tường minh chứ không phải toJSON transform: một query
    // `.lean()` sẽ bỏ qua transform, còn hàm này thì không bị bỏ qua.
    expect(JSON.stringify(out)).not.toContain("nội dung bí mật");
  });

  it("xoá cả attachments và replyTo của tin nhắn đã xoá", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const message = await makeMessage(convo, alice, {
      content: "có ảnh",
      attachments: [{ url: "https://cdn.example.com/riengtu.png", kind: "image" }],
      deletedAt: new Date(),
    });

    const out = serializeMessage(message);

    expect(out.attachments).toEqual([]);
    expect(out.replyTo).toBeNull();
    expect(JSON.stringify(out)).not.toContain("riengtu.png");
  });

  it("không lộ publicId của Cloudinary", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const message = await makeMessage(convo, alice, {
      kind: "image",
      attachments: [
        { url: "https://cdn.example.com/a.png", publicId: "moji_chat/noi_bo_123", kind: "image" },
      ],
    });

    const out = serializeMessage(message);

    expect(out.attachments[0].url).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain("noi_bo_123");
  });
});

describe("serializeMessage — isOwn", () => {
  it("đánh dấu tin nhắn của người đang xem", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);
    const message = await makeMessage(convo, alice);

    expect(serializeMessage(message, { viewerId: alice._id }).isOwn).toBe(true);
    expect(serializeMessage(message, { viewerId: bob._id }).isOwn).toBe(false);
  });
});

describe("serializeConversation — unreadCounts", () => {
  it("serialize Mongoose Map thành object, không phải {}", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    convo.unreadCounts = new Map([[String(alice._id), 5]]);
    await convo.save();

    const out = serializeConversation(await Conversation.findById(convo._id), {
      viewerId: alice._id,
    });

    // `{...doc.toObject()}` để lại một Map và JSON.stringify biến nó thành {}.
    expect(JSON.parse(JSON.stringify(out)).unreadCounts).toEqual({ [String(alice._id)]: 5 });
  });

  it("trả về unreadCount vô hướng cho người đang xem", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    convo.unreadCounts = new Map([[String(alice._id), 3]]);
    await convo.save();

    const fresh = await Conversation.findById(convo._id);

    // Client không phải tự tra Map bằng chính id của mình (và nhận undefined).
    expect(serializeConversation(fresh, { viewerId: alice._id }).unreadCount).toBe(3);
    expect(serializeConversation(fresh, { viewerId: bob._id }).unreadCount).toBe(0);
  });

  it("kèm myRole cho group", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [{ user: member, role: ROLES.MEMBER }]);

    const fresh = await Conversation.findById(group._id);

    expect(serializeConversation(fresh, { viewerId: owner._id }).myRole).toBe(ROLES.OWNER);
    expect(serializeConversation(fresh, { viewerId: member._id }).myRole).toBe(ROLES.MEMBER);
  });
});

describe("createConversation trả về unreadCounts", () => {
  it("không mất unreadCounts trong response", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const { makeFriendship } = await import("./helpers/factories.js");
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "direct", memberIds: [String(bob._id)] })
      .expect(201);

    // Trước đây field này luôn là {} vì Map bị JSON hoá mất.
    expect(res.body.conversation.unreadCounts).toBeDefined();
    expect(res.body.conversation.unreadCount).toBe(0);
  });
});

describe("GET /:id/messages/since", () => {
  it("chỉ trả tin nhắn mới hơn cursor", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);
    const agent = authedAgent(alice);

    const { makeMessagesAt } = await import("./helpers/factories.js");
    const base = Date.now();
    await makeMessagesAt(
      convo,
      bob,
      Array.from({ length: 5 }, (_, i) => new Date(base + i * 1000)),
    );

    // Lấy trang đầu để có cursor của tin mới nhất.
    const page = await agent
      .get(`/api/conversations/${convo._id}/messages?limit=2`)
      .expect(200);

    const newest = page.body.messages.at(-1);

    // Mô phỏng: mất kết nối, rồi có thêm tin nhắn.
    await makeMessagesAt(convo, bob, [new Date(base + 10_000)]);

    const since = await agent
      .get(`/api/conversations/${convo._id}/messages/since`)
      .query({ after: cursorFor(newest) })
      .expect(200);

    expect(since.body.messages.length).toBeGreaterThan(0);
    expect(since.body.truncated).toBe(false);
    // Mọi tin trả về phải mới hơn mốc đã biết.
    for (const m of since.body.messages) {
      expect(new Date(m.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(newest.createdAt).getTime(),
      );
    }
  });

  it("người ngoài bị chặn", async () => {
    const [alice, bob, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await authedAgent(outsider)
      .get(`/api/conversations/${convo._id}/messages/since`)
      .expect(403);
  });

  it("không có cursor thì trả từ đầu", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);
    await makeMessage(convo, bob, { content: "một" });

    const res = await authedAgent(alice)
      .get(`/api/conversations/${convo._id}/messages/since`)
      .expect(200);

    expect(res.body.messages).toHaveLength(1);
  });
});

/** Dựng cursor giống server: base64url của {t, i}. */
const cursorFor = (message) =>
  Buffer.from(
    JSON.stringify({ t: new Date(message.createdAt).toISOString(), i: message._id }),
    "utf8",
  ).toString("base64url");
