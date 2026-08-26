import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { renderHook } from "@testing-library/react";
import { useChatStore, useConversationIdsByType } from "./useChatStore";
import { useAuthStore } from "./useAuthStore";
import { useSocketStore } from "./useSocketStore";
import type { Conversation, Message } from "@/types/chat";

const API = "http://localhost:5001/api";

const ME = "user-me";
const OTHER = "user-other";

/** Đếm số request thật, để chứng minh các nhánh KHÔNG gọi mạng. */
let requestLog: string[] = [];

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

beforeEach(() => {
  requestLog = [];

  useAuthStore.setState({
    accessToken: "token",
    user: {
      _id: ME,
      username: "me",
      email: "me@example.com",
      displayName: "Tôi",
      avatarUrl: null,
    } as never,
  });

  useChatStore.setState({
    conversationsById: {},
    conversationOrder: [],
    messages: {},
    pending: {},
    drafts: {},
    activeConversationId: null,
    searchQuery: "",
    convoLoading: false,
    creating: false,
    error: null,
  });

  // Mặc định coi như socket không dùng được, để test đi qua đường HTTP.
  useSocketStore.setState({ socket: null, status: "idle" });
});

afterEach(() => server.resetHandlers());

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  _id: "convo-1",
  type: "direct",
  group: null,
  participants: [
    { _id: ME, displayName: "Tôi", avatarUrl: null, joinedAt: null, role: null, lastReadAt: null },
    {
      _id: OTHER,
      displayName: "Bạn",
      avatarUrl: null,
      joinedAt: null,
      role: null,
      lastReadAt: null,
    },
  ],
  lastMessage: null,
  lastMessageAt: "2026-01-01T00:00:00.000Z",
  unreadCounts: {},
  unreadCount: 0,
  myRole: null,
  seenBy: [],
  pinned: false,
  archived: false,
  mutedUntil: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  _id: "msg-1",
  conversationId: "convo-1",
  senderId: OTHER,
  sender: { _id: OTHER, displayName: "Bạn", avatarUrl: null },
  kind: "text",
  content: "chào",
  attachments: [],
  reactions: [],
  replyTo: null,
  createdAt: "2026-01-01T00:01:00.000Z",
  editedAt: null,
  deleted: false,
  clientMessageId: null,
  ...overrides,
});

const seedConversation = (conversation = makeConversation()) => {
  useChatStore.getState().upsertConversation(conversation);
  return conversation;
};

const thread = (id = "convo-1") => useChatStore.getState().messages[id];

