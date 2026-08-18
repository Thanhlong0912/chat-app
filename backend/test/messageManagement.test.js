import { beforeEach, describe, expect, it } from "vitest";
import Conversation from "../src/models/Conversation.js";
import Message from "../src/models/Message.js";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
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

  ctx = { alice, bob, outsider, convo };
});

const send = (user, conversationId, body = {}) =>
  authedAgent(user)
    .post("/api/messages/direct")
    .send({
      recipientId: String(ctx.bob._id),
      conversationId: String(conversationId),
      content: "xin chào",
      ...body,
    });

describe("trả lời tin nhắn", () => {
  it("lưu ảnh chụp nội dung của tin nhắn gốc", async () => {
    const parent = await makeMessage(ctx.convo, ctx.bob, { content: "tin nhắn gốc" });

    const res = await send(ctx.alice, ctx.convo._id, {
      content: "đang trả lời",
      replyToMessageId: String(parent._id),
    }).expect(201);

    expect(res.body.message.replyTo).toMatchObject({
      messageId: String(parent._id),
      contentSnapshot: "tin nhắn gốc",
    });
  });

  it("cắt ảnh chụp ở 140 ký tự", async () => {
    const parent = await makeMessage(ctx.convo, ctx.bob, { content: "a".repeat(300) });

    const res = await send(ctx.alice, ctx.convo._id, {
      replyToMessageId: String(parent._id),
    }).expect(201);

    expect(res.body.message.replyTo.contentSnapshot).toHaveLength(140);
  });

  it("TỪ CHỐI trả lời một tin nhắn ở conversation khác", async () => {
    const [carol, dave] = await Promise.all([makeUser(), makeUser()]);
    const otherConvo = await makeDirectConversation(carol, dave);
    const secret = await makeMessage(otherConvo, carol, { content: "nội dung riêng tư" });

    const res = await send(ctx.alice, ctx.convo._id, {
      replyToMessageId: String(secret._id),
    }).expect(400);

    // Không chặn thì reply trở thành đường rút 140 ký tự nội dung từ một
    // conversation mà người gửi không có quyền đọc.
    expect(res.body.code).toBe("REPLY_TARGET_NOT_IN_CONVERSATION");
    expect(JSON.stringify(res.body)).not.toContain("nội dung riêng tư");
  });

  it("không trích nội dung của tin nhắn gốc đã bị xoá", async () => {
    const parent = await makeMessage(ctx.convo, ctx.bob, {
      content: "đã xoá rồi",
      deletedAt: new Date(),
    });

    const res = await send(ctx.alice, ctx.convo._id, {
      replyToMessageId: String(parent._id),
    }).expect(201);

    expect(res.body.message.replyTo.contentSnapshot).toBeNull();
  });
});

describe("sửa tin nhắn", () => {
  it("người gửi sửa được và có dấu editedAt", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "bản gốc" });

    const res = await authedAgent(ctx.alice)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "đã sửa" })
      .expect(200);

    expect(res.body.message.content).toBe("đã sửa");
    expect(res.body.message.editedAt).toBeTruthy();
  });

  it("người KHÁC không sửa được", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "của alice" });

    const res = await authedAgent(ctx.bob)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "bob sửa trộm" })
      .expect(403);

    expect(res.body.code).toBe("NOT_MESSAGE_SENDER");
  });

  it("người ngoài conversation không sửa được, và nhận 403 chứ không phải 404", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice);

    // Chỉ biết messageId là không đủ.
    await authedAgent(ctx.outsider)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "chen vào" })
      .expect(403);
  });

  it("quá cửa sổ 15 phút thì từ chối", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "cũ rồi" });

    // Qua driver gốc: Mongoose đặt `createdAt` là immutable khi bật timestamps,
    // nên `Model.updateOne({$set: {createdAt}})` bị bỏ qua trong im lặng.
    await Message.collection.updateOne(
      { _id: message._id },
      { $set: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } },
    );

    const res = await authedAgent(ctx.alice)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "sửa muộn" })
      .expect(400);

    expect(res.body.code).toBe("EDIT_WINDOW_EXPIRED");
  });

  it("không sửa được tin nhắn ảnh", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, {
      kind: "image",
      attachments: [{ url: "https://cdn.example.com/a.png", kind: "image" }],
    });

    const res = await authedAgent(ctx.alice)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "đổi thành chữ" })
      .expect(400);

    expect(res.body.code).toBe("NOT_EDITABLE");
  });

  it("không sửa được tin nhắn đã xoá", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { deletedAt: new Date() });

    await authedAgent(ctx.alice)
      .patch(`/api/messages/${message._id}`)
      .send({ content: "hồi sinh" })
      .expect(400);
  });

  it("cập nhật cả phần xem trước ở sidebar nếu là tin nhắn cuối", async () => {
    const res = await send(ctx.alice, ctx.convo._id, { content: "tin cuối" }).expect(201);

    await authedAgent(ctx.alice)
      .patch(`/api/messages/${res.body.message._id}`)
      .send({ content: "tin cuối đã sửa" })
      .expect(200);

    const fresh = await Conversation.findById(ctx.convo._id).lean();
    expect(fresh.lastMessage.content).toBe("tin cuối đã sửa");
  });
});

