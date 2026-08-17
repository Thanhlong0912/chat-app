import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Message from "../src/models/Message.js";
import { ROLES } from "../src/domain/groupPermissions.js";
import { clearMembershipCache } from "../src/services/membershipService.js";
import { clearAudienceCache } from "../src/services/audienceService.js";
import { resetPresence } from "../src/socket/presence.js";
import { resetIo, setIo } from "../src/socket/io.js";
import {
  collectEvents,
  emitWithAck,
  startSocketServer,
} from "./helpers/socketHarness.js";
import {
  makeDirectConversation,
  makeFriendship,
  makeGroupConversation,
  makeMessagesAt,
  makeUser,
} from "./helpers/factories.js";

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

/** Nhóm ba người, ai cũng là bạn của nhau, dùng cho hầu hết các test dưới. */
const setupGroup = async () => {
  const [owner, member, other] = await Promise.all([
    makeUser({ displayName: "Chủ nhóm" }),
    makeUser({ displayName: "Thành viên" }),
    makeUser({ displayName: "Người khác" }),
  ]);

  const group = await makeGroupConversation(owner, [
    { user: member, role: ROLES.MEMBER },
    { user: other, role: ROLES.MEMBER },
  ]);

  return { owner, member, other, group };
};

describe("message:send", () => {
  it("tạo tin nhắn và ack lại cho người gửi", async () => {
    const { owner, group } = await setupGroup();
    const socket = await harness.connect(owner);

    const ack = await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "chào cả nhóm",
    });

    expect(ack.ok).toBe(true);
    expect(ack.message.content).toBe("chào cả nhóm");
    expect(ack.message.sender.displayName).toBe("Chủ nhóm");
    expect(await Message.countDocuments({ conversationId: group._id })).toBe(1);
  });

  it("phát message:new cho thành viên khác trong room", async () => {
    const { owner, member, group } = await setupGroup();

    const senderSocket = await harness.connect(owner);
    const receiverSocket = await harness.connect(member);

    const inbox = collectEvents(receiverSocket, "message:new");

    await emitWithAck(senderSocket, "message:send", {
      conversationId: String(group._id),
      content: "xin chào",
    });

    const events = await inbox;

    expect(events).toHaveLength(1);
    expect(events[0].message.content).toBe("xin chào");
  });

  it("người ngoài không nhận được gì", async () => {
    const { owner, group } = await setupGroup();
    const outsider = await makeUser();

    const senderSocket = await harness.connect(owner);
    const outsiderSocket = await harness.connect(outsider);

    const inbox = collectEvents(outsiderSocket, "message:new");

    await emitWithAck(senderSocket, "message:send", {
      conversationId: String(group._id),
      content: "bí mật",
    });

    expect(await inbox).toHaveLength(0);
  });

  it("từ chối gửi vào conversation không phải của mình", async () => {
    const { group } = await setupGroup();
    const outsider = await makeUser();

    const socket = await harness.connect(outsider);

    const ack = await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "chèn vào",
    });

    expect(ack).toEqual({ ok: false, code: "NOT_A_MEMBER" });
    expect(await Message.countDocuments({ conversationId: group._id })).toBe(0);
  });

  it("từ chối nội dung rỗng", async () => {
    const { owner, group } = await setupGroup();
    const socket = await harness.connect(owner);

    const ack = await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "   ",
    });

    expect(ack.ok).toBe(false);
  });
});

