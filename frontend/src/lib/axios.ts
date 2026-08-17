import { useAuthStore } from "@/stores/useAuthStore";
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

// gắn access token vào req header
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

// tự động gọi refresh api khi access token hết hạn
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;

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

    originalRequest._retryCount = originalRequest._retryCount || 0;

    // Backend trả 401 cho token hết hạn / không hợp lệ. Vẫn nhận 403 vì
    // `/auth/refresh` chưa đổi mã, và để bundle cũ đang mở tab không mất realtime.
    const isAuthError =
      error.response?.status === 401 || error.response?.status === 403;

    if (isAuthError && originalRequest._retryCount < 4) {
      originalRequest._retryCount += 1;

      try {
        const res = await api.post("/auth/refresh", { withCredentials: true });
        const newAccessToken = res.data.accessToken;

        useAuthStore.getState().setAccessToken(newAccessToken);

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().clearState();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
