import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddFriendModal from "./AddFriendModal";
import { useFriendStore } from "@/stores/useFriendStore";
import type { User } from "@/types/user";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const alice = {
  _id: "alice-id",
  username: "alice",
  displayName: "Alice Nguyễn",
} as User;

let searchByUsername: ReturnType<typeof vi.fn>;
let addFriend: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();

  searchByUsername = vi.fn().mockResolvedValue([alice]);
  addFriend = vi.fn().mockResolvedValue("Gửi lời mời kết bạn thành công");

  useFriendStore.setState({ searchByUsername, addFriend, loading: false } as never);
});

const open = async () => {
  const user = userEvent.setup();
  render(<AddFriendModal />);

  await user.click(screen.getByRole("button", { name: "Kết bạn" }));
  return user;
};

describe("tìm bạn bè", () => {
  it("một ký tự đã đủ để gọi tìm kiếm", async () => {
    const user = await open();

    await user.type(screen.getByLabelText(/Tìm bằng username/), "a");

    // Trước đây phải bấm nút "Tìm" và backend khớp username tuyệt đối, nên gõ một
    // chữ không bao giờ ra kết quả.
    await waitFor(() => expect(searchByUsername).toHaveBeenCalledWith("a"));
    expect(await screen.findByText("Alice Nguyễn")).toBeInTheDocument();
  });

  it("gộp các phím gõ liên tiếp thành một lượt tìm", async () => {
    const user = await open();

    await user.type(screen.getByLabelText(/Tìm bằng username/), "ali");

    await waitFor(() => expect(searchByUsername).toHaveBeenCalled());

    // Debounce: ba ký tự gõ liền nhau chỉ nên tạo một request, không phải ba.
    expect(searchByUsername).toHaveBeenCalledTimes(1);
    expect(searchByUsername).toHaveBeenCalledWith("ali");
  });

  it("ô rỗng thì không gọi tìm kiếm", async () => {
    const user = await open();

    const input = screen.getByLabelText(/Tìm bằng username/);
    await user.type(input, "a");
    await waitFor(() => expect(searchByUsername).toHaveBeenCalled());

    searchByUsername.mockClear();
    await user.clear(input);

    await waitFor(() => expect(screen.queryByText("Alice Nguyễn")).not.toBeInTheDocument());
    expect(searchByUsername).not.toHaveBeenCalled();
  });

  it("báo rõ khi không tìm thấy ai", async () => {
    searchByUsername.mockResolvedValue([]);
    const user = await open();

    await user.type(screen.getByLabelText(/Tìm bằng username/), "zzz");

    expect(await screen.findByText(/Không tìm thấy ai khớp/)).toBeInTheDocument();
  });
});

describe("gửi lời mời kết bạn", () => {
  const selectAlice = async () => {
    const user = await open();

    await user.type(screen.getByLabelText(/Tìm bằng username/), "a");
    await user.click(await screen.findByRole("button", { name: /Alice Nguyễn/ }));

    return user;
  };

  it("chọn một người rồi gửi được lời mời", async () => {
    const user = await selectAlice();

    await user.click(screen.getByRole("button", { name: /Kết Bạn/ }));

    await waitFor(() => expect(addFriend).toHaveBeenCalledWith("alice-id", ""));
    expect(toastSuccess).toHaveBeenCalledWith("Gửi lời mời kết bạn thành công");
  });

  /**
   * Hồi quy cho lỗi "gửi lời mời báo thành công nhưng không có gì được gửi".
   *
   * `useFriendStore.addFriend` từng bắt lỗi rồi `return describeError(error)` —
   * đúng vị trí mà thành công trả về chuỗi thông báo. Chỗ gọi không phân biệt
   * được, nên nội dung LỖI hiện lên dưới dạng toast xanh và modal đóng lại.
   */
  it("thất bại hiện toast LỖI, không phải toast thành công", async () => {
    addFriend.mockRejectedValue(new Error("Đã có lời mời kết bạn đang chờ"));
    const user = await selectAlice();

    await user.click(screen.getByRole("button", { name: /Kết Bạn/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Đã có lời mời kết bạn đang chờ"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("thất bại thì giữ modal mở để thử lại", async () => {
    addFriend.mockRejectedValue(new Error("Đã có lời mời kết bạn đang chờ"));
    const user = await selectAlice();

    await user.click(screen.getByRole("button", { name: /Kết Bạn/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("quay lại được về danh sách kết quả", async () => {
    const user = await selectAlice();

    await user.click(screen.getByRole("button", { name: "Quay lại" }));

    expect(screen.getByLabelText(/Tìm bằng username/)).toBeInTheDocument();
  });
});