describe("chống trùng bằng clientMessageId", () => {
  it("gửi lại cùng clientMessageId chỉ tạo MỘT tin nhắn", async () => {
    const { owner, group } = await setupGroup();
    const socket = await harness.connect(owner);

    const payload = {
      conversationId: String(group._id),
      content: "gửi một lần",
      clientMessageId: "cid-abc-123",
    };

    const first = await emitWithAck(socket, "message:send", payload);
    // Đây là điều xảy ra thật khi mất kết nối giữa lúc gửi: client không biết
    // server đã nhận chưa nên gửi lại.
    const second = await emitWithAck(socket, "message:send", payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.message._id).toBe(first.message._id);
    expect(second.duplicate).toBe(true);
    expect(await Message.countDocuments({ conversationId: group._id })).toBe(1);
  });

  it("không tăng số chưa đọc hai lần cho bản gửi lại", async () => {
    const { owner, member, group } = await setupGroup();
    const socket = await harness.connect(owner);

    const payload = {
      conversationId: String(group._id),
      content: "một lần thôi",
      clientMessageId: "cid-unread",
    };

    await emitWithAck(socket, "message:send", payload);
    await emitWithAck(socket, "message:send", payload);

    const { default: Conversation } = await import("../src/models/Conversation.js");
    const fresh = await Conversation.findById(group._id);

    expect(fresh.unreadCounts.get(String(member._id))).toBe(1);
  });

  it("gửi đồng thời cùng clientMessageId vẫn chỉ ra một tin nhắn", async () => {
    const { owner, group } = await setupGroup();
    const socket = await harness.connect(owner);

    const payload = {
      conversationId: String(group._id),
      content: "đua nhau",
      clientMessageId: "cid-race",
    };

    await Promise.all([
      emitWithAck(socket, "message:send", payload),
      emitWithAck(socket, "message:send", payload),
      emitWithAck(socket, "message:send", payload),
    ]);

    expect(await Message.countDocuments({ conversationId: group._id })).toBe(1);
  });

  it("clientMessageId khác nhau tạo các tin nhắn khác nhau", async () => {
    const { owner, group } = await setupGroup();
    const socket = await harness.connect(owner);

    await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "một",
      clientMessageId: "cid-1",
    });
    await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "hai",
      clientMessageId: "cid-2",
    });

    expect(await Message.countDocuments({ conversationId: group._id })).toBe(2);
  });

  it("cùng clientMessageId ở hai conversation khác nhau là hai tin nhắn", async () => {
    const { owner, group } = await setupGroup();
    const friend = await makeUser();
    await makeFriendship(owner, friend);
    const direct = await makeDirectConversation(owner, friend);

    const socket = await harness.connect(owner);

    // Unique index có phạm vi theo conversation, nên client có thể đánh số lại
    // cho từng cuộc trò chuyện.
    await emitWithAck(socket, "message:send", {
      conversationId: String(group._id),
      content: "trong nhóm",
      clientMessageId: "cid-dung-chung",
    });
    await emitWithAck(socket, "message:send", {
      conversationId: String(direct._id),
      content: "trong 1-1",
      clientMessageId: "cid-dung-chung",
    });

    expect(await Message.countDocuments({})).toBe(2);
  });
});

