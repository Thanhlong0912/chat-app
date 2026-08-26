import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { renderHook } from "@testing-library/react";
import { useArchivedCount, useChatStore, useConversationIdsByType } from "./useChatStore";
import { useAuthStore } from "./useAuthStore";
import { useSocketStore } from "./useSocketStore";
import type { Conversation } from "@/types/chat";

const API = "http://localhost:5001/api";
const ME = "user-me";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    _id: "convo-1",
    type: "direct",
    group: null,
    participants: [],
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
  }) as unknown as Conversation;

/** Nạp một tập conversation vào store, đã sắp thứ tự đúng như fetch thật. */
const seed = (conversations: Conversation[]) => {
  const byId: Record<string, Conversation> = {};
  conversations.forEach((c) => {
    byId[c._id] = c;
  });

  useChatStore.setState({ conversationsById: byId, conversationOrder: [] });
  // Đi qua upsert để `sortOrder` thật được chạy, thay vì tự bịa thứ tự.
  conversations.forEach((c) => useChatStore.getState().upsertConversation(c));
};

beforeEach(() => {
  useAuthStore.setState({
    accessToken: "token",
    user: { _id: ME, displayName: "Tôi" } as never,
  });

  useChatStore.setState({
    conversationsById: {},
    conversationOrder: [],
    messages: {},
    pending: {},
    searchQuery: "",
    error: null,
  });

  useSocketStore.setState({ socket: null, status: "idle" });
});

describe("thứ tự: ghim lên đầu", () => {
  it("cuộc trò chuyện được ghim đứng trước, dù hoạt động cũ hơn", () => {
    seed([
      makeConversation({
        _id: "moi",
        lastMessageAt: "2026-06-01T00:00:00.000Z",
      }),
      makeConversation({
        _id: "cu-nhung-ghim",
        lastMessageAt: "2026-01-01T00:00:00.000Z",
        pinned: true,
      }),
    ]);

    expect(useChatStore.getState().conversationOrder).toEqual(["cu-nhung-ghim", "moi"]);
  });

  it("trong cùng nhóm ghim, vẫn sắp theo hoạt động mới nhất", () => {
    seed([
      makeConversation({ _id: "ghim-cu", pinned: true, lastMessageAt: "2026-01-01T00:00:00.000Z" }),
      makeConversation({ _id: "ghim-moi", pinned: true, lastMessageAt: "2026-06-01T00:00:00.000Z" }),
      makeConversation({ _id: "thuong", lastMessageAt: "2026-07-01T00:00:00.000Z" }),
    ]);

    expect(useChatStore.getState().conversationOrder).toEqual([
      "ghim-moi",
      "ghim-cu",
      "thuong",
    ]);
  });
});

describe("lọc lưu trữ", () => {
  it("danh sách chính bỏ qua các cuộc trò chuyện đã lưu trữ", () => {
    seed([
      makeConversation({ _id: "hien" }),
      makeConversation({ _id: "da-luu-tru", archived: true }),
    ]);

    const { result } = renderHook(() => useConversationIdsByType("direct"));

    expect(result.current).toEqual(["hien"]);
  });

  it("ngăn lưu trữ hiện đúng phần còn lại", () => {
    seed([
      makeConversation({ _id: "hien" }),
      makeConversation({ _id: "da-luu-tru", archived: true }),
    ]);

    const { result } = renderHook(() =>
      useConversationIdsByType("direct", { archived: true }),
    );

    expect(result.current).toEqual(["da-luu-tru"]);
  });

  it("useArchivedCount đếm đúng, kể cả khác loại conversation", () => {
    seed([
      makeConversation({ _id: "a", archived: true }),
      makeConversation({ _id: "b", type: "group", archived: true }),
      makeConversation({ _id: "c" }),
    ]);

    const { result } = renderHook(() => useArchivedCount());

    expect(result.current).toBe(2);
  });
});

describe("updateConversationSettings", () => {
  it("cập nhật lạc quan rồi chốt bằng bản server", async () => {
    seed([makeConversation()]);

    server.use(
      http.patch(`${API}/conversations/:id/settings`, () =>
        HttpResponse.json({ conversation: makeConversation({ pinned: true }) }),
      ),
    );

    const promise = useChatStore
      .getState()
      .updateConversationSettings("convo-1", { pinned: true });

    // Trước khi server trả lời — đây là bản lạc quan.
    expect(useChatStore.getState().conversationsById["convo-1"].pinned).toBe(true);

    await promise;
    expect(useChatStore.getState().conversationsById["convo-1"].pinned).toBe(true);
  });

  it("ghim lạc quan cũng đẩy thứ tự lên đầu ngay", async () => {
    seed([
      makeConversation({ _id: "moi", lastMessageAt: "2026-06-01T00:00:00.000Z" }),
      makeConversation({ _id: "cu", lastMessageAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    server.use(
      http.patch(`${API}/conversations/:id/settings`, () =>
        HttpResponse.json({
          conversation: makeConversation({
            _id: "cu",
            pinned: true,
            lastMessageAt: "2026-01-01T00:00:00.000Z",
          }),
        }),
      ),
    );

    await useChatStore.getState().updateConversationSettings("cu", { pinned: true });

    expect(useChatStore.getState().conversationOrder).toEqual(["cu", "moi"]);
  });

  it("hoàn tác về giá trị cũ khi request thất bại", async () => {
    seed([makeConversation({ pinned: true, archived: false })]);

    server.use(
      http.patch(`${API}/conversations/:id/settings`, () =>
        HttpResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 }),
      ),
    );

    await useChatStore.getState().updateConversationSettings("convo-1", { pinned: false });

    // Trả về `true` như trước khi bấm, không phải giá trị mặc định `false`.
    expect(useChatStore.getState().conversationsById["convo-1"].pinned).toBe(true);
  });

  it("bỏ qua conversation không có trong store thay vì gọi mạng", async () => {
    let called = false;

    server.use(
      http.patch(`${API}/conversations/:id/settings`, () => {
        called = true;
        return HttpResponse.json({ conversation: makeConversation() });
      }),
    );

    await useChatStore
      .getState()
      .updateConversationSettings("khong-ton-tai", { pinned: true });

    expect(called).toBe(false);
  });
});
