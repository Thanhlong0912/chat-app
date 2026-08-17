import { describe, expect, it } from "vitest";
import { authedAgent } from "./helpers/authedAgent.js";
import {
  makeDirectConversation,
  makeMessagesAt,
  makeUser,
} from "./helpers/factories.js";

/**
 * Phân trang tin nhắn.
 *
 * Trọng tâm là tính chất: lật hết các trang phải thu được đúng tập tin nhắn đã
 * seed — không thiếu, không trùng. Cursor chỉ dựa trên timestamp không đảm bảo
 * được điều đó khi nhiều tin nhắn trùng millisecond, và đó là trường hợp thật:
 * `insertMany` hay một vòng lặp gửi nhanh đều tạo ra tin nhắn cùng mốc ms.
 */

/** Lật hết các trang, trả về danh sách content theo thứ tự cũ → mới. */
const drainPages = async (agent, conversationId, { limit = 20 } = {}) => {
  const pages = [];
  let cursor = "";
  let guard = 0;

  for (;;) {
    if (++guard > 50) throw new Error("phân trang không kết thúc");

    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);

    const res = await agent
      .get(`/api/conversations/${conversationId}/messages?${query}`)
      .expect(200);

    pages.push(res.body.messages);

    if (!res.body.nextCursor) break;
    cursor = res.body.nextCursor;
  }

  // Các trang được lấy theo chiều mới → cũ, còn trong mỗi trang lại là cũ → mới.
  // Client prepend trang cũ hơn lên đầu, nên thứ tự thời gian thật là các trang
  // đảo ngược rồi nối lại.
  return { pages, all: [...pages].reverse().flat() };
};

const setup = async () => {
  const [alice, bob] = await Promise.all([makeUser(), makeUser()]);
  const convo = await makeDirectConversation(alice, bob);

  return { alice, bob, convo, agent: authedAgent(alice) };
};

describe("phân trang tin nhắn", () => {
  it("lật hết các trang thu được đúng tập tin nhắn, khi timestamp phân biệt", async () => {
    const { alice, convo, agent } = await setup();

    const base = Date.now();
    const timestamps = Array.from({ length: 55 }, (_, i) => new Date(base + i * 1000));
    await makeMessagesAt(convo, alice, timestamps);

    const { all } = await drainPages(agent, convo._id);

    expect(all).toHaveLength(55);
    expect(new Set(all.map((m) => m._id)).size).toBe(55);
  });

  it("KHÔNG bỏ sót hay lặp tin nhắn trùng millisecond", async () => {
    const { alice, convo, agent } = await setup();

    // 30 tin nhắn cùng đúng một mốc thời gian, nằm giữa hai nhóm có mốc riêng.
    // Với cursor kiểu `createdAt < cursor`, cả 30 tin này chia sẽ một giá trị
    // cursor duy nhất, nên hoặc bị bỏ qua hàng loạt, hoặc lặp vô hạn.
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const timestamps = [
      ...Array.from({ length: 60 }, (_, i) => new Date(base + i)),
      ...Array.from({ length: 30 }, () => new Date(base + 500)),
      ...Array.from({ length: 60 }, (_, i) => new Date(base + 1000 + i)),
    ];

    const inserted = await makeMessagesAt(convo, alice, timestamps);
    const expectedIds = new Set(inserted.map((m) => String(m._id)));

    const { all } = await drainPages(agent, convo._id, { limit: 20 });
    const seenIds = all.map((m) => String(m._id));

    // Không trùng.
    expect(new Set(seenIds).size).toBe(seenIds.length);
    // Không thiếu.
    expect(new Set(seenIds)).toEqual(expectedIds);
    expect(seenIds).toHaveLength(150);
  });

  it("giữ thứ tự tăng dần và ổn định qua các trang", async () => {
    const { alice, convo, agent } = await setup();

    const base = new Date("2026-02-01T00:00:00.000Z").getTime();
    const timestamps = [
      ...Array.from({ length: 25 }, () => new Date(base)),
      ...Array.from({ length: 25 }, () => new Date(base + 10)),
    ];
    await makeMessagesAt(convo, alice, timestamps);

    const { all } = await drainPages(agent, convo._id, { limit: 10 });

    // Trong mỗi trang và xuyên các trang, thứ tự phải không giảm theo
    // (createdAt, _id) — đó là thứ tự tổng ta cam kết.
    for (let i = 1; i < all.length; i += 1) {
      const prev = all[i - 1];
      const curr = all[i];
      const prevKey = [new Date(prev.createdAt).getTime(), String(prev._id)];
      const currKey = [new Date(curr.createdAt).getTime(), String(curr._id)];

      const inOrder =
        prevKey[0] < currKey[0] || (prevKey[0] === currKey[0] && prevKey[1] < currKey[1]);

      expect(inOrder).toBe(true);
    }
  });

  it("trang cuối trả nextCursor null", async () => {
    const { alice, convo, agent } = await setup();

    await makeMessagesAt(
      convo,
      alice,
      Array.from({ length: 5 }, (_, i) => new Date(Date.now() + i * 1000)),
    );

    const res = await agent
      .get(`/api/conversations/${convo._id}/messages?limit=20`)
      .expect(200);

    expect(res.body.messages).toHaveLength(5);
    expect(res.body.nextCursor).toBeNull();
  });

  it("conversation rỗng trả mảng rỗng, không lỗi", async () => {
    const { convo, agent } = await setup();

    const res = await agent
      .get(`/api/conversations/${convo._id}/messages`)
      .expect(200);

    expect(res.body.messages).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("cursor rác bị từ chối chứ không trả dữ liệu sai", async () => {
    const { alice, convo, agent } = await setup();

    await makeMessagesAt(convo, alice, [new Date()]);

    const res = await agent.get(
      `/api/conversations/${convo._id}/messages?cursor=khong-phai-cursor`,
    );

    // Cursor không đọc được là lỗi của client; không được âm thầm trả trang đầu
    // như thể không có cursor.
    expect(res.status).toBe(400);
  });

  it("trả kèm thông tin người gửi", async () => {
    const { alice, convo, agent } = await setup();

    await makeMessagesAt(convo, alice, [new Date()]);

    const res = await agent
      .get(`/api/conversations/${convo._id}/messages`)
      .expect(200);

    // Không có cái này thì client phải tự tra participants và không có gì để
    // hiển thị cho thành viên đã rời nhóm.
    expect(res.body.messages[0].sender).toMatchObject({
      _id: String(alice._id),
      displayName: alice.displayName,
    });
  });
});
