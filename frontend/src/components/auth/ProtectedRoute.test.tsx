import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";
import { useAuthStore } from "@/stores/useAuthStore";
import { useChatStore } from "@/stores/useChatStore";
import type { User } from "@/types/user";

const long = { _id: "long-id", username: "long" } as User;

// Backend đang ngủ: request đánh thức treo 20–50 giây. Đây mới là trường hợp cần
// kiểm tra — lúc nó trả lời nhanh thì kiểu gì cũng ổn.
const coldBackend = () => vi.fn(() => new Promise<void>(() => {}));

const seed = (user: User | null, refresh: ReturnType<typeof vi.fn>) => {
  useAuthStore.setState({
    accessToken: null,
    user,
    loading: false,
    refresh,
    fetchMe: vi.fn(),
  } as never);

  useChatStore.setState({ fetchConversations: vi.fn() } as never);
};

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route
            path="/"
            element={<div>Ứng dụng</div>}
          />
        </Route>
        <Route
          path="/signin"
          element={<div>Màn hình đăng nhập</div>}
        />
      </Routes>
    </MemoryRouter>
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("khách chưa từng đăng nhập trên máy này", () => {
  beforeEach(() => {
    seed(null, coldBackend());
  });

  it("thấy màn hình đăng nhập ngay, không phải chờ backend tỉnh", () => {
    renderGate();

    expect(screen.getByText("Màn hình đăng nhập")).toBeInTheDocument();
    expect(screen.queryByText("Đang tải trang...")).not.toBeInTheDocument();
  });

  it("vẫn thử khôi phục phiên ở chạy nền, phòng khi cookie refresh còn hạn", () => {
    const refresh = coldBackend();
    seed(null, refresh);

    renderGate();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("máy đã từng đăng nhập", () => {
  it("chờ khôi phục phiên thay vì đá thẳng ra màn hình đăng nhập", () => {
    seed(long, coldBackend());

    renderGate();

    expect(screen.getByText("Đang tải trang...")).toBeInTheDocument();
    expect(screen.queryByText("Màn hình đăng nhập")).not.toBeInTheDocument();
  });

  it("chờ quá lâu thì nói cho người dùng biết server đang được đánh thức", () => {
    vi.useFakeTimers();
    seed(long, coldBackend());

    renderGate();

    expect(screen.queryByText(/đang được đánh thức/i)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/đang được đánh thức/i)).toBeInTheDocument();
  });
});
