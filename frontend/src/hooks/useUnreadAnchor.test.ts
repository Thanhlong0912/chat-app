import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnreadAnchor } from "./useUnreadAnchor";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import type { Message } from "@/types/chat";

const ME = "user-me";
const OTHER = "user-other";
const CID = "convo-1";

/** Mốc thời gian lần đọc trước. */
const READ_AT = "2026-08-18T10:00:00.000Z";

const makeMessage = (id: string, senderId: string, createdAt: string): Message =>
  ({
    _id: id,
    conversationId: CID,
    senderId,
    kind: "text",
    content: id,
    createdAt,
    attachments: [],
    deleted: false,
  }) as unknown as Message;

/** Ba tin cũ (đã đọc) rồi hai tin mới của người khác. */
const seed = (lastReadAt: string | null, unreadCount: number) => {
  const messages = [
    makeMessage("old-1", ME, "2026-08-18T09:00:00.000Z"),
    makeMessage("old-2", OTHER, "2026-08-18T09:30:00.000Z"),
    makeMessage("new-1", OTHER, "2026-08-18T11:00:00.000Z"),
    makeMessage("new-2", OTHER, "2026-08-18T11:05:00.000Z"),
  ];

  useChatStore.setState({
    conversationsById: {
      [CID]: {
        _id: CID,
        type: "direct",
        unreadCount,
        participants: [
          { _id: ME, displayName: "Tôi", avatarUrl: null, lastReadAt },
          { _id: OTHER, displayName: "Người kia", avatarUrl: null, lastReadAt: null },
        ],
      } as never,
    },
    conversationOrder: [CID],
    messages: {
      [CID]: {
        ids: messages.map((m) => m._id),
        byId: Object.fromEntries(messages.map((m) => [m._id, m])),
        hasMore: false,
        nextCursor: null,
        status: "loaded",
        error: null,
      },
    },
  });
};

beforeEach(() => {
  useAuthStore.setState({ accessToken: "t", user: { _id: ME } as never });
  useChatStore.setState({ conversationsById: {}, conversationOrder: [], messages: {} });
});

describe("useUnreadAnchor", () => {
  it("chỉ vào tin nhắn chưa đọc đầu tiên của người khác", () => {
    seed(READ_AT, 2);

    const { result } = renderHook(() => useUnreadAnchor(CID));

    expect(result.current).toBe("new-1");
  });

  it("giữ nguyên vạch sau khi markAsSeen đẩy con trỏ đi", async () => {
    seed(READ_AT, 2);

    const { result, rerender } = renderHook(() => useUnreadAnchor(CID));
    expect(result.current).toBe("new-1");

    // Đây chính là điều xảy ra 400ms sau khi mở: con trỏ nhảy tới tin mới nhất.
    await useChatStore.getState().markAsSeen(CID);
    rerender();

    // Vạch phải đứng yên — nếu tính lại theo lastReadAt mới thì nó biến mất ngay
    // trước mắt người dùng.
    expect(result.current).toBe("new-1");
  });

  it("markAsSeen đẩy luôn lastReadAt của chính mình", async () => {
    seed(READ_AT, 2);

    await useChatStore.getState().markAsSeen(CID);

    const me = useChatStore
      .getState()
      .conversationsById[CID].participants.find((p) => p._id === ME);

    // Server phát read:updated bằng socket.to(...) nên KHÔNG gửi lại cho người
    // đọc; không tự ghi ở đây thì bản sao client đứng yên và vạch chưa đọc chết.
    expect(me?.lastReadAt).toBe("2026-08-18T11:05:00.000Z");
  });

  it("không có vạch khi chưa từng đọc lần nào", () => {
    seed(null, 2);

    const { result } = renderHook(() => useUnreadAnchor(CID));

    expect(result.current).toBeNull();
  });

  it("không có vạch khi đã đọc hết", () => {
    seed(READ_AT, 0);

    const { result } = renderHook(() => useUnreadAnchor(CID));

    expect(result.current).toBeNull();
  });

  it("không chốt khi luồng chưa tải xong, và chốt lại khi có dữ liệu", () => {
    useChatStore.setState({
      conversationsById: {
        [CID]: {
          _id: CID,
          type: "direct",
          unreadCount: 2,
          participants: [{ _id: ME, displayName: "Tôi", avatarUrl: null, lastReadAt: READ_AT }],
        } as never,
      },
      conversationOrder: [CID],
      messages: {
        [CID]: { ids: [], byId: {}, hasMore: false, nextCursor: null, status: "loading", error: null },
      },
    });

    const { result, rerender } = renderHook(() => useUnreadAnchor(CID));
    expect(result.current).toBeNull();

    seed(READ_AT, 2);
    rerender();

    // Chốt trên luồng rỗng sẽ khoá vĩnh viễn ở "không có vạch".
    expect(result.current).toBe("new-1");
  });

  it("đổi cuộc trò chuyện thì không mang vạch cũ sang", () => {
    seed(READ_AT, 2);

    const { result, rerender } = renderHook(({ id }) => useUnreadAnchor(id), {
      initialProps: { id: CID },
    });
    expect(result.current).toBe("new-1");

    rerender({ id: "convo-khac" });

    expect(result.current).toBeNull();
  });
});
