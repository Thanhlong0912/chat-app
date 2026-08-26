import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatCard from "@/components/chat/ChatCard";

/**
 * Nút menu phải với tới được trên thiết bị cảm ứng.
 *
 * Kiểm tra ở tầng class vì jsdom không mô phỏng hover: điều thực sự cần khẳng
 * định là `opacity-0` CHỈ áp dụng từ `md` trở lên, chứ không phải vô điều kiện.
 */
describe("ChatCard actions trên mobile", () => {
  it("không ẩn nút menu vô điều kiện", () => {
    render(
      <ChatCard
        convoId="c1"
        name="Bạn"
        isActive={false}
        onSelect={() => {}}
        leftSection={null}
        subtitle={null}
        actions={<button type="button">menu</button>}
      />,
    );

    const wrapper = screen.getByText("menu").parentElement!;

    expect(wrapper.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(wrapper.className).toContain("md:opacity-0");
  });
});