describe("gửi tin nhắn lạc quan", () => {
  it("hiện tin nhắn ngay lập tức, trước khi server phản hồi", async () => {
    seedConversation();

    server.use(
      http.post(`${API}/messages/direct`, async () => {
        await delay(50);
        return HttpResponse.json({ message: makeMessage({ _id: "server-1", senderId: ME }) });
      }),
    );

    // Cố tình KHÔNG await: việc chèn bản lạc quan là đồng bộ, và đó chính là điều
    // cần khẳng định — người dùng thấy tin nhắn của mình mà không phải chờ mạng.
    const sending = useChatStore
      .getState()
      .sendMessage({ conversationId: "convo-1", content: "xin chào" });

    const optimistic = thread().byId[thread().ids[0]];
    expect(thread().ids).toHaveLength(1);
    expect(optimistic.content).toBe("xin chào");
    expect(optimistic.status).toBe("sending");
    expect(optimistic._id).toMatch(/^tmp:/);

    await sending;

    // Sau khi server trả về, bản tạm được thay bằng bản thật.
    expect(thread().ids).toEqual(["server-1"]);
  });

  it("thay bản tạm bằng bản server, không tạo bong bóng thứ hai", async () => {
    seedConversation();

    server.use(
      http.post(`${API}/messages/direct`, () =>
        HttpResponse.json({ message: makeMessage({ _id: "server-1", senderId: ME }) }),
      ),
    );

    await useChatStore.getState().sendMessage({ conversationId: "convo-1", content: "một" });

    expect(thread().ids).toEqual(["server-1"]);
    expect(thread().byId["server-1"].status).toBeUndefined();
    expect(useChatStore.getState().pending).toEqual({});
  });

  it("KHÔNG nhân đôi khi bản broadcast về trước ack", async () => {
    seedConversation();

    const clientMessageId = "cid-1";

    server.use(
      http.post(`${API}/messages/direct`, async () => {
        // Mô phỏng: socket broadcast tới trước khi HTTP trả về.
        useChatStore.getState().upsertMessage(
          makeMessage({ _id: "server-1", senderId: ME, clientMessageId }),
        );

        return HttpResponse.json({
          message: makeMessage({ _id: "server-1", senderId: ME, clientMessageId }),
        });
      }),
    );

    await useChatStore
      .getState()
      .sendMessage({ conversationId: "convo-1", content: "một", clientMessageId });

    expect(thread().ids).toEqual(["server-1"]);
  });

  it("giữ lại bong bóng ở trạng thái failed để người dùng gửi lại", async () => {
    seedConversation();

    server.use(
      http.post(`${API}/messages/direct`, () => HttpResponse.json({}, { status: 500 })),
    );

    await useChatStore
      .getState()
      .sendMessage({ conversationId: "convo-1", content: "sẽ lỗi" });

    const message = thread().byId[thread().ids[0]];

    // Bản trước xoá text đã gõ và không có đường nào lấy lại.
    expect(message.status).toBe("failed");
    expect(message.content).toBe("sẽ lỗi");
    expect(Object.keys(useChatStore.getState().pending)).toHaveLength(1);
    expect(useChatStore.getState().error).toBeTruthy();
  });

  it("gửi lại dùng đúng clientMessageId cũ, nên server coi là cùng một tin", async () => {
    seedConversation();

    const seen: string[] = [];

    server.use(
      http.post(`${API}/messages/direct`, async ({ request }) => {
        const body = (await request.json()) as { clientMessageId: string };
        seen.push(body.clientMessageId);

        if (seen.length === 1) return HttpResponse.json({}, { status: 500 });

        return HttpResponse.json({
          message: makeMessage({ _id: "server-1", senderId: ME, clientMessageId: seen[0] }),
        });
      }),
    );

    await useChatStore.getState().sendMessage({ conversationId: "convo-1", content: "thử" });

    const [clientMessageId] = Object.keys(useChatStore.getState().pending);
    await useChatStore.getState().retryMessage(clientMessageId);

    // Cùng một id ở cả hai lần: đó là điều khiến retry idempotent phía server.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(thread().ids).toEqual(["server-1"]);
  });

  it("bỏ tin nhắn lỗi thì xoá cả bong bóng", async () => {
    seedConversation();
    server.use(
      http.post(`${API}/messages/direct`, () => HttpResponse.json({}, { status: 500 })),
    );

    await useChatStore.getState().sendMessage({ conversationId: "convo-1", content: "x" });
    const [clientMessageId] = Object.keys(useChatStore.getState().pending);

    useChatStore.getState().discardFailedMessage(clientMessageId);

    expect(thread().ids).toHaveLength(0);
    expect(useChatStore.getState().pending).toEqual({});
  });
});

describe("upsertMessage", () => {
  it("KHÔNG gọi mạng cho conversation chưa được mở", () => {
    seedConversation();

    server.use(
      http.get(`${API}/conversations/:id/messages`, ({ params }) => {
        requestLog.push(String(params.id));
        return HttpResponse.json({ messages: [], nextCursor: null });
      }),
    );

    useChatStore.getState().upsertMessage(makeMessage());

    // Bản trước tải hẳn 50 tin nhắn cho mỗi conversation chưa mở mà có tin mới —
    // N+1 request cho dữ liệu không ai đang xem.
    expect(requestLog).toEqual([]);
    expect(thread()).toBeUndefined();
  });

  it("thêm vào luồng đã mở", () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": { ids: [], byId: {}, hasMore: false, nextCursor: null, status: "loaded", error: null },
      },
    });

    useChatStore.getState().upsertMessage(makeMessage());

    expect(thread().ids).toEqual(["msg-1"]);
  });

  it("đánh dấu isOwn theo người đang đăng nhập", () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": { ids: [], byId: {}, hasMore: false, nextCursor: null, status: "loaded", error: null },
      },
    });

    useChatStore.getState().upsertMessage(makeMessage({ _id: "a", senderId: ME }));
    useChatStore.getState().upsertMessage(makeMessage({ _id: "b", senderId: OTHER }));

    expect(thread().byId.a.isOwn).toBe(true);
    expect(thread().byId.b.isOwn).toBe(false);
  });

  it("giữ thứ tự theo thời gian dù nhận không đúng thứ tự", () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": { ids: [], byId: {}, hasMore: false, nextCursor: null, status: "loaded", error: null },
      },
    });

    const upsert = useChatStore.getState().upsertMessage;
    upsert(makeMessage({ _id: "c", createdAt: "2026-01-01T00:03:00.000Z" }));
    upsert(makeMessage({ _id: "a", createdAt: "2026-01-01T00:01:00.000Z" }));
    upsert(makeMessage({ _id: "b", createdAt: "2026-01-01T00:02:00.000Z" }));

    expect(thread().ids).toEqual(["a", "b", "c"]);
  });

  it("nhận lại cùng một tin nhắn không tạo bản trùng", () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": { ids: [], byId: {}, hasMore: false, nextCursor: null, status: "loaded", error: null },
      },
    });

    useChatStore.getState().upsertMessage(makeMessage());
    useChatStore.getState().upsertMessage(makeMessage({ content: "đã sửa" }));

    expect(thread().ids).toEqual(["msg-1"]);
    expect(thread().byId["msg-1"].content).toBe("đã sửa");
  });
});

