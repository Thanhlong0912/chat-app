import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { toast } from "sonner";
import { useAuthStore } from "./useAuthStore";

const API = "http://localhost:5001/api";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  useAuthStore.setState({ accessToken: null, user: null, loading: false });
});

afterEach(() => server.resetHandlers());

describe("useAuthStore.refresh — khách chưa từng đăng nhập", () => {
  /*
   * `ProtectedRoute` gọi refresh() ngay khi mount cho bất kỳ ai vào "/" mà chưa có
   * access token trong bộ nhớ — tức là gồm cả người lần đầu vào trang. Backend trả
   * 401 NO_REFRESH_TOKEN khi không có cookie nào cả, nghĩa là "chưa từng có phiên",
   * khác hẳn với phiên đã hết hạn. Báo "Phiên đăng nhập đã hết hạn" cho người mới
   * là sai sự thật, và đó là thứ đầu tiên họ nhìn thấy.
   */
  it("không báo phiên hết hạn khi hoàn toàn không có refresh token", async () => {
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ code: "NO_REFRESH_TOKEN" }, { status: 401 }),
      ),
    );

    await useAuthStore.getState().refresh();

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("vẫn dọn sạch state khi không có refresh token", async () => {
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ code: "NO_REFRESH_TOKEN" }, { status: 401 }),
      ),
    );

    useAuthStore.setState({ accessToken: "cũ" });

    await useAuthStore.getState().refresh();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe("useAuthStore.refresh — phiên thật sự kết thúc", () => {
  it.each([
    ["REFRESH_TOKEN_EXPIRED", 403],
    ["REFRESH_TOKEN_INVALID", 403],
    ["REFRESH_TOKEN_REUSED", 403],
  ])("vẫn báo phiên hết hạn với %s", async (code, status) => {
    server.use(
      http.post(`${API}/auth/refresh`, () => HttpResponse.json({ code }, { status })),
    );

    await useAuthStore.getState().refresh();

    expect(toast.error).toHaveBeenCalledWith(
      "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!",
    );
  });

  // Mất mạng thì không có response nào để đọc mã. Im lặng ở đây sẽ giấu mất lỗi
  // thật, nên trường hợp không xác định được vẫn phải báo.
  it("vẫn báo khi request không tới được server", async () => {
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()));

    await useAuthStore.getState().refresh();

    expect(toast.error).toHaveBeenCalled();
  });
});
