import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageReactions from "./MessageReactions";
import { useChatStore } from "@/stores/useChatStore";
import type { Message, ReactionGroup } from "@/types/chat";

const message = {
  _id: "msg-1",
  conversationId: "convo-1",
  senderId: "ban",
  sender: { _id: "ban", displayName: "Bạn", avatarUrl: null },
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

const seed = (reactions: ReactionGroup[]) => {
  useChatStore.setState({
    messages: {
      "convo-1": {
        ids: ["msg-1"],
        byId: { "msg-1": { ...message, reactions } },
        hasMore: false,
        nextCursor: null,
        status: "loaded",
        error: null,
      },
    },
  });
};

const setup = () =>
  render(
    <MessageReactions
      conversationId="convo-1"
      messageId="msg-1"
      align="start"
    />,
  );

beforeEach(() => {
  useChatStore.setState({ messages: {} });
  vi.restoreAllMocks();
});

describe("MessageReactions", () => {
  it("không render gì khi chưa có biểu cảm nào", () => {
    seed([]);

    const { container } = setup();

    expect(container).toBeEmptyDOMElement();
  });

  it("hiện emoji kèm số lượt", () => {
    seed([{ emoji: "👍", count: 3, reactedByMe: false }]);

    setup();

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("aria-pressed phản ánh việc mình đã thả hay chưa", () => {
    seed([
      { emoji: "👍", count: 1, reactedByMe: true },
      { emoji: "❤️", count: 2, reactedByMe: false },
    ]);

    setup();

    const [mine, theirs] = screen.getAllByRole("button");

    expect(mine).toHaveAttribute("aria-pressed", "true");
    expect(theirs).toHaveAttribute("aria-pressed", "false");
  });

  it("nhãn đọc được nói rõ số lượt và trạng thái, không chỉ dựa vào màu", () => {
    seed([{ emoji: "👍", count: 2, reactedByMe: true }]);

    setup();

    expect(
      screen.getByRole("button", { name: "👍, 2 lượt, bạn đã thả" }),
    ).toBeInTheDocument();
  });

  it("bấm vào chip gọi toggleReaction với đúng emoji", async () => {
    seed([{ emoji: "😂", count: 1, reactedByMe: false }]);

    const toggle = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ toggleReaction: toggle });

    setup();
    await userEvent.click(screen.getByRole("button"));

    expect(toggle).toHaveBeenCalledWith("convo-1", "msg-1", "😂");
  });

  it("vẽ lại khi store đổi, nhờ đăng ký hẹp vào đúng tin nhắn", () => {
    seed([{ emoji: "👍", count: 1, reactedByMe: false }]);

    setup();
    expect(screen.getByText("1")).toBeInTheDocument();

    // `act` để React kịp flush lần cập nhật store xảy ra NGOÀI một sự kiện —
    // không có nó thì assertion chạy trước lần render lại.
    act(() => seed([{ emoji: "👍", count: 2, reactedByMe: true }]));

    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
