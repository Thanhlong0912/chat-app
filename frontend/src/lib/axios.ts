import { useAuthStore } from "@/stores/useAuthStore";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

/** Config có thêm cờ nội bộ để không thử lại vô hạn. */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// gắn access token vào req header
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

/*
 * Refresh dùng chung một promise duy nhất.
 *
 * Nhiều request song song hết hạn cùng lúc sẽ cùng nhận 401. Nếu mỗi request tự
 * gọi /auth/refresh thì backend nhận N lần refresh với cùng một token — và vì
 * refresh token nay được rotate, chỉ lần đầu thành công, các lần sau trình ra một
 * token đã bị thay thế. Server có khoảng ân hạn ngắn cho đúng tình huống này,
 * nhưng đây mới là cách sửa đúng: gộp tất cả về một lần gọi.
 */
let refreshPromise: Promise<string> | null = null;

const refreshAccessToken = (): Promise<string> => {
  refreshPromise ??= api
    .post<{ accessToken: string | null }>("/auth/refresh")
    .then((res) => {
      const { accessToken } = res.data;

      /*
       * 200 kèm `accessToken: null` là cách backend nói "không còn phiên nào" mà
       * không phải trả lỗi (xem authController.refreshToken). Với axios thì đó là
       * một response thành công, nhưng với chỗ này thì không: không có token nào để
       * thử lại. Ném ra để rơi vào nhánh catch của interceptor — nơi đã sẵn có
       * clearState(). Bỏ qua thì request được gửi lại kèm `Bearer null`, ăn thêm
       * một 401, và người dùng ở lại trong app với một phiên không tồn tại.
       */
      if (!accessToken) {
        throw new Error("NO_SESSION");
      }

      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken;
    })
    .finally(() => {
      // Xoá để lần hết hạn sau lại refresh được.
      refreshPromise = null;
    });

  return refreshPromise;
};

// tự động gọi refresh api khi access token hết hạn
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableConfig | undefined;

    // error.config là undefined khi request không bao giờ được gửi (mất mạng, DNS
    // lỗi, request bị cancel). Truy cập .url trực tiếp khi đó sẽ ném TypeError và
    // che mất lỗi gốc.
    const url = originalRequest?.url ?? "";

    // những api không cần check
    if (
      !originalRequest ||
      url.includes("/auth/signin") ||
      url.includes("/auth/signup") ||
      url.includes("/auth/refresh")
    ) {
      return Promise.reject(error);
    }

    const status = error.response?.status;
    // Backend trả 401 cho token hết hạn / không hợp lệ. Vẫn nhận 403 vì
    // `/auth/refresh` chưa đổi mã, và để bundle cũ đang mở tab không mất realtime.
    const isAuthError = status === 401 || status === 403;

    // Chỉ thử lại đúng một lần. Trước đây cho phép 4 lần, nhưng nếu refresh đã
    // thất bại thì thử thêm chỉ là bốn cách đăng xuất chậm hơn.
    if (!isAuthError || originalRequest._retried) {
      return Promise.reject(error);
    }

    originalRequest._retried = true;

    try {
      const accessToken = await refreshAccessToken();

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return await api(originalRequest);
    } catch (refreshError) {
      useAuthStore.getState().clearState();
      return Promise.reject(refreshError);
    }
  },
);

export default api;
