import { describe, expect, it } from "vitest";
import User from "../src/models/User.js";
import { anonAgent, authedAgent } from "./helpers/authedAgent.js";
import { makeUser } from "./helpers/factories.js";

describe("PATCH /api/users/me", () => {
  it("cập nhật tên hiển thị và bio", async () => {
    const user = await makeUser({ displayName: "Tên cũ" });

    const res = await authedAgent(user)
      .patch("/api/users/me")
      .send({ displayName: "Tên mới", bio: "Xin chào" })
      .expect(200);

    expect(res.body.user.displayName).toBe("Tên mới");
    expect(res.body.user.bio).toBe("Xin chào");
  });

  it("không trả về hashedPassword", async () => {
    const user = await makeUser();

    const res = await authedAgent(user)
      .patch("/api/users/me")
      .send({ displayName: "Ai đó" })
      .expect(200);

    expect(res.body.user.hashedPassword).toBeUndefined();
  });

  it("BỎ QUA các field không được phép sửa", async () => {
    const user = await makeUser({ displayName: "Ban đầu" });

    await authedAgent(user)
      .patch("/api/users/me")
      .send({
        displayName: "Hợp lệ",
        // Những field này không nằm trong schema và phải bị cắt bỏ.
        username: "ten-khac",
        email: "khac@example.com",
        hashedPassword: "chuoi-bat-ky",
      })
      .expect(200);

    const fresh = await User.findById(user._id).lean();

    // Nếu controller spread req.body thì đây là đường nâng quyền.
    expect(fresh.displayName).toBe("Hợp lệ");
    expect(fresh.username).toBe(user.username);
    expect(fresh.email).toBe(user.email);
    expect(fresh.hashedPassword).toBe(user.hashedPassword);
  });

  it("từ chối tên hiển thị rỗng", async () => {
    const user = await makeUser();

    const res = await authedAgent(user)
      .patch("/api/users/me")
      .send({ displayName: "   " })
      .expect(400);

    expect(res.body.details.fields).toHaveProperty("displayName");
  });

  it("từ chối số điện thoại sai định dạng", async () => {
    const user = await makeUser();

    await authedAgent(user)
      .patch("/api/users/me")
      .send({ phone: "không-phải-số" })
      .expect(400);
  });

  it("cho phép xoá bio bằng null", async () => {
    const user = await makeUser({ bio: "có sẵn" });

    const res = await authedAgent(user)
      .patch("/api/users/me")
      .send({ bio: null })
      .expect(200);

    expect(res.body.user.bio).toBeNull();
  });

  it("body rỗng → 400", async () => {
    const user = await makeUser();

    const res = await authedAgent(user).patch("/api/users/me").send({}).expect(400);

    expect(res.body.code).toBe("NOTHING_TO_UPDATE");
  });

  it("chưa đăng nhập → 401", async () => {
    await anonAgent().patch("/api/users/me").send({ displayName: "X" }).expect(401);
  });
});

describe("tuỳ chọn người dùng", () => {
  it("có giá trị mặc định hợp lý", async () => {
    const user = await makeUser();

    const res = await authedAgent(user).get("/api/users/me").expect(200);

    expect(res.body.user.preferences).toMatchObject({
      inAppNotifications: true,
      // Thông báo trình duyệt mặc định TẮT: phải do người dùng chủ động bật.
      browserNotifications: false,
      showPresence: true,
      enterToSend: true,
    });
  });

  it("cập nhật một tuỳ chọn KHÔNG xoá các tuỳ chọn khác", async () => {
    const user = await makeUser();

    await authedAgent(user)
      .patch("/api/users/me")
      .send({ preferences: { browserNotifications: true } })
      .expect(200);

    const res = await authedAgent(user)
      .patch("/api/users/me")
      .send({ preferences: { enterToSend: false } })
      .expect(200);

    // Ghi từng khoá một, nên tuỳ chọn đặt trước đó vẫn còn.
    expect(res.body.user.preferences).toMatchObject({
      browserNotifications: true,
      enterToSend: false,
      inAppNotifications: true,
    });
  });

  it("từ chối giá trị không phải boolean", async () => {
    const user = await makeUser();

    await authedAgent(user)
      .patch("/api/users/me")
      .send({ preferences: { inAppNotifications: "có" } })
      .expect(400);
  });
});
