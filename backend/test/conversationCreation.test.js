import { describe, expect, it } from "vitest";
import { authedAgent } from "./helpers/authedAgent.js";
import { makeFriendship, makeUser } from "./helpers/factories.js";

/**
 * Tạo cuộc trò chuyện 1-1 từ danh sách bạn bè.
 *
 * Frontend gửi `name: ""` cho chat 1-1 (FriendListModal không có ô tên nhóm để
 * điền). Schema cũ dùng `z.string().trim().min(1).max(100).optional()` — `.optional()`
 * chỉ cho phép `undefined`, KHÔNG cho phép chuỗi rỗng — nên mọi cú bấm vào một
 * người bạn đều trả 400, store nuốt lỗi và trả null, và giao diện đứng im như thể
 * không có gì được bấm.
 */
describe("POST /conversations — chat 1-1", () => {
  const directBody = (bob, extra = {}) => ({
    type: "direct",
    memberIds: [String(bob._id)],
    ...extra,
  });

  it("nhận name rỗng cho chat 1-1", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    const res = await authedAgent(alice)
      .post("/api/conversations")
      .send(directBody(bob, { name: "" }))
      .expect(201);

    expect(res.body.conversation.type).toBe("direct");
    expect(res.body.conversation.participants).toHaveLength(2);
  });

  it("nhận name chỉ có khoảng trắng cho chat 1-1", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send(directBody(bob, { name: "   " }))
      .expect(201);
  });

  it("vẫn nhận khi không gửi name", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send(directBody(bob))
      .expect(201);
  });

  it("bấm hai lần vào cùng một người bạn trả về đúng một conversation", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);
    const agent = authedAgent(alice);

    const first = await agent.post("/api/conversations").send(directBody(bob, { name: "" }));
    const second = await agent.post("/api/conversations").send(directBody(bob, { name: "" }));

    expect(first.body.conversation._id).toBe(second.body.conversation._id);
  });

  // Nhóm vẫn phải có tên: nới lỏng ở trên không được mở đường cho nhóm không tên.
  it("nhóm với name rỗng vẫn bị từ chối", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "", memberIds: [String(bob._id)] })
      .expect(400);
  });

  it("nhóm với name chỉ có khoảng trắng vẫn bị từ chối", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "   ", memberIds: [String(bob._id)] })
      .expect(400);
  });

  it("tên nhóm dài quá 100 ký tự vẫn bị từ chối", async () => {
    const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
    await makeFriendship(alice, bob);

    await authedAgent(alice)
      .post("/api/conversations")
      .send({ type: "group", name: "x".repeat(101), memberIds: [String(bob._id)] })
      .expect(400);
  });
});