describe("thứ tự conversation", () => {
  it("sắp lại khi có tin nhắn mới, không chờ fetch lại", () => {
    seedConversation(makeConversation({ _id: "a", lastMessageAt: "2026-01-01T00:00:00.000Z" }));
    seedConversation(makeConversation({ _id: "b", lastMessageAt: "2026-01-02T00:00:00.000Z" }));

    expect(useChatStore.getState().conversationOrder).toEqual(["b", "a"]);

    useChatStore
      .getState()
      .updateConversation({ _id: "a", lastMessageAt: "2026-01-03T00:00:00.000Z" });

    // Bản trước map tại chỗ và không bao giờ sắp lại, nên sidebar cũ dần đi.
    expect(useChatStore.getState().conversationOrder).toEqual(["a", "b"]);
  });
});

describe("fetchMessages", () => {
  it("không prepend hai lần khi bị gọi đồng thời", async () => {
    seedConversation();

    let calls = 0;
    server.use(
      http.get(`${API}/conversations/:id/messages`, () => {
        calls += 1;
        return HttpResponse.json({
          messages: [makeMessage({ _id: "m1" }), makeMessage({ _id: "m2" })],
          nextCursor: null,
        });
      }),
    );

    // Sentinel của infinite scroll có thể bắn hai lần liền nhau.
    await Promise.all([
      useChatStore.getState().fetchMessages("convo-1"),
      useChatStore.getState().fetchMessages("convo-1"),
    ]);

    expect(calls).toBe(1);
    expect(thread().ids).toEqual(["m1", "m2"]);
  });

  it("ghi lỗi vào thread thay vì im lặng", async () => {
    seedConversation();
    server.use(
      http.get(`${API}/conversations/:id/messages`, () => HttpResponse.json({}, { status: 500 })),
    );

    await useChatStore.getState().fetchMessages("convo-1");

    expect(thread().status).toBe("error");
    expect(thread().error).toBeTruthy();
  });
});

describe("markAsSeen", () => {
  it("không gọi API khi đã đọc hết", async () => {
    seedConversation(makeConversation({ unreadCount: 0 }));

    server.use(
      http.patch(`${API}/conversations/:id/seen`, ({ params }) => {
        requestLog.push(String(params.id));
        return HttpResponse.json({});
      }),
    );

    await useChatStore.getState().markAsSeen("convo-1");

    expect(requestLog).toEqual([]);
  });

  it("tắt badge ngay và gọi API khi còn tin chưa đọc", async () => {
    seedConversation(makeConversation({ unreadCount: 3, unreadCounts: { [ME]: 3 } }));

    server.use(
      http.patch(`${API}/conversations/:id/seen`, ({ params }) => {
        requestLog.push(String(params.id));
        return HttpResponse.json({ myUnreadCount: 0 });
      }),
    );

    await useChatStore.getState().markAsSeen("convo-1");

    expect(requestLog).toEqual(["convo-1"]);
    expect(useChatStore.getState().conversationsById["convo-1"].unreadCount).toBe(0);
  });
});

