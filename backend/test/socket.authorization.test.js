import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { setIo, resetIo } from "../src/socket/io.js";
import { emitNewMessage } from "../src/utils/messageHelper.js";
import {
  collectEvents,
  emitExpectingNoAck,
  emitWithAck,
  startSocketServer,
} from "./helpers/socketHarness.js";
import { signAccessToken } from "./helpers/authedAgent.js";
import { makeGroupConversation, makeMessage, makeUser } from "./helpers/factories.js";

let harness;

beforeAll(async () => {
  harness = await startSocketServer();
  setIo(harness.ioServer);
});

afterAll(async () => {
  await harness.close();
  resetIo();
});

beforeEach(() => clearMembershipCache());

describe("xác thực khi kết nối socket", () => {
  it("từ chối kết nối không có token", async () => {
    const { message, code } = await harness.connectExpectingFailure(null);

    expect(code).toBe("NO_ACCESS_TOKEN");
    expect(message).toMatch(/Token không tồn tại/);
  });

  it("từ chối token sai chữ ký với code TOKEN_INVALID", async () => {
    const { message, code } = await harness.connectExpectingFailure("khong-phai-jwt");

    expect(code).toBe("TOKEN_INVALID");
    expect(message).toBeTruthy();
  });

  it("từ chối token hết hạn với code TOKEN_EXPIRED", async () => {
    const user = await makeUser();
    const expired = signAccessToken(user, { expiresIn: "-1s" });

    const { code } = await harness.connectExpectingFailure(expired);

    // Client dựa vào code này để refresh rồi kết nối lại, thay vì đăng xuất.
    expect(code).toBe("TOKEN_EXPIRED");
  });

  it("chấp nhận token hợp lệ", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    expect(socket.connected).toBe(true);
  });
});

describe("lỗ #4: conversation:subscribe không kiểm tra quyền", () => {
  it("từ chối người ngoài với code NOT_A_MEMBER", async () => {
    const [owner, outsider] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner);

    const socket = await harness.connect(outsider);
    const ack = await emitWithAck(socket, "conversation:subscribe", {
      conversationId: String(group._id),
    });

    expect(ack).toEqual({ ok: false, code: "NOT_A_MEMBER" });
  });

  it("cho phép thành viên subscribe", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    const socket = await harness.connect(member);
    const ack = await emitWithAck(socket, "conversation:subscribe", {
      conversationId: String(group._id),
    });

    expect(ack).toEqual({ ok: true });
  });

  it("người ngoài đã cố subscribe vẫn KHÔNG nhận được tin nhắn của nhóm", async () => {
    const [owner, member, outsider] = await Promise.all([
      makeUser(),
      makeUser(),
      makeUser(),
    ]);
    const group = await makeGroupConversation(owner, [{ user: member, role: ROLES.MEMBER }]);

    const memberSocket = await harness.connect(member);
    const outsiderSocket = await harness.connect(outsider);

    // Thành viên vào room hợp lệ; người ngoài cố vào và bị từ chối.
    await emitWithAck(memberSocket, "conversation:subscribe", {
      conversationId: String(group._id),
    });
    await emitWithAck(outsiderSocket, "conversation:subscribe", {
      conversationId: String(group._id),
    });

    const memberInbox = collectEvents(memberSocket, "message:new");
    const outsiderInbox = collectEvents(outsiderSocket, "message:new");

    const message = await makeMessage(group, owner, { content: "bí mật của nhóm" });
    emitNewMessage(harness.ioServer, group, message);

    const [memberEvents, outsiderEvents] = await Promise.all([memberInbox, outsiderInbox]);

    expect(memberEvents).toHaveLength(1);
    expect(memberEvents[0].message.content).toBe("bí mật của nhóm");
    // Đây là điều thực sự quan trọng: nội dung không bao giờ tới người ngoài.
    expect(outsiderEvents).toHaveLength(0);
  });

  it("alias join-conversation cũ đã bị gỡ hẳn", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    const socket = await harness.connect(member);

    // Alias tồn tại để tab đang mở không mất realtime giữa hai lần deploy. Nay đã
    // bỏ: không còn handler nào, nên không có ack nào quay lại. Kể cả với một
    // thành viên hợp lệ — nghĩa là cái tên đó thực sự chết, chứ không phải chỉ bị
    // siết quyền.
    const ack = await emitExpectingNoAck(socket, "join-conversation", String(group._id));

    expect(ack).toBeNull();
  });

  it("id sai định dạng bị từ chối chứ không làm sập socket", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    const ack = await emitWithAck(socket, "conversation:subscribe", {
      conversationId: "khong-phai-id",
    });

    expect(ack).toEqual({ ok: false, code: "INVALID_ID" });
    expect(socket.connected).toBe(true);
  });

  it("thiếu conversationId bị từ chối", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    const ack = await emitWithAck(socket, "conversation:subscribe", {});

    expect(ack).toEqual({ ok: false, code: "MISSING_CONVERSATION_ID" });
  });

  it("conversation không tồn tại → CONVERSATION_NOT_FOUND", async () => {
    const user = await makeUser();
    const socket = await harness.connect(user);

    const ack = await emitWithAck(socket, "conversation:subscribe", {
      conversationId: "507f1f77bcf86cd799439011",
    });

    expect(ack).toEqual({ ok: false, code: "CONVERSATION_NOT_FOUND" });
  });
});

