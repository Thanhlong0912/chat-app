import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import api from "./axios";
import { useAuthStore } from "@/stores/useAuthStore";

const API = "http://localhost:5001/api";

/** Đếm số lần /auth/refresh thực sự được gọi. */
let refreshCalls = 0;
let refreshShouldFail = false;

const server = setupServer(
  http.post(`${API}/auth/refresh`, () => {
    refreshCalls += 1;

    if (refreshShouldFail) {
      return HttpResponse.json({ code: "REFRESH_TOKEN_REUSED" }, { status: 403 });
    }

    return HttpResponse.json({ accessToken: `token-moi-${refreshCalls}` });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  refreshCalls = 0;
  refreshShouldFail = false;
  useAuthStore.setState({ accessToken: "token-cu", user: null });
});

afterEach(() => server.resetHandlers());

describe("interceptor refresh", () => {
  it("gộp nhiều 401 đồng thời thành đúng MỘT lần refresh", async () => {
    let protectedHits = 0;

    server.use(
      http.get(`${API}/conversations`, ({ request }) => {
        protectedHits += 1;

        const auth = request.headers.get("Authorization");
        // Lần đầu (token cũ) trả 401; sau khi có token mới thì cho qua.
        if (auth?.includes("token-cu")) {
          return HttpResponse.json({ code: "TOKEN_EXPIRED" }, { status: 401 });
        }

        return HttpResponse.json({ conversations: [] });
      }),
    );

    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.get("/conversations")),
    );

    // Đây là điều quan trọng: refresh token nay được rotate, nên 5 lần refresh
    // song song sẽ có 4 lần trình ra token đã bị thay thế.
    expect(refreshCalls).toBe(1);
    expect(results.every((r) => r.status === 200)).toBe(true);
    // 5 lần đầu thất bại + 5 lần thử lại.
    expect(protectedHits).toBe(10);
  });

  it("cho phép refresh lại ở lần hết hạn sau", async () => {
    server.use(
      http.get(`${API}/one`, ({ request }) => {
        const auth = request.headers.get("Authorization");
        return auth?.includes("token-cu")
          ? HttpResponse.json({ code: "TOKEN_EXPIRED" }, { status: 401 })
          : HttpResponse.json({ ok: true });
      }),
    );

    await api.get("/one");
    expect(refreshCalls).toBe(1);

    // Token hết hạn lần nữa — promise dùng chung phải đã được giải phóng.
    useAuthStore.setState({ accessToken: "token-cu" });
    await api.get("/one");

    expect(refreshCalls).toBe(2);
  });

  it("lưu access token mới vào store", async () => {
    server.use(
      http.get(`${API}/one`, ({ request }) =>
        request.headers.get("Authorization")?.includes("token-cu")
          ? HttpResponse.json({}, { status: 401 })
          : HttpResponse.json({ ok: true }),
      ),
    );

    await api.get("/one");

    expect(useAuthStore.getState().accessToken).toBe("token-moi-1");
  });

  it("cũng refresh khi gặp 403, vì /auth/refresh vẫn dùng mã đó", async () => {
    server.use(
      http.get(`${API}/one`, ({ request }) =>
        request.headers.get("Authorization")?.includes("token-cu")
          ? HttpResponse.json({}, { status: 403 })
          : HttpResponse.json({ ok: true }),
      ),
    );

    await api.get("/one");

    expect(refreshCalls).toBe(1);
  });

  it("chỉ thử lại một lần rồi mới bỏ cuộc", async () => {
    let hits = 0;

    server.use(
      http.get(`${API}/always401`, () => {
        hits += 1;
        return HttpResponse.json({ code: "TOKEN_EXPIRED" }, { status: 401 });
      }),
    );

    await expect(api.get("/always401")).rejects.toMatchObject({
      response: { status: 401 },
    });

    // Một lần đầu + đúng một lần thử lại.
    expect(hits).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  it("xoá state khi refresh thất bại", async () => {
    refreshShouldFail = true;

    server.use(
      http.get(`${API}/one`, () => HttpResponse.json({}, { status: 401 })),
    );

    await expect(api.get("/one")).rejects.toBeTruthy();

    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("không refresh cho signin / signup / refresh", async () => {
    server.use(
      http.post(`${API}/auth/signin`, () =>
        HttpResponse.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }),
      ),
    );

    await expect(api.post("/auth/signin", {})).rejects.toBeTruthy();

    // Sai mật khẩu không được kích hoạt refresh.
    expect(refreshCalls).toBe(0);
  });

  it("lỗi mạng không làm interceptor ném TypeError", async () => {
    server.use(http.get(`${API}/offline`, () => HttpResponse.error()));

    // error.config vẫn có ở đây, nhưng nếu interceptor truy cập .url mà không
    // guard thì một request bị cancel (config undefined) sẽ ném TypeError và che
    // mất lỗi gốc.
    await expect(api.get("/offline")).rejects.toMatchObject({
      message: expect.stringMatching(/Network Error/i),
    });

    expect(refreshCalls).toBe(0);
  });

  it("không thử refresh khi error.config undefined", async () => {
    // Mô phỏng trực tiếp: interceptor phải reject gọn thay vì nổ.
    const handler = (api.interceptors.response as unknown as {
      handlers: { rejected: (e: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;

    await expect(handler({ message: "bi cancel" })).rejects.toEqual({
      message: "bi cancel",
    });

    expect(refreshCalls).toBe(0);
  });
});