describe("applyReadReceipt", () => {
  it("cập nhật con trỏ đã đọc của một thành viên", () => {
    seedConversation();

    useChatStore
      .getState()
      .applyReadReceipt("convo-1", OTHER, "2026-01-05T00:00:00.000Z");

    const participant = useChatStore
      .getState()
      .conversationsById["convo-1"].participants.find((p) => p._id === OTHER);

    expect(participant?.lastReadAt).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("applySync", () => {
  it("ghép các tin nhắn bị bỏ lỡ vào luồng đã mở", () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["m1"],
          byId: { m1: makeMessage({ _id: "m1" }) },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    useChatStore.getState().applySync(
      "convo-1",
      [makeMessage({ _id: "m2", createdAt: "2026-01-01T00:05:00.000Z" })],
      false,
    );

    expect(thread().ids).toEqual(["m1", "m2"]);
  });

  it("khoảng trống quá lớn thì bỏ cache và tải lại", async () => {
    seedConversation();
    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["m1"],
          byId: { m1: makeMessage({ _id: "m1" }) },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    server.use(
      http.get(`${API}/conversations/:id/messages`, () => {
        requestLog.push("refetch");
        return HttpResponse.json({ messages: [makeMessage({ _id: "fresh" })], nextCursor: null });
      }),
    );

    useChatStore.getState().applySync("convo-1", [], true);

    // Ghép một dải còn thiếu sẽ tạo ra luồng có lỗ; tải lại từ đầu là đúng.
    await vi.waitFor(() => expect(requestLog).toContain("refetch"));
    await vi.waitFor(() => expect(thread().ids).toEqual(["fresh"]));
  });
});

describe("bản nháp", () => {
  it("giữ riêng theo từng conversation", () => {
    useChatStore.getState().setDraft("a", "nháp A");
    useChatStore.getState().setDraft("b", "nháp B");

    expect(useChatStore.getState().drafts).toEqual({ a: "nháp A", b: "nháp B" });
  });
});

describe("removeConversation", () => {
  it("dọn cả tin nhắn và bỏ chọn nếu đang mở", () => {
    seedConversation();
    useChatStore.setState({
      activeConversationId: "convo-1",
      messages: {
        "convo-1": { ids: ["m1"], byId: { m1: makeMessage() }, hasMore: false, nextCursor: null, status: "loaded", error: null },
      },
    });

    useChatStore.getState().removeConversation("convo-1");

    expect(useChatStore.getState().conversationsById).toEqual({});
    expect(useChatStore.getState().messages["convo-1"]).toBeUndefined();
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });
});

describe("lọc tìm kiếm cuộc trò chuyện", () => {
  const seedSearchable = () => {
    seedConversation(
      makeConversation({
        _id: "a",
        lastMessageAt: "2026-01-03T00:00:00.000Z",
        participants: [
          { _id: ME, displayName: "Tôi", avatarUrl: null, joinedAt: null, role: null, lastReadAt: null },
          { _id: OTHER, displayName: "Ngọc Mai", avatarUrl: null, joinedAt: null, role: null, lastReadAt: null },
        ] as never,
      }),
    );
    seedConversation(
      makeConversation({
        _id: "b",
        lastMessageAt: "2026-01-02T00:00:00.000Z",
        participants: [
          { _id: ME, displayName: "Tôi", avatarUrl: null, joinedAt: null, role: null, lastReadAt: null },
          { _id: "u3", displayName: "Trần Bình", avatarUrl: null, joinedAt: null, role: null, lastReadAt: null },
        ] as never,
        lastMessage: { _id: "m1", content: "hẹn gặp ở quán cà phê", senderId: "u3" } as never,
      }),
    );
  };

  it("không lọc gì khi ô tìm kiếm rỗng", () => {
    seedSearchable();

    const { result } = renderHook(() => useConversationIdsByType("direct"));

    expect(result.current).toEqual(["a", "b"]);
  });

  it("khớp theo tên thành viên, không phân biệt hoa thường", () => {
    seedSearchable();
    useChatStore.getState().setSearchQuery("ngọc");

    const { result } = renderHook(() => useConversationIdsByType("direct"));

    expect(result.current).toEqual(["a"]);
  });

  it("khớp cả nội dung tin nhắn cuối", () => {
    seedSearchable();
    useChatStore.getState().setSearchQuery("cà phê");

    const { result } = renderHook(() => useConversationIdsByType("direct"));

    expect(result.current).toEqual(["b"]);
  });

  it("vẫn tôn trọng bộ lọc loại: tìm trong nhóm không trả về hội thoại riêng", () => {
    seedSearchable();
    useChatStore.getState().setSearchQuery("ngọc");

    const { result } = renderHook(() => useConversationIdsByType("group"));

    expect(result.current).toEqual([]);
  });

  it("trả về rỗng khi không có gì khớp", () => {
    seedSearchable();
    useChatStore.getState().setSearchQuery("zzzz");

    const { result } = renderHook(() => useConversationIdsByType("direct"));

    expect(result.current).toEqual([]);
  });
});
