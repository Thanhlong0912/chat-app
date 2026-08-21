import { describe, expect, it } from "vitest";
import { anonAgent, authedAgent } from "./helpers/authedAgent.js";
import { makeUser } from "./helpers/factories.js";

/**
 * Tìm người dùng để kết bạn.
 *
 * Bản trước là `findOne({ username })` khớp TUYỆT ĐỐI, nên phải gõ đúng từng ký
 * tự của username mới thấy gì — không tìm được ai nếu không biết trước tên họ.
 *
 * Response giữ cả hai hình dạng: `users` (mảng, cho client mới) và `user` (một
 * kết quả khớp tuyệt đối, cho bundle frontend đang chạy). Frontend deploy trên
 * Vercel còn backend trên Render, hai bên lên bản mới không cùng lúc — bỏ `user`
 * ngay sẽ làm chức năng kết bạn chết cho tới khi Vercel deploy xong.
 */
const seed = async () => {
  const [alice, alan, bob, me] = await Promise.all([
    makeUser({ username: "alice", displayName: "Alice Nguyễn" }),
    makeUser({ username: "alan", displayName: "Alan Trần" }),
    makeUser({ username: "bob", displayName: "Bob Lê" }),
    makeUser({ username: "me", displayName: "Chính tôi" }),
  ]);

  return { alice, alan, bob, me };
};

describe("GET /users/search", () => {
  it("một ký tự đã ra kết quả", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "a" })
      .expect(200);

    const usernames = res.body.users.map((u) => u.username).sort();

    expect(usernames).toEqual(["alan", "alice"]);
  });

  it("không phân biệt hoa thường", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "ALI" })
      .expect(200);

    expect(res.body.users.map((u) => u.username)).toEqual(["alice"]);
  });

  it("tìm được cả theo tên hiển thị", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "Trần" })
      .expect(200);

    expect(res.body.users.map((u) => u.username)).toEqual(["alan"]);
  });

  it("không trả về chính mình", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "me" })
      .expect(200);

    expect(res.body.users).toEqual([]);
  });

  it("vẫn trả `user` cho khớp tuyệt đối, để bundle frontend cũ chạy được", async () => {
    const { alice, me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "alice" })
      .expect(200);

    expect(res.body.user._id).toBe(String(alice._id));
  });

  it("`user` là null khi không khớp tuyệt đối", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "ali" })
      .expect(200);

    expect(res.body.user).toBeNull();
    expect(res.body.users).toHaveLength(1);
  });

  it("không rò rỉ hashedPassword hay email", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "a" })
      .expect(200);

    res.body.users.forEach((user) => {
      expect(user.hashedPassword).toBeUndefined();
      expect(user.email).toBeUndefined();
    });
  });

  // Chuỗi tìm kiếm đi thẳng vào regex, nên ký tự đặc biệt phải được escape —
  // nếu không `.*` khớp mọi người, và `(` làm Mongo ném lỗi regex không hợp lệ.
  it("escape ký tự regex thay vì khớp tất cả", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: ".*" })
      .expect(200);

    expect(res.body.users).toEqual([]);
  });

  it("regex không hợp lệ không làm sập request", async () => {
    const { me } = await seed();

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "a(b" })
      .expect(200);

    expect(res.body.users).toEqual([]);
  });

  it("giới hạn số kết quả trả về", async () => {
    const me = await makeUser({ username: "searcher" });

    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        makeUser({ username: `zzz${i}`, displayName: `Người ${i}` }),
      ),
    );

    const res = await authedAgent(me)
      .get("/api/users/search")
      .query({ username: "zzz" })
      .expect(200);

    expect(res.body.users.length).toBeLessThanOrEqual(10);
  });

  it("query rỗng vẫn bị từ chối", async () => {
    const { me } = await seed();

    await authedAgent(me).get("/api/users/search").query({ username: "  " }).expect(400);
  });

  it("chặn toán tử object (?username[$ne]=x)", async () => {
    const { me } = await seed();

    await authedAgent(me).get("/api/users/search?username[$ne]=x").expect(400);
  });

  it("cần đăng nhập", async () => {
    await anonAgent().get("/api/users/search").query({ username: "a" }).expect(401);
  });
});