describe("xoá tin nhắn", () => {
  it("người gửi xoá được, và nội dung KHÔNG còn trên đường truyền", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "bí mật cần xoá" });

    const res = await authedAgent(ctx.alice)
      .delete(`/api/messages/${message._id}`)
      .expect(200);

    expect(res.body.message.deleted).toBe(true);
    expect(res.body.message.content).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("bí mật cần xoá");
  });

  it("nội dung đã xoá không xuất hiện khi tải lại lịch sử", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "bí mật cần xoá" });

    await authedAgent(ctx.alice).delete(`/api/messages/${message._id}`).expect(200);

    const res = await authedAgent(ctx.bob)
      .get(`/api/conversations/${ctx.convo._id}/messages`)
      .expect(200);

    // Đây mới là điều quan trọng: kiểm tra trên WIRE, không phải cờ trong DB.
    expect(JSON.stringify(res.body)).not.toContain("bí mật cần xoá");
    expect(res.body.messages[0].deleted).toBe(true);
  });

  it("giữ lại bản ghi làm bia mộ, không xoá hẳn khỏi DB", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "x" });

    await authedAgent(ctx.alice).delete(`/api/messages/${message._id}`).expect(200);

    // Xoá hẳn sẽ làm chuỗi trả lời bị hổng.
    const stored = await Message.findById(message._id).lean();
    expect(stored).not.toBeNull();
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect(stored.deletedBy).toBeTruthy();
  });

  it("người khác trong chat 1-1 KHÔNG xoá được", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice, { content: "của alice" });

    const res = await authedAgent(ctx.bob)
      .delete(`/api/messages/${message._id}`)
      .expect(403);

    expect(res.body.code).toBe("CANNOT_DELETE_MESSAGE");
  });

  it("quản trị nhóm xoá được tin của người khác", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [{ user: member, role: ROLES.MEMBER }]);
    const message = await makeMessage(group, member, { content: "của thành viên" });

    await authedAgent(owner).delete(`/api/messages/${message._id}`).expect(200);

    expect((await Message.findById(message._id)).deletedAt).toBeInstanceOf(Date);
  });

  it("thành viên thường không xoá được tin của người khác trong nhóm", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [{ user: member, role: ROLES.MEMBER }]);
    const message = await makeMessage(group, owner, { content: "của chủ nhóm" });

    await authedAgent(member).delete(`/api/messages/${message._id}`).expect(403);
  });

  it("xoá lại lần nữa là no-op, không phải lỗi", async () => {
    const message = await makeMessage(ctx.convo, ctx.alice);

    await authedAgent(ctx.alice).delete(`/api/messages/${message._id}`).expect(200);
    // Client có thể retry sau khi mất kết nối.
    await authedAgent(ctx.alice).delete(`/api/messages/${message._id}`).expect(200);
  });

  it("tính lại phần xem trước khi tin nhắn cuối bị xoá", async () => {
    await send(ctx.alice, ctx.convo._id, { content: "tin trước" }).expect(201);
    const last = await send(ctx.alice, ctx.convo._id, { content: "tin cuối" }).expect(201);

    await authedAgent(ctx.alice)
      .delete(`/api/messages/${last.body.message._id}`)
      .expect(200);

    const fresh = await Conversation.findById(ctx.convo._id).lean();

    // Không tính lại thì sidebar vẫn hiển thị nội dung vừa bị xoá.
    expect(fresh.lastMessage.content).toBe("tin trước");
  });

  it("conversation chỉ có một tin nhắn thì lastMessage thành null", async () => {
    const only = await send(ctx.alice, ctx.convo._id, { content: "duy nhất" }).expect(201);

    await authedAgent(ctx.alice)
      .delete(`/api/messages/${only.body.message._id}`)
      .expect(200);

    const fresh = await Conversation.findById(ctx.convo._id).lean();
    expect(fresh.lastMessage).toBeNull();
  });

  it("id không tồn tại → 404", async () => {
    await authedAgent(ctx.alice)
      .delete("/api/messages/507f1f77bcf86cd799439011")
      .expect(404);
  });
});

describe("tải tệp đính kèm", () => {
  it("từ chối tệp không phải ảnh", async () => {
    const res = await authedAgent(ctx.alice)
      .post(`/api/conversations/${ctx.convo._id}/attachments`)
      .attach("file", Buffer.from("không phải ảnh"), {
        filename: "tailieu.pdf",
        contentType: "application/pdf",
      })
      .expect(400);

    expect(res.body.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("từ chối tệp vượt quá 8MB", async () => {
    const res = await authedAgent(ctx.alice)
      .post(`/api/conversations/${ctx.convo._id}/attachments`)
      .attach("file", Buffer.alloc(9 * 1024 * 1024), {
        filename: "qualon.png",
        contentType: "image/png",
      })
      .expect(413);

    expect(res.body.code).toBe("UPLOAD_LIMIT_FILE_SIZE");
  });

  it("người ngoài không tải lên được", async () => {
    await authedAgent(ctx.outsider)
      .post(`/api/conversations/${ctx.convo._id}/attachments`)
      .attach("file", Buffer.alloc(10), { filename: "a.png", contentType: "image/png" })
      .expect(403);
  });

  it("thiếu tệp → 400", async () => {
    const res = await authedAgent(ctx.alice)
      .post(`/api/conversations/${ctx.convo._id}/attachments`)
      .expect(400);

    expect(res.body.code).toBe("NO_FILE");
  });
});