describe("thứ tự đăng ký listener khi connect", () => {
  it("xử lý event emit ngay lập tức, không chờ connect:ready", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    // Emit ngay khi transport vừa mở, KHÔNG chờ `connection:ready`. Trước đây
    // handler connection là async và `await getUserConversationIds()` chạy trước
    // các `socket.on(...)`, nên event tới trong khoảng đó bị bỏ im lặng và ack
    // không bao giờ về.
    const socket = await harness.connect(member, { waitForReady: false });

    const ack = await emitWithAck(socket, "conversation:subscribe", {
      conversationId: String(group._id),
    });

    expect(ack).toEqual({ ok: true });
  });

  it("phát connection:ready kèm các conversation đã join", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    // Gắn listener trước khi server kịp phát, nên không có race.
    const socket = harness.rawClient(member);
    const ready = await new Promise((resolve, reject) => {
      socket.once("connection:ready", resolve);
      socket.once("connect_error", reject);
    });

    expect(ready.conversationIds).toContain(String(group._id));
  });
});

describe("payload của message:new", () => {
  it("kèm danh tính người gửi, không phải chỉ id", async () => {
    const [alice, bob] = await Promise.all([
      makeUser({ displayName: "Alice" }),
      makeUser(),
    ]);
    const { makeFriendship, makeDirectConversation } = await import("./helpers/factories.js");
    await makeFriendship(alice, bob);
    const convo = await makeDirectConversation(alice, bob);

    const socket = await harness.connect(bob);
    const inbox = collectEvents(socket, "message:new");

    // Gửi qua HTTP để đi đúng đường thật.
    const { authedAgent } = await import("./helpers/authedAgent.js");
    await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(bob._id),
        conversationId: String(convo._id),
        content: "chào bob",
      })
      .expect(201);

    const events = await inbox;

    expect(events).toHaveLength(1);
    // Trước đây client phải tự bịa `displayName: ""` vì payload không có.
    expect(events[0].message.sender).toMatchObject({
      _id: String(alice._id),
      displayName: "Alice",
    });
  });

  it("unreadCounts là object thuần, không phải Map bị JSON hoá thành {}", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const { makeFriendship, makeDirectConversation } = await import("./helpers/factories.js");
    await makeFriendship(alice, bob);
    const convo = await makeDirectConversation(alice, bob);

    const socket = await harness.connect(bob);
    const inbox = collectEvents(socket, "message:new");

    const { authedAgent } = await import("./helpers/authedAgent.js");
    await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(bob._id),
        conversationId: String(convo._id),
        content: "một",
      })
      .expect(201);

    const [event] = await inbox;

    // Mongoose Map serialize thành {} — nên badge chưa đọc bị xoá sạch mỗi lần có
    // tin mới. Bob phải thấy đúng 1 tin chưa đọc.
    expect(event.unreadCounts[String(bob._id)]).toBe(1);
  });

  it("không còn phát tên event cũ new-message", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const { makeFriendship, makeDirectConversation } = await import("./helpers/factories.js");
    await makeFriendship(alice, bob);
    const convo = await makeDirectConversation(alice, bob);

    const socket = await harness.connect(bob);
    const legacyInbox = collectEvents(socket, "new-message");
    const currentInbox = collectEvents(socket, "message:new");

    const { authedAgent } = await import("./helpers/authedAgent.js");
    await authedAgent(alice)
      .post("/api/messages/direct")
      .send({
        recipientId: String(bob._id),
        conversationId: String(convo._id),
        content: "tương thích",
      })
      .expect(201);

    // Tên mới vẫn tới; tên cũ thì không. Khẳng định cả hai để test không thể pass
    // chỉ vì tin nhắn không được gửi đi.
    expect(await currentInbox).toHaveLength(1);
    expect(await legacyInbox).toHaveLength(0);
  });
});

describe("room tự động join khi connect", () => {
  it("thành viên nhận tin nhắn mà không cần subscribe thủ công", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    // Server tự join mọi room của user lúc connect.
    const socket = await harness.connect(member);
    const inbox = collectEvents(socket, "message:new");

    const message = await makeMessage(group, owner, { content: "tự động nhận" });
    emitNewMessage(harness.ioServer, group, message);

    expect(await inbox).toHaveLength(1);
  });
});
