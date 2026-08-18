import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageActions from "./MessageActions";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import type { Conversation, Message } from "@/types/chat";

const conversation = {
  _id: "convo-1",
  type: "group",
  group: { name: "Nhóm test", description: null, avatarUrl: null, createdBy: "me" },
  participants: [],
  lastMessage: null,
  lastMessageAt: null,
  unreadCounts: {},
  unreadCount: 0,
  myRole: "owner",
  seenBy: [],
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Conversation;

const message = {
  _id: "msg-1",
  conversationId: "convo-1",
  senderId: "me",
  kind: "text",
  content: "xin chào",
  createdAt: new Date().toISOString(),
} as Message;

let deleteMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  deleteMessage = vi.fn().mockResolvedValue(undefined);

  useAuthStore.setState({ user: { _id: "me" } } as never);
  useChatStore.setState({ deleteMessage } as never);

  document.body.style.removeProperty("pointer-events");
});

const openMenu = async () => {
  const user = userEvent.setup();
  render(
    <MessageActions
      message={message}
      conversation={conversation}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Thêm tuỳ chọn" }));
  return user;
};

/**
 * Hồi quy cho lỗi "đóng modal xong cả trang bấm không được".
 *
 * Menu ở chế độ modal và `ConfirmDialog` mở ngay sau nó là hai lớp chồng nhau; sổ
 * sách `pointer-events` của Radix khi đó để lại `none` trên <body> vĩnh viễn.
 */
describe("xoá tin nhắn", () => {
  it("trả lại tương tác cho trang sau khi xác nhận", async () => {
    const user = await openMenu();

    await user.click(await screen.findByText("Xoá"));
    await user.click(await screen.findByRole("button", { name: "Xoá" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));

    expect(deleteMessage).toHaveBeenCalledWith("convo-1", "msg-1");
  });

  it("trả lại tương tác cho trang sau khi huỷ", async () => {
    const user = await openMenu();

    await user.click(await screen.findByText("Xoá"));
    await user.click(await screen.findByRole("button", { name: "Huỷ" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));

    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
