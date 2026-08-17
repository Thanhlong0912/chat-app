import { describe, expect, it } from "vitest";
import mongoose from "mongoose";
import * as fixIndexes from "../scripts/migrations/001-fix-indexes.js";
import * as backfillRoles from "../scripts/migrations/002-backfill-roles.js";
import * as backfillLastRead from "../scripts/migrations/003-backfill-lastread.js";
import Conversation from "../src/models/Conversation.js";
import { findParticipant, getRole, ROLES } from "../src/domain/groupPermissions.js";
import { makeUser } from "./helpers/factories.js";

const indexNames = async (collectionName) => {
  const indexes = await mongoose.connection.db.collection(collectionName).indexes();
  return indexes.map((i) => i.name);
};

/** Dựng conversation ở đúng hình dạng dữ liệu cũ: không role, không lastReadAt. */
const makeLegacyGroup = async ({ creator, members, unreadCounts = {}, lastMessage }) => {
  const { insertedId } = await mongoose.connection.db.collection("conversations").insertOne({
    type: "group",
    participants: [creator, ...members].map((u, index) => ({
      userId: u._id,
      joinedAt: new Date(Date.now() - (10 - index) * 86_400_000),
    })),
    group: { name: "Nhóm cũ", createdBy: creator._id },
    lastMessage: lastMessage ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    unreadCounts,
    seenBy: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return insertedId;
};

describe("001-fix-indexes", () => {
  it("tạo index đúng cho participants.userId và drop index sai chính tả", async () => {
    const conversations = mongoose.connection.db.collection("conversations");

    // Dựng lại index sai chính tả mà production đang có.
    await conversations.createIndex({ "participant.userId": 1, lastMessageAt: -1 });
    expect(await indexNames("conversations")).toContain(
      "participant.userId_1_lastMessageAt_-1",
    );

    await fixIndexes.up();

    const names = await indexNames("conversations");
    expect(names).toContain("participants.userId_1_lastMessageAt_-1");
    expect(names).not.toContain("participant.userId_1_lastMessageAt_-1");
  });

  it("tạo partial unique index cho clientMessageId", async () => {
    await fixIndexes.up();

    const indexes = await mongoose.connection.db.collection("messages").indexes();
    const target = indexes.find((i) => i.name === "conversationId_1_clientMessageId_1");

    expect(target.unique).toBe(true);
    // Lọc theo $type nên document cũ (không có field) nằm ngoài index.
    expect(target.partialFilterExpression).toEqual({ clientMessageId: { $type: "string" } });
  });

  it("chạy lại lần hai không lỗi", async () => {
    await fixIndexes.up();
    await expect(fixIndexes.up()).resolves.not.toThrow();
  });

  it("chạy được trên database mà collection còn chưa tồn tại", async () => {
    // Trên một database thật, một collection chưa có document nào thì chưa tồn
    // tại, và dropIndex trả về NamespaceNotFound (26) chứ không phải
    // IndexNotFound (27). Không bắt mã đó thì migration dừng giữa đường và các
    // bước backfill phía sau không bao giờ chạy.
    await mongoose.connection.db.dropDatabase();

    await expect(fixIndexes.up()).resolves.not.toThrow();
  });

  it("không drop index không liên quan", async () => {
    const conversations = mongoose.connection.db.collection("conversations");
    await conversations.createIndex({ createdAt: -1 }, { name: "index_cua_nguoi_khac" });

    await fixIndexes.up();

    // Đây là lý do không dùng syncIndexes(): nó sẽ xoá index này.
    expect(await indexNames("conversations")).toContain("index_cua_nguoi_khac");
  });
});

describe("002-backfill-roles", () => {
  it("gán owner cho người tạo và member cho những người còn lại", async () => {
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const id = await makeLegacyGroup({ creator, members: [other] });

    await backfillRoles.up();

    const convo = await Conversation.findById(id);
    expect(findParticipant(convo, creator._id).role).toBe(ROLES.OWNER);
    expect(findParticipant(convo, other._id).role).toBe(ROLES.MEMBER);
  });

  it("chạy lại không thay đổi gì", async () => {
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const id = await makeLegacyGroup({ creator, members: [other] });

    await backfillRoles.up();
    const first = await Conversation.findById(id).lean();

    await backfillRoles.up();
    const second = await Conversation.findById(id).lean();

    expect(second.participants).toEqual(first.participants);
    expect(second.updatedAt).toEqual(first.updatedAt);
  });

  it("chọn người tham gia sớm nhất làm owner khi thiếu group.createdBy", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const { insertedId } = await mongoose.connection.db.collection("conversations").insertOne({
      type: "group",
      participants: [
        { userId: b._id, joinedAt: new Date("2026-02-01") },
        { userId: a._id, joinedAt: new Date("2026-01-01") },
      ],
      group: { name: "Không rõ người tạo" },
      unreadCounts: {},
    });

    await backfillRoles.up();

    const convo = await Conversation.findById(insertedId);
    // Một nhóm không có owner thì không ai sửa được cài đặt, nên phải có người nhận.
    expect(findParticipant(convo, a._id).role).toBe(ROLES.OWNER);
    expect(findParticipant(convo, b._id).role).toBe(ROLES.MEMBER);
  });

  it("ứng dụng đã đúng TRƯỚC khi backfill chạy", async () => {
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const id = await makeLegacyGroup({ creator, members: [other] });

    const convo = await Conversation.findById(id);

    // Đây là điều khiến thứ tự deploy không quan trọng.
    expect(getRole(convo, creator._id)).toBe(ROLES.OWNER);
    expect(getRole(convo, other._id)).toBe(ROLES.MEMBER);
  });
});

describe("003-backfill-lastread", () => {
  it("người có badge 0 được coi là đã đọc tới tin cuối", async () => {
    const [creator, caughtUp, behind] = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
    ]);

    const lastMessageAt = new Date("2026-04-01T12:00:00.000Z");
    const id = await makeLegacyGroup({
      creator,
      members: [caughtUp, behind],
      unreadCounts: { [String(caughtUp._id)]: 0, [String(behind._id)]: 7 },
      lastMessage: {
        _id: new mongoose.Types.ObjectId(),
        content: "tin cuối",
        senderId: creator._id,
        createdAt: lastMessageAt,
      },
    });

    await backfillLastRead.up();

    const convo = await Conversation.findById(id);

    expect(findParticipant(convo, caughtUp._id).lastReadAt.getTime()).toBe(
      lastMessageAt.getTime(),
    );
  });

  it("người còn tin chưa đọc lùi về joinedAt, KHÔNG phải null", async () => {
    const [creator, behind] = await Promise.all([makeUser(), makeUser()]);

    const id = await makeLegacyGroup({
      creator,
      members: [behind],
      unreadCounts: { [String(behind._id)]: 5 },
      lastMessage: {
        _id: new mongoose.Types.ObjectId(),
        content: "x",
        senderId: creator._id,
        createdAt: new Date("2026-04-01"),
      },
    });

    await backfillLastRead.up();

    const convo = await Conversation.findById(id);
    const participant = findParticipant(convo, behind._id);

    // null sẽ khiến toàn bộ lịch sử hiện lên như chưa đọc khi người dùng mở app.
    expect(participant.lastReadAt).not.toBeNull();
    expect(participant.lastReadAt.getTime()).toBe(participant.joinedAt.getTime());
  });

  it("người gửi tin cuối luôn được coi là đã đọc hết", async () => {
    const [creator, sender] = await Promise.all([makeUser(), makeUser()]);

    const lastMessageAt = new Date("2026-04-02T08:00:00.000Z");
    const id = await makeLegacyGroup({
      creator,
      members: [sender],
      // Badge nói còn 3 tin, nhưng chính họ vừa gửi tin cuối.
      unreadCounts: { [String(sender._id)]: 3 },
      lastMessage: {
        _id: new mongoose.Types.ObjectId(),
        content: "của tôi",
        senderId: sender._id,
        createdAt: lastMessageAt,
      },
    });

    await backfillLastRead.up();

    const convo = await Conversation.findById(id);
    expect(findParticipant(convo, sender._id).lastReadAt.getTime()).toBe(
      lastMessageAt.getTime(),
    );
  });

  it("chạy lại không thay đổi gì", async () => {
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const id = await makeLegacyGroup({
      creator,
      members: [other],
      unreadCounts: { [String(other._id)]: 2 },
      lastMessage: {
        _id: new mongoose.Types.ObjectId(),
        content: "x",
        senderId: creator._id,
        createdAt: new Date(),
      },
    });

    await backfillLastRead.up();
    const first = await Conversation.findById(id).lean();

    await backfillLastRead.up();
    const second = await Conversation.findById(id).lean();

    expect(second.participants).toEqual(first.participants);
  });

  it("conversation chưa có tin nhắn không bị hỏng", async () => {
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const id = await makeLegacyGroup({ creator, members: [other], lastMessage: null });

    await expect(backfillLastRead.up()).resolves.not.toThrow();

    const convo = await Conversation.findById(id);
    expect(convo.participants).toHaveLength(2);
  });
});
