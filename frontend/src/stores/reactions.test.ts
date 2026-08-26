import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useChatStore } from "./useChatStore";
import { useAuthStore } from "./useAuthStore";
import { useSocketStore } from "./useSocketStore";
import type { Conversation, Message, ReactionGroup } from "@/types/chat";

const API = "http://localhost:5001/api";

const ME = "user-me";
const OTHER = "user-other";

let requestLog: string[] = [];

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const conversation = {
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
} as unknown as Conversation;

const message = {
  _id: "msg-1",
  conversationId: "convo-1",
  senderId: OTHER,
  sender: { _id: OTHER, displayName: "Bạn", avatarUrl: null },
  kind: "text",
  content: "chào",
  attachments: [],
  reactions: [],
  replyTo: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  editedAt: null,
  deleted: false,
  clientMessageId: null,
} as unknown as Message;

const reactionsOf = (messageId = "msg-1") =>
  useChatStore.getState().messages["convo-1"]?.byId[messageId]?.reactions;

beforeEach(() => {
  requestLog = [];

  useAuthStore.setState({
    accessToken: "token",
    user: { _id: ME, displayName: "Tôi" } as never,
  });

  useChatStore.setState({
    conversationsById: { "convo-1": conversation },
    conversationOrder: ["convo-1"],
    messages: {
      "convo-1": {
        ids: ["msg-1"],
        byId: { "msg-1": message },
        hasMore: false,
        nextCursor: null,
        status: "loaded",
        error: null,
      },
    },
    pending: {},
    error: null,
  });

  // Socket coi như không dùng được, để test đi qua đường HTTP dự phòng.
  useSocketStore.setState({ socket: null, status: "idle" });
});

describe("toggleReaction", () => {
  it("vẽ lạc quan ngay, trước khi server trả lời", async () => {
    server.use(
      http.put(`${API}/messages/:id/reactions`, () =>
        HttpResponse.json({ reactions: [{ emoji: "👍", count: 1, reactedByMe: true }], active: true }),
      ),
    );

    const promise = useChatStore.getState().toggleReaction("convo-1", "msg-1", "👍");

    // Chưa await: đây chính là bản lạc quan.
    expect(reactionsOf()).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);

    await promise;
    expect(reactionsOf()).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
  });

  it("bấm lại chính emoji đã thả thì gỡ, và nhóm biến mất", async () => {
    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["msg-1"],
          byId: {
            "msg-1": {
              ...message,
              reactions: [{ emoji: "👍", count: 1, reactedByMe: true }],
            },
          },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    server.use(
      http.put(`${API}/messages/:id/reactions`, () =>
        HttpResponse.json({ reactions: [], active: false }),
      ),
    );

    await useChatStore.getState().toggleReaction("convo-1", "msg-1", "👍");

    expect(reactionsOf()).toEqual([]);
  });

  it("gỡ lượt của mình khi người khác vẫn thả thì chỉ giảm count", async () => {
    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["msg-1"],
          byId: {
            "msg-1": { ...message, reactions: [{ emoji: "❤️", count: 3, reactedByMe: true }] },
          },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    server.use(
      http.put(`${API}/messages/:id/reactions`, () =>
        HttpResponse.json({ reactions: [{ emoji: "❤️", count: 2, reactedByMe: false }], active: false }),
      ),
    );

    await useChatStore.getState().toggleReaction("convo-1", "msg-1", "❤️");

    expect(reactionsOf()).toEqual([{ emoji: "❤️", count: 2, reactedByMe: false }]);
  });

  it("hoàn tác về đúng bản cũ khi request thất bại", async () => {
    const before: ReactionGroup[] = [{ emoji: "👍", count: 2, reactedByMe: false }];

    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["msg-1"],
          byId: { "msg-1": { ...message, reactions: before } },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    server.use(
      http.put(`${API}/messages/:id/reactions`, () =>
        HttpResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 }),
      ),
    );

    await useChatStore.getState().toggleReaction("convo-1", "msg-1", "👍");

    expect(reactionsOf()).toEqual(before);
    expect(useChatStore.getState().error).toBeTruthy();
  });

  it("không gọi mạng cho tin nhắn lạc quan chưa có id thật", async () => {
    server.use(
      http.put(`${API}/messages/:id/reactions`, ({ request }) => {
        requestLog.push(request.url);
        return HttpResponse.json({ reactions: [], active: false });
      }),
    );

    await useChatStore.getState().toggleReaction("convo-1", "tmp:abc", "👍");

    expect(requestLog).toEqual([]);
  });
});

describe("applyReaction — bản broadcast từ socket", () => {
  it("người KHÁC thả thì count tăng nhưng reactedByMe của mình không đổi", () => {
    useChatStore
      .getState()
      .applyReaction("convo-1", "msg-1", [{ emoji: "👍", count: 1 }], OTHER, "👍", true);

    expect(reactionsOf()).toEqual([{ emoji: "👍", count: 1, reactedByMe: false }]);
  });

  it("chính mình thả từ tab khác thì reactedByMe bật lên", () => {
    useChatStore
      .getState()
      .applyReaction("convo-1", "msg-1", [{ emoji: "👍", count: 1 }], ME, "👍", true);

    expect(reactionsOf()).toEqual([{ emoji: "👍", count: 1, reactedByMe: true }]);
  });

  it("giữ nguyên cờ của mình trên các emoji khác trong cùng payload", () => {
    useChatStore.setState({
      messages: {
        "convo-1": {
          ids: ["msg-1"],
          byId: {
            "msg-1": { ...message, reactions: [{ emoji: "❤️", count: 1, reactedByMe: true }] },
          },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    });

    useChatStore.getState().applyReaction(
      "convo-1",
      "msg-1",
      [
        { emoji: "❤️", count: 1 },
        { emoji: "😂", count: 1 },
      ],
      OTHER,
      "😂",
      true,
    );

    expect(reactionsOf()).toEqual([
      { emoji: "❤️", count: 1, reactedByMe: true },
      { emoji: "😂", count: 1, reactedByMe: false },
    ]);
  });

  it("bỏ qua tin nhắn chưa được tải — không dựng thread rỗng", () => {
    useChatStore
      .getState()
      .applyReaction("convo-1", "msg-chua-tai", [{ emoji: "👍", count: 1 }], OTHER, "👍", true);

    expect(useChatStore.getState().messages["convo-1"].ids).toEqual(["msg-1"]);
  });
});
