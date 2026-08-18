import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Chặn lỗi render để một component hỏng không làm trắng cả trang.
 *
 * Cần thật sự: một lỗi trong danh sách tin nhắn (ví dụ số hook thay đổi giữa các
 * lần render) trước đây unmount toàn bộ cây, và ở dev còn kéo theo vòng
 * remount → fetch → hỏng lại.
 *
 * Phải là class component — React chưa có API hook tương đương.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Lỗi render không bắt được:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">Đã có lỗi xảy ra</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Giao diện gặp sự cố ngoài dự kiến. Tải lại trang thường sẽ khắc phục được.
        </p>

        {import.meta.env.DEV && (
          <pre className="max-w-xl overflow-auto rounded-md bg-muted p-3 text-left text-xs">
            {error.message}
          </pre>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-smooth hover:opacity-90"
        >
          Tải lại trang
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
