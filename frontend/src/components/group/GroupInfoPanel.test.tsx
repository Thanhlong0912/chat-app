import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroupInfoPanel from "./GroupInfoPanel";
import { useAuthStore } from "@/stores/useAuthStore";
import { useFriendStore } from "@/stores/useFriendStore";
import type { Conversation } from "@/types/chat";

const actions = {
  pending: false,
  leave: vi.fn(),
  remove: vi.fn(),
  addMembers: vi.fn(),
  setRole: vi.fn(),
  removeMember: vi.fn(),
  rename: vi.fn(),
  updateDescription: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
};

vi.mock("@/hooks/useGroupActions", () => ({
  useGroupActions: () => actions,
}));

const conversation = (myRole: Conversation["myRole"]) =>
  ({
    _id: "convo-1",
    type: "group",
    group: { name: "Nhóm test", description: null, avatarUrl: null, createdBy: "owner-1" },
    participants: [
      {
        _id: "owner-1",
        displayName: "Chủ nhóm",
        avatarUrl: null,
        joinedAt: null,
        role: "owner",
        lastReadAt: null,
      },
      {
        _id: "me",
        displayName: "Tôi",
        avatarUrl: null,
        joinedAt: null,
        role: myRole,
        lastReadAt: null,
      },
    ],
    lastMessage: null,
    lastMessageAt: null,
    unreadCounts: {},
    unreadCount: 0,
    myRole,
    seenBy: [],
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as Conversation;

beforeEach(() => {
  // `actions` là object cấp module dùng chung cho cả file — `restoreMocks` chỉ lo
  // cho spy, không lo cho `vi.fn()` tự tạo.
  vi.clearAllMocks();

  useAuthStore.setState({ user: { _id: "me" } } as never);
  useFriendStore.setState({ friends: [] } as never);
  document.body.style.removeProperty("pointer-events");
});

const setup = (myRole: Conversation["myRole"] = "member") => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();

  render(
    <GroupInfoPanel
      conversation={conversation(myRole)}
      open
      onOpenChange={onOpenChange}
    />,
  );

  return { user, onOpenChange };
};

/**
 * Hồi quy cho lỗi "đóng modal xong cả trang bấm không được".
 *
 * Bảng thông tin nhóm là một Sheet, và bên trong nó còn Dialog/AlertDialog nữa —
 * hai lớp modal chồng nhau làm hỏng sổ sách `pointer-events` của Radix và để lại
 * `none` trên thẻ body.
 */
describe("bảng thông tin nhóm", () => {
  it("rời nhóm: đóng hộp xác nhận rồi mới đóng bảng", async () => {
    const { user, onOpenChange } = setup();

    await user.click(screen.getByRole("button", { name: /Rời nhóm/ }));
    await user.click(await screen.findByRole("button", { name: "Rời nhóm" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(actions.leave).toHaveBeenCalled();
    // Sheet chỉ được đóng SAU khi hộp xác nhận đã đóng hẳn.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("huỷ xác nhận thì KHÔNG đóng bảng", async () => {
    const { user, onOpenChange } = setup();

    await user.click(screen.getByRole("button", { name: /Rời nhóm/ }));
    await user.click(await screen.findByRole("button", { name: "Huỷ" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(actions.leave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Bảng vẫn mở, nên <body> vẫn phải khoá — dọn ở đây mới là dọn nhầm.
    expect(screen.getByRole("dialog", { name: "Thông tin nhóm" })).toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("mở rồi đóng 'Thêm thành viên' không khoá trang", async () => {
    const { user } = setup("owner");

    await user.click(screen.getByRole("button", { name: /Thêm thành viên/ }));
    await screen.findByRole("dialog", { name: "Thêm thành viên" });

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Thêm thành viên" })).toBeNull(),
    );

    // Sheet vẫn mở, nên <body> vẫn phải bị khoá — chưa dọn ở bước này.
    expect(screen.getByRole("dialog", { name: "Thông tin nhóm" })).toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe("none");
  });
});
