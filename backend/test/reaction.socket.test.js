import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  makeMessage,
  makeUser,
} from "./helpers/factories.js";

/**
 * Đường socket của biểu cảm — đường mà production THỰC SỰ dùng.
 *
 * `reactions.test.js` chỉ đi qua HTTP, vốn chỉ là đường dự phòng khi socket đứt.
 * Một lỗi chỉ nằm ở socket sẽ lọt hoàn toàn qua bộ test đó.
 */
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

const setupPair = async () => {
  const [alice, bob] = await Promise.all([
    makeUser({ displayName: "Alice" }),
    makeUser({ displayName: "Bob" }),
  ]);

  await makeFriendship(alice, bob);

  const convo = await makeDirectConversation(alice, bob);
  const message = await makeMessage(convo, alice, { content: "xin chào" });

  return { alice, bob, convo, message };
};

describe("reaction:toggle qua socket", () => {
  it("ack báo thành công", async () => {
    const { bob, message } = await setupPair();
    const socket = await harness.connect(bob);

    const ack = await emitWithAck(socket, "reaction:toggle", {
      messageId: String(message._id),
      emoji: "👍",
    });

    expect(ack.ok).toBe(true);
    expect(ack.active).toBe(true);
    expect(ack.reactions).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
  });

  it("phát reaction:updated cho thành viên còn lại trong room", async () => {
    const { alice, bob, convo, message } = await setupPair();

    const [aliceSocket, bobSocket] = await Promise.all([
      harness.connect(alice),
      harness.connect(bob),
    ]);

    const received = collectEvents(aliceSocket, "reaction:updated");

    bobSocket.emit("reaction:toggle", { messageId: String(message._id), emoji: "❤️" });

    expect(await received).toEqual([
      {
        conversationId: String(convo._id),
        messageId: String(message._id),
        reactions: [{ emoji: "❤️", count: 1 }],
        actorId: String(bob._id),
        emoji: "❤️",
        active: true,
      },
    ]);
  });

  it("người vừa bấm CŨNG nhận được broadcast — client dựa vào đó để chốt lại", async () => {
    const { bob, message } = await setupPair();
    const socket = await harness.connect(bob);

    const received = collectEvents(socket, "reaction:updated");

    socket.emit("reaction:toggle", { messageId: String(message._id), emoji: "😂" });

    expect(await received).toHaveLength(1);
  });

  it("bấm lại chính emoji đó thì gỡ", async () => {
    const { bob, message } = await setupPair();
    const socket = await harness.connect(bob);

    await emitWithAck(socket, "reaction:toggle", {
      messageId: String(message._id),
      emoji: "👍",
    });

    const off = await emitWithAck(socket, "reaction:toggle", {
      messageId: String(message._id),
      emoji: "👍",
    });

    expect(off.active).toBe(false);
    expect(off.reactions).toEqual([]);
  });

  it("người ngoài conversation bị từ chối", async () => {
    const { message } = await setupPair();
    const outsider = await makeUser({ displayName: "Người ngoài" });
    const socket = await harness.connect(outsider);

    const ack = await emitWithAck(socket, "reaction:toggle", {
      messageId: String(message._id),
      emoji: "👍",
    });

    expect(ack.ok).toBe(false);
  });

  it("emoji ngoài bộ cố định bị từ chối", async () => {
    const { bob, message } = await setupPair();
    const socket = await harness.connect(bob);

    const ack = await emitWithAck(socket, "reaction:toggle", {
      messageId: String(message._id),
      emoji: "🍕",
    });

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe("VALIDATION_ERROR");
  });
});
