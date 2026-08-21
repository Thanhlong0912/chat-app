import { describe, expect, it } from "vitest";
import Message from "../src/models/Message.js";
import { serializeMessage } from "../src/serializers/message.js";
import { createMessage } from "../src/services/messageService.js";
import { authedAgent } from "./helpers/authedAgent.js";
import { makeDirectConversation, makeFriendship, makeUser } from "./helpers/factories.js";

/**
 * Tin nhắn video.
 *
 * Schema attachment vốn đã có `kind: "image" | "video" | "file"`, nhưng đường gửi
 * tin chỉ mang được một chuỗi `imgUrl` — nên `kind`, `mimeType` và nhất là
 * `publicId` đều bị vứt đi trên đường. Mất `publicId` còn kéo theo một lỗi thứ
 * hai: `deleteMessage` dọn asset trên Cloudinary theo `publicId`, mà giá trị đó
 * chưa từng được lưu, nên mọi tệp đính kèm đều nằm lại vĩnh viễn sau khi xoá.
 */
const videoAttachment = (overrides = {}) => ({
  url: "https://res.cloudinary.com/demo/video/upload/v1/clip.mp4",
  publicId: "moji_chat/attachments/clip",
  mimeType: "video/mp4",
  bytes: 2_000_000,
  width: 1280,
  height: 720,
  originalName: "clip.mp4",
  kind: "video",
  ...overrides,
});

describe("tin nhắn video", () => {
  it("lưu attachment video kèm kind và publicId", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const { message } = await createMessage({
      conversation: convo,
      sender: alice,
      attachments: [videoAttachment()],
    });

    const saved = await Message.findById(message._id).lean();

    expect(saved.kind).toBe("video");
    expect(saved.attachments[0].kind).toBe("video");
    expect(saved.attachments[0].publicId).toBe("moji_chat/attachments/clip");
    expect(saved.attachments[0].mimeType).toBe("video/mp4");
  });

  it("ảnh vẫn là kind image", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const { message } = await createMessage({
      conversation: convo,
      sender: alice,
      attachments: [videoAttachment({ kind: "image", mimeType: "image/png" })],
    });

    expect((await Message.findById(message._id).lean()).kind).toBe("image");
  });

  it("serializer giữ nguyên kind video", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    const { message } = await createMessage({
      conversation: convo,
      sender: alice,
      attachments: [videoAttachment()],
    });

    const serialized = serializeMessage(await Message.findById(message._id));

    expect(serialized.kind).toBe("video");
    expect(serialized.attachments[0].kind).toBe("video");
  });

  it("video không có nội dung chữ vẫn gửi được", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    const convo = await makeDirectConversation(alice, bob);

    await expect(
      createMessage({
        conversation: convo,
        sender: alice,
        attachments: [videoAttachment()],
      }),
    ).resolves.toBeTruthy();
  });

  describe("qua HTTP", () => {
    const setup = async () => {
      const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
      await makeFriendship(alice, bob);
      return { alice, bob };
    };

    it("nhận `attachment` đầy đủ và giữ được publicId", async () => {
      const { alice, bob } = await setup();

      const res = await authedAgent(alice)
        .post("/api/messages/direct")
        .send({ recipientId: String(bob._id), attachment: videoAttachment() })
        .expect(201);

      expect(res.body.message.kind).toBe("video");
      expect(res.body.message.attachments[0].kind).toBe("video");

      const saved = await Message.findById(res.body.message._id).lean();
      expect(saved.attachments[0].publicId).toBe("moji_chat/attachments/clip");
    });

    it("`imgUrl` cũ vẫn chạy, để bundle frontend đang mở tab không gãy", async () => {
      const { alice, bob } = await setup();

      const res = await authedAgent(alice)
        .post("/api/messages/direct")
        .send({
          recipientId: String(bob._id),
          imgUrl: "https://res.cloudinary.com/demo/image/upload/v1/a.png",
        })
        .expect(201);

      expect(res.body.message.kind).toBe("image");
      expect(res.body.message.attachments[0].url).toContain("a.png");
    });

    it("từ chối attachment có url không hợp lệ", async () => {
      const { alice, bob } = await setup();

      await authedAgent(alice)
        .post("/api/messages/direct")
        .send({
          recipientId: String(bob._id),
          attachment: videoAttachment({ url: "javascript:alert(1)" }),
        })
        .expect(400);
    });

    it("từ chối kind lạ", async () => {
      const { alice, bob } = await setup();

      await authedAgent(alice)
        .post("/api/messages/direct")
        .send({
          recipientId: String(bob._id),
          attachment: videoAttachment({ kind: "executable" }),
        })
        .expect(400);
    });
  });
});
