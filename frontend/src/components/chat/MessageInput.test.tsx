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

describe("trả lời tin nhắn", () => {
  const parent = {
    _id: "msg-parent",
    conversationId: "convo-1",
    senderId: "user-other",
    sender: { _id: "user-other", displayName: "Bạn bè" },
    kind: "text" as const,
    content: "tin nhắn gốc",
    attachments: [],
    replyTo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deleted: false,
    clientMessageId: null,
  };

  it("hiện dải bối cảnh khi đang trả lời", () => {
    useChatStore.setState({ replyingTo: { "convo-1": parent } });

    setup();

    expect(screen.getByText("Đang trả lời")).toBeInTheDocument();
    expect(screen.getByText("tin nhắn gốc")).toBeInTheDocument();
  });

  it("gửi kèm replyToMessageId", async () => {
    useChatStore.setState({ replyingTo: { "convo-1": parent } });

    const { user, textarea } = setup();
    await user.type(textarea, "câu trả lời");
    await user.keyboard("{Enter}");

    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: "convo-1",
      content: "câu trả lời",
      replyToMessageId: "msg-parent",
    });
  });

  it("Esc huỷ chế độ trả lời", async () => {
    useChatStore.setState({ replyingTo: { "convo-1": parent } });

    const { user, textarea } = setup();
    await user.click(textarea);
    await user.keyboard("{Escape}");

    expect(useChatStore.getState().replyingTo["convo-1"]).toBeUndefined();
  });

  it("nút huỷ cũng thoát chế độ trả lời", async () => {
    useChatStore.setState({ replyingTo: { "convo-1": parent } });

    const { user } = setup();
    await user.click(screen.getByLabelText("Huỷ"));

    expect(useChatStore.getState().replyingTo["convo-1"]).toBeUndefined();
  });
});

describe("chỉnh sửa tin nhắn", () => {
  beforeEach(() => {
    useChatStore.setState({
      editingId: { "convo-1": "msg-1" },
      messages: {
        "convo-1": {
          ids: ["msg-1"],
          byId: {
            "msg-1": {
              _id: "msg-1",
              conversationId: "convo-1",
              senderId: "me",
              sender: null,
              kind: "text",
              content: "nội dung cũ",
              attachments: [],
              replyTo: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              editedAt: null,
              deleted: false,
              clientMessageId: null,
            },
          },
          hasMore: false,
          nextCursor: null,
          status: "loaded",
          error: null,
        },
      },
    } as never);
  });

  it("nạp sẵn nội dung hiện tại vào ô soạn", () => {
    const { textarea } = setup();

    expect((textarea as HTMLTextAreaElement).value).toBe("nội dung cũ");
    expect(screen.getByText("Đang chỉnh sửa")).toBeInTheDocument();
  });

  it("gọi editMessage chứ KHÔNG gửi tin nhắn mới", async () => {
    const editMessage = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ editMessage } as never);

    const { user, textarea } = setup();
    await user.clear(textarea);
    await user.type(textarea, "nội dung mới");
    await user.keyboard("{Enter}");

    expect(editMessage).toHaveBeenCalledWith("msg-1", "nội dung mới");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("không cho gửi tệp đính kèm khi đang sửa", () => {
    setup();

    expect(screen.getByLabelText("Gửi ảnh hoặc video")).toBeDisabled();
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

/**
 * Frontend (Vercel) và backend (Render) không lên bản mới cùng lúc, và Vercel tự
 * deploy khi `main` đổi còn Render thì phải bấm tay — nên frontend gần như luôn
 * đi trước.
 *
 * Backend cũ không biết field `attachment`, và zod strip key lạ. Gửi mỗi
 * `attachment` thì tin nhắn chỉ có ảnh trả 400 EMPTY_MESSAGE, còn tin nhắn có cả
 * chữ lẫn ảnh thì gửi đi MẤT ẢNH mà không báo gì. Nên vẫn phải kèm `imgUrl`.
 */
describe("tương thích ngược với backend chưa deploy", () => {
  const uploadAttachment = vi.fn();

  const sendFile = async (kind: "image" | "video", url: string, type: string) => {
    uploadAttachment.mockResolvedValue({ url, kind, publicId: "pid", mimeType: type });

    const { chatService } = await import("@/services/chatService");
    vi.spyOn(chatService, "uploadAttachment").mockImplementation(uploadAttachment);

    render(<MessageInput selectedConvo={conversation} />);

    const input = screen.getByLabelText("Chọn ảnh hoặc video để gửi");
    await userEvent.setup().upload(input, new File(["x"], `f.${kind}`, { type }));
  };

  it("ảnh gửi kèm cả `imgUrl` lẫn `attachment`", async () => {
    await sendFile("image", "https://cdn.test/a.png", "image/png");

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          imgUrl: "https://cdn.test/a.png",
          attachment: expect.objectContaining({ kind: "image" }),
        }),
      ),
    );
  });

  /*
   * Video thì KHÔNG kèm `imgUrl`.
   *
   * Backend cũ sẽ lưu nó thành `kind: "image"` và client vẽ ra một <img> hỏng —
   * im lặng sai còn tệ hơn báo lỗi. Backend cũ chưa từng nhận video, nên để nó
   * từ chối là đúng.
   */
  it("video KHÔNG kèm `imgUrl`", async () => {
    await sendFile("video", "https://cdn.test/c.mp4", "video/mp4");

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachment: expect.objectContaining({ kind: "video" }) }),
    );
    expect(sendMessage.mock.calls[0][0]).not.toHaveProperty("imgUrl");
  });
});
