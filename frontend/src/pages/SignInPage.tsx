import { SigninForm } from "@/components/auth/signin-form";
import { useAuthStore } from "@/stores/useAuthStore";
import { Navigate } from "react-router";

const SignInPage = () => {
  /*
   * ProtectedRoute không còn chờ `/auth/refresh` trước khi đưa khách chưa có phiên
   * tới đây, nên có một khoảng hiếm mà refresh chạy nền thành công *sau* khi đã
   * chuyển trang: localStorage bị xoá nhưng cookie refresh vẫn còn hạn. Không có
   * nhánh này thì họ ngồi trước form đăng nhập trong khi thật ra đã đăng nhập rồi.
   *
   * Tiện thể sửa luôn một chỗ cũ: người đang đăng nhập tự gõ /signin trước đây vẫn
   * thấy form.
   */
  const accessToken = useAuthStore((s) => s.accessToken);

  if (accessToken) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10 absolute inset-0 z-0 bg-gradient-purple">
      <div className="w-full max-w-sm md:max-w-4xl">
        <SigninForm />
      </div>
    </div>
  );
};

export default SignInPage;