describe("typing", () => {
  it("thành viên khác nhận được typing:update", async () => {
    const { owner, member, group } = await setupGroup();

    const typerSocket = await harness.connect(owner);
    const watcherSocket = await harness.connect(member);

    const inbox = collectEvents(watcherSocket, "typing:update");

    typerSocket.emit("typing:start", { conversationId: String(group._id) });

    const events = await inbox;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: String(group._id),
      userId: String(owner._id),
      displayName: "Chủ nhóm",
      isTyping: true,
    });
  });

  it("KHÔNG dội lại cho chính người đang gõ", async () => {
    const { owner, member, group } = await setupGroup();

    const typerSocket = await harness.connect(owner);
    await harness.connect(member);

    const ownInbox = collectEvents(typerSocket, "typing:update");

    typerSocket.emit("typing:start", { conversationId: String(group._id) });

    // Dùng `socket.to` chứ không phải `io.to` chính là để tránh việc này.
    expect(await ownInbox).toHaveLength(0);
  });

  it("typing:stop phát isTyping false", async () => {
    const { owner, member, group } = await setupGroup();

    const typerSocket = await harness.connect(owner);
    const watcherSocket = await harness.connect(member);

    typerSocket.emit("typing:start", { conversationId: String(group._id) });
    await new Promise((r) => setTimeout(r, 50));

    const inbox = collectEvents(watcherSocket, "typing:update");
    typerSocket.emit("typing:stop", { conversationId: String(group._id) });

    const events = await inbox;

    expect(events).toHaveLength(1);
    expect(events[0].isTyping).toBe(false);
  });

  it("tiết chế các lần typing:start liên tiếp", async () => {
    const { owner, member, group } = await setupGroup();

    const typerSocket = await harness.connect(owner);
    const watcherSocket = await harness.connect(member);

    const inbox = collectEvents(watcherSocket, "typing:update", { duration: 400 });

    // Mô phỏng gõ nhanh: mười lần trong vài chục ms.
    for (let i = 0; i < 10; i += 1) {
      typerSocket.emit("typing:start", { conversationId: String(group._id) });
    }

    // Không tiết chế thì mỗi ký tự là một message phát cho cả room.
    expect(await inbox).toHaveLength(1);
  });

  it("ngắt kết nối sẽ dọn chỉ báo đang nhập", async () => {
    const { owner, member, group } = await setupGroup();

    const typerSocket = await harness.connect(owner);
    const watcherSocket = await harness.connect(member);

    typerSocket.emit("typing:start", { conversationId: String(group._id) });
    await new Promise((r) => setTimeout(r, 50));

    const inbox = collectEvents(watcherSocket, "typing:update");
    typerSocket.close();

    // Không có bước dọn này, người xem sẽ thấy "đang nhập…" treo mãi của một
    // người đã rời đi.
    const events = await inbox;
    expect(events.some((e) => e.isTyping === false)).toBe(true);
  });

  it("người ngoài không phát được typing vào nhóm", async () => {
    const { member, group } = await setupGroup();
    const outsider = await makeUser();

    const outsiderSocket = await harness.connect(outsider);
    const watcherSocket = await harness.connect(member);

    const inbox = collectEvents(watcherSocket, "typing:update");

    outsiderSocket.emit("typing:start", { conversationId: String(group._id) });

    expect(await inbox).toHaveLength(0);
  });
});

describe("read:advance", () => {
  it("phát read:updated cho thành viên khác", async () => {
    const { owner, member, group } = await setupGroup();

    const ownerSocket = await harness.connect(owner);
    const memberSocket = await harness.connect(member);

    await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "đọc chưa",
    });

    const inbox = collectEvents(ownerSocket, "read:updated");

    const ack = await emitWithAck(memberSocket, "read:advance", {
      conversationId: String(group._id),
    });

    expect(ack.ok).toBe(true);
    expect(ack.unreadCount).toBe(0);

    const events = await inbox;
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(String(member._id));
  });

  it("không phát lại khi con trỏ không tiến", async () => {
    const { owner, member, group } = await setupGroup();

    const ownerSocket = await harness.connect(owner);
    const memberSocket = await harness.connect(member);

    await emitWithAck(ownerSocket, "message:send", {
      conversationId: String(group._id),
      content: "một",
    });

    await emitWithAck(memberSocket, "read:advance", { conversationId: String(group._id) });

    const inbox = collectEvents(ownerSocket, "read:updated");
    // Đọc lại lần nữa khi không có gì mới.
    await emitWithAck(memberSocket, "read:advance", { conversationId: String(group._id) });

    expect(await inbox).toHaveLength(0);
  });

  it("người ngoài bị từ chối", async () => {
    const { group } = await setupGroup();
    const outsider = await makeUser();

    const socket = await harness.connect(outsider);

    const ack = await emitWithAck(socket, "read:advance", {
      conversationId: String(group._id),
    });

    expect(ack).toEqual({ ok: false, code: "NOT_A_MEMBER" });
  });
});

