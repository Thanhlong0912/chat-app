import { describe, expect, it } from "vitest";
import Conversation from "../src/models/Conversation.js";
import { ROLES, findParticipant } from "../src/domain/groupPermissions.js";
import { advanceRead, readersOf } from "../src/services/readReceiptService.js";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeGroupConversation,
  makeMessage,
  makeMessagesAt,
  makeUser,
} from "./helpers/factories.js";

const reload = (id) => Conversation.findById(id);

const lastReadOf = async (conversationId, userId) => {
  const convo = await reload(conversationId);
  return findParticipant(convo, userId)?.lastReadAt ?? null;
};

describe("advanceRead", () => {
  it("đặt con trỏ tới tin nhắn cuối và tính lại số chưa đọc", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await makeMessagesAt(convo, bob, [
      new Date(Date.now() - 3000),
      new Date(Date.now() - 2000),
      new Date(Date.now() - 1000),
    ]);

    const result = await advanceRead({ conversation: convo, userId: alice._id });

    expect(result.advanced).toBe(true);
    expect(result.unreadCount).toBe(0);
    expect(await lastReadOf(convo._id, alice._id)).toBeInstanceOf(Date);
  });

  it("không đếm tin nhắn của chính mình là chưa đọc", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await makeMessage(convo, bob, { content: "của bob" });
    await advanceRead({ conversation: await reload(convo._id), userId: alice._id });

    // Alice gửi thêm hai tin của chính mình.
    await makeMessage(convo, alice, { content: "của alice 1" });
    await makeMessage(convo, alice, { content: "của alice 2" });

    const result = await advanceRead({
      conversation: await reload(convo._id),
      userId: alice._id,
    });

    expect(result.unreadCount).toBe(0);
  });

  it("đếm đúng số tin chưa đọc khi chỉ đọc tới giữa", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const base = Date.now();
    const messages = await makeMessagesAt(
      convo,
      bob,
      Array.from({ length: 5 }, (_, i) => new Date(base + i * 1000)),
    );

    const result = await advanceRead({
      conversation: convo,
      userId: alice._id,
      lastReadMessageId: messages[1]._id,
    });

    // Đọc tới tin thứ 2 trong 5 → còn 3 tin chưa đọc.
    expect(result.unreadCount).toBe(3);
  });

  it("chỉ tiến, không bao giờ lùi", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const base = Date.now();
    const messages = await makeMessagesAt(
      convo,
      bob,
      Array.from({ length: 3 }, (_, i) => new Date(base + i * 1000)),
    );

    // Đọc hết.
    await advanceRead({ conversation: await reload(convo._id), userId: alice._id });
    const after = await lastReadOf(convo._id, alice._id);

    // Một gói tin đến muộn từ tab cũ, trỏ về tin nhắn đầu tiên.
    const result = await advanceRead({
      conversation: await reload(convo._id),
      userId: alice._id,
      lastReadMessageId: messages[0]._id,
    });

    expect(result.advanced).toBe(false);
    expect((await lastReadOf(convo._id, alice._id)).getTime()).toBe(after.getTime());
  });

  it("bỏ qua timestamp do client cung cấp, chỉ dùng mốc trong DB", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const realTime = new Date("2026-03-01T10:00:00.000Z");
    const [message] = await makeMessagesAt(convo, bob, [realTime]);

    const result = await advanceRead({
      conversation: convo,
      userId: alice._id,
      lastReadMessageId: message._id,
      // Nếu hàm tin vào giá trị này thì một đồng hồ lệch sẽ đánh dấu đã đọc cả
      // những tin nhắn trong tương lai.
      lastReadAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(result.lastReadAt.getTime()).toBe(realTime.getTime());
  });

  it("từ chối lastReadMessageId thuộc conversation khác", async () => {
    const [alice, bob, carol] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const mine = await makeDirectConversation(alice, bob);
    const other = await makeDirectConversation(bob, carol);

    const foreign = await makeMessage(other, carol, { content: "bí mật" });

    await expect(
      advanceRead({ conversation: mine, userId: alice._id, lastReadMessageId: foreign._id }),
    ).rejects.toMatchObject({ code: "MESSAGE_NOT_IN_CONVERSATION" });
  });

  it("conversation chưa có tin nhắn thì không lỗi", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const result = await advanceRead({ conversation: convo, userId: alice._id });

    expect(result.advanced).toBe(false);
    expect(result.unreadCount).toBe(0);
  });

  it("không đếm tin nhắn đã xoá", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await makeMessage(convo, bob, { content: "còn đây" });
    await makeMessage(convo, bob, { content: "đã xoá", deletedAt: new Date() });

    const result = await advanceRead({
      conversation: convo,
      userId: alice._id,
      lastReadMessageId: (await makeMessage(convo, alice, { content: "mốc" }))._id,
    });

    expect(result.unreadCount).toBe(0);
  });

  it("mỗi thành viên nhóm có con trỏ riêng", async () => {
    const [owner, a, b] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [
      { user: a, role: ROLES.MEMBER },
      { user: b, role: ROLES.MEMBER },
    ]);

    const base = Date.now();
    const messages = await makeMessagesAt(
      group,
      owner,
      Array.from({ length: 4 }, (_, i) => new Date(base + i * 1000)),
    );

    await advanceRead({ conversation: await reload(group._id), userId: a._id });
    await advanceRead({
      conversation: await reload(group._id),
      userId: b._id,
      lastReadMessageId: messages[1]._id,
    });

    const fresh = await reload(group._id);

    expect(findParticipant(fresh, a._id).lastReadAt.getTime()).toBe(
      messages[3].createdAt.getTime(),
    );
    expect(findParticipant(fresh, b._id).lastReadAt.getTime()).toBe(
      messages[1].createdAt.getTime(),
    );
  });
});

