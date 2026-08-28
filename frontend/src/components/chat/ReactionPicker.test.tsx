import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReactionPicker from "./ReactionPicker";
import { useChatStore } from "@/stores/useChatStore";
import { REACTION_EMOJIS } from "@/types/chat";

const setup = () =>
  render(
    <ReactionPicker
      conversationId="convo-1"
      messageId="msg-1"
    />,
  );

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ReactionPicker", () => {
  it("mở ra đúng sáu emoji server chấp nhận, không hơn", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Thả biểu cảm" }));

    for (const emoji of REACTION_EMOJIS) {
      expect(screen.getByRole("button", { name: `Thả biểu cảm ${emoji}` })).toBeInTheDocument();
    }
  });

  it("gọi toggleReaction với đúng emoji được bấm", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    vi.spyOn(useChatStore, "getState").mockReturnValue({
      toggleReaction: toggle,
    } as never);

    setup();

    await user.click(screen.getByRole("button", { name: "Thả biểu cảm" }));
    await user.click(screen.getByRole("button", { name: "Thả biểu cảm ❤️" }));

    expect(toggle).toHaveBeenCalledWith("convo-1", "msg-1", "❤️");
  });

  /*
   * Bảng chọn phải tự đóng.
   *
   * Bản trước để popover không kiểm soát, nên sau khi bấm nó vẫn mở — che đúng chỗ
   * chip vừa xuất hiện, và người dùng phải bấm ra ngoài mới đóng được.
   */
  it("tự đóng sau khi chọn một emoji", async () => {
    const user = userEvent.setup();
    vi.spyOn(useChatStore, "getState").mockReturnValue({
      toggleReaction: vi.fn(),
    } as never);

    setup();

    await user.click(screen.getByRole("button", { name: "Thả biểu cảm" }));
    expect(screen.getByRole("button", { name: "Thả biểu cảm 👍" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Thả biểu cảm 👍" }));

    expect(screen.queryByRole("button", { name: "Thả biểu cảm 👍" })).not.toBeInTheDocument();
  });
});