describe("sync:since", () => {
  it("trả về các tin nhắn bị bỏ lỡ trong lúc mất kết nối", async () => {
    const { owner, member, group } = await setupGroup();

    const base = Date.now();
    const [first] = await makeMessagesAt(group, owner, [new Date(base)]);

    const socket = await harness.connect(member);

    // Mô phỏng: client đã có `first`, rồi mất kết nối và bỏ lỡ hai tin sau.
    await makeMessagesAt(group, owner, [new Date(base + 1000), new Date(base + 2000)]);

    const ack = await emitWithAck(socket, "sync:since", {
      cursors: [{ conversationId: String(group._id), cursor: cursorFor(first) }],
    });

    expect(ack.ok).toBe(true);
    expect(ack.conversations).toHaveLength(1);
    expect(ack.conversations[0].messages).toHaveLength(2);
    expect(ack.conversations[0].truncated).toBe(false);
  });

  it("không cursor thì trả từ đầu", async () => {
    const { owner, member, group } = await setupGroup();
    await makeMessagesAt(group, owner, [new Date(), new Date(Date.now() + 1000)]);

    const socket = await harness.connect(member);

    const ack = await emitWithAck(socket, "sync:since", {
      cursors: [{ conversationId: String(group._id) }],
    });

    expect(ack.conversations[0].messages).toHaveLength(2);
  });

  it("kiểm tra quyền từng conversation, không phải cả lô", async () => {
    const { owner, group } = await setupGroup();
    const outsider = await makeUser();
    const friend = await makeUser();
    await makeFriendship(outsider, friend);
    const own = await makeDirectConversation(outsider, friend);

    await makeMessagesAt(group, owner, [new Date()]);

    const socket = await harness.connect(outsider);

    // Trộn một conversation hợp lệ với một cái không thuộc về mình.
    const ack = await emitWithAck(socket, "sync:since", {
      cursors: [
        { conversationId: String(own._id) },
        { conversationId: String(group._id) },
      ],
    });

    const foreign = ack.conversations.find((c) => c.conversationId === String(group._id));

    expect(foreign.error).toBe("NOT_A_MEMBER");
    expect(foreign.messages).toBeUndefined();
  });
});

describe("presence qua socket thật", () => {
  it("thành viên cùng nhóm nhận được presence:update", async () => {
    const { owner, member } = await setupGroup();

    const watcherSocket = await harness.connect(member);
    const inbox = collectEvents(watcherSocket, "presence:update");

    await harness.connect(owner);

    const events = await inbox;

    expect(events.some((e) => e.userId === String(owner._id) && e.status === "online")).toBe(
      true,
    );
  });

  it("người không liên quan KHÔNG nhận được presence của người lạ", async () => {
    const { owner } = await setupGroup();
    const stranger = await makeUser();

    const strangerSocket = await harness.connect(stranger);
    const inbox = collectEvents(strangerSocket, "presence:update");

    await harness.connect(owner);

    // Bản cũ phát io.emit cho MỌI socket, nên ai cũng biết trạng thái của tất cả.
    expect(await inbox).toHaveLength(0);
  });

  it("đóng một trong hai tab thì không phát offline", async () => {
    const { owner, member } = await setupGroup();

    const firstTab = await harness.connect(owner);
    await harness.connect(owner);

    const watcherSocket = await harness.connect(member);
    const inbox = collectEvents(watcherSocket, "presence:update", { duration: 400 });

    firstTab.close();

    const offlineEvents = (await inbox).filter((e) => e.status === "offline");
    expect(offlineEvents).toHaveLength(0);
  });

  it("snapshot khi kết nối chỉ chứa audience của mình", async () => {
    const { owner, member } = await setupGroup();
    const stranger = await makeUser();

    await harness.connect(stranger);

    const socket = harness.rawClient(owner);
    const snapshot = await new Promise((resolve, reject) => {
      socket.once("presence:snapshot", resolve);
      socket.once("connect_error", reject);
    });

    const ids = snapshot.users.map((u) => u.userId);

    expect(ids).toContain(String(member._id));
    expect(ids).not.toContain(String(stranger._id));
  });

  it("ghi lastSeenAt khi socket cuối cùng ngắt kết nối", async () => {
    const { owner } = await setupGroup();
    const { default: User } = await import("../src/models/User.js");

    const socket = await harness.connect(owner);
    socket.close();

    // Chờ handler disconnect chạy xong.
    await new Promise((r) => setTimeout(r, 300));

    const fresh = await User.findById(owner._id).lean();
    expect(fresh.lastSeenAt).toBeInstanceOf(Date);
  });
});

/** Dựng cursor giống server: base64url của {t, i}. */
const cursorFor = (message) =>
  Buffer.from(
    JSON.stringify({ t: new Date(message.createdAt).toISOString(), i: String(message._id) }),
    "utf8",
  ).toString("base64url");
