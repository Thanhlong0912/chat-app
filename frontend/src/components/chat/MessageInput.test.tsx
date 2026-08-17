import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageInput from "./MessageInput";
import { useChatStore } from "@/stores/useChatStore";
import { useSocketStore } from "@/stores/useSocketStore";
import type { Conversation } from "@/types/chat";

/**
 * `MessageInput` gọi `useSidebar()` gián tiếp không? Không — nhưng nó gọi store,
 * nên chỉ cần reset store là đủ, không cần bọc provider nào.
 */
const conversation: Conversation = {
  _id: "convo-1",
  type: "direct",
  group: null,
  participants: [],
  lastMessage: null,
  lastMessageAt: null,
  unreadCounts: {},
  unreadCount: 0,
  myRole: null,
  seenBy: [],
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn().mockResolvedValue(undefined);

  useChatStore.setState({
    drafts: {},
    sendMessage,
  } as never);

  // Socket không kết nối: emitTyping trở thành no-op, không cần mock gì thêm.
  useSocketStore.setState({ socket: null, status: "idle" });
});

const setup = () => {
  const user = userEvent.setup();
  render(<MessageInput selectedConvo={conversation} />);

  return { user, textarea: screen.getByLabelText("Nội dung tin nhắn") };
};

describe("bàn phím", () => {
  it("Enter gửi tin nhắn", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "xin chào");
    await user.keyboard("{Enter}");

    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: "convo-1",
      content: "xin chào",
    });
  });

  it("Shift+Enter xuống dòng và KHÔNG gửi", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "dòng một");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(textarea, "dòng hai");

    // Bản trước chỉ kiểm tra `e.key === "Enter"`, nên Shift+Enter cũng gửi và không
    // có cách nào viết tin nhắn nhiều dòng.
    expect(sendMessage).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe("dòng một\ndòng hai");
  });

  it("Enter với ô trống không gửi gì", async () => {
    const { user } = setup();

    await user.keyboard("{Enter}");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("chỉ có khoảng trắng thì không gửi", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "    ");
    await user.keyboard("{Enter}");

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("bản nháp", () => {
  it("lưu nội dung đang gõ vào store theo conversation", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "đang soạn");

    expect(useChatStore.getState().drafts["convo-1"]).toBe("đang soạn");
  });

  it("khôi phục nội dung đã soạn khi mount lại", () => {
    useChatStore.setState({ drafts: { "convo-1": "soạn dở" } });

    const { textarea } = setup();

    // Đổi cuộc trò chuyện rồi quay lại không được mất nội dung đang gõ.
    expect((textarea as HTMLTextAreaElement).value).toBe("soạn dở");
  });

  it("xoá nháp sau khi gửi", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "gửi đi");
    await user.keyboard("{Enter}");

    expect(useChatStore.getState().drafts["convo-1"]).toBe("");
  });
});

describe("nút gửi", () => {
  it("bị vô hiệu khi chưa có nội dung", () => {
    setup();

    expect(screen.getByLabelText("Gửi tin nhắn")).toBeDisabled();
  });

  it("bật lên khi đã có nội dung", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "a");

    expect(screen.getByLabelText("Gửi tin nhắn")).toBeEnabled();
  });

  it("gửi khi bấm", async () => {
    const { user, textarea } = setup();

    await user.type(textarea, "bấm gửi");
    await user.click(screen.getByLabelText("Gửi tin nhắn"));

    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: "convo-1",
      content: "bấm gửi",
    });
  });
});

describe("phát trạng thái đang nhập", () => {
  it("gọi emitTyping khi bắt đầu gõ", async () => {
    const emitTyping = vi.fn();
    useSocketStore.setState({ emitTyping } as never);

    const { user, textarea } = setup();
    await user.type(textarea, "a");

    expect(emitTyping).toHaveBeenCalledWith("convo-1", true);
  });

  it("dừng phát khi gửi xong", async () => {
    const emitTyping = vi.fn();
    useSocketStore.setState({ emitTyping } as never);

    const { user, textarea } = setup();
    await user.type(textarea, "a");
    await user.keyboard("{Enter}");

    expect(emitTyping).toHaveBeenCalledWith("convo-1", false);
  });
});