describe("readersOf — read receipt từng tin nhắn suy ra từ con trỏ", () => {
  it("chỉ tính người có con trỏ ở hoặc sau tin nhắn", async () => {
    const [owner, a, b] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [
      { user: a, role: ROLES.MEMBER },
      { user: b, role: ROLES.MEMBER },
    ]);

    const base = Date.now();
    const messages = await makeMessagesAt(
      group,
      owner,
      Array.from({ length: 3 }, (_, i) => new Date(base + i * 1000)),
    );

    // a đọc hết, b chỉ đọc tin đầu.
    await advanceRead({ conversation: await reload(group._id), userId: a._id });
    await advanceRead({
      conversation: await reload(group._id),
      userId: b._id,
      lastReadMessageId: messages[0]._id,
    });

    const fresh = await reload(group._id);

    // Tin đầu: cả hai đã đọc.
    expect(readersOf(fresh, messages[0]).sort()).toEqual(
      [String(a._id), String(b._id)].sort(),
    );
    // Tin cuối: chỉ a.
    expect(readersOf(fresh, messages[2])).toEqual([String(a._id)]);
  });

  it("không tính người gửi là người đã đọc", async () => {
    const [owner, a] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [{ user: a, role: ROLES.MEMBER }]);

    const [message] = await makeMessagesAt(group, owner, [new Date()]);

    await advanceRead({ conversation: await reload(group._id), userId: owner._id });
    await advanceRead({ conversation: await reload(group._id), userId: a._id });

    expect(readersOf(await reload(group._id), message)).toEqual([String(a._id)]);
  });
});

describe("PATCH /:id/seen", () => {
  it("cập nhật con trỏ và trả về số chưa đọc", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);
    await makeMessage(convo, bob, { content: "chào" });

    const res = await authedAgent(alice)
      .patch(`/api/conversations/${convo._id}/seen`)
      .expect(200);

    expect(res.body.myUnreadCount).toBe(0);
    expect(res.body.lastReadAt).toBeTruthy();
  });

  it("nhận lastReadMessageId để đánh dấu đọc tới giữa", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const base = Date.now();
    const messages = await makeMessagesAt(
      convo,
      bob,
      Array.from({ length: 4 }, (_, i) => new Date(base + i * 1000)),
    );

    const res = await authedAgent(alice)
      .patch(`/api/conversations/${convo._id}/seen`)
      .send({ lastReadMessageId: String(messages[1]._id) })
      .expect(200);

    expect(res.body.myUnreadCount).toBe(2);
  });

  it("người ngoài vẫn bị chặn", async () => {
    const [alice, bob, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await authedAgent(outsider)
      .patch(`/api/conversations/${convo._id}/seen`)
      .expect(403);
  });
});
