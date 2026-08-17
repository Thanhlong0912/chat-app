import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Vite thay `import.meta.env` lúc build, nhưng test cần giá trị xác định để
// baseURL của axios và socket không phụ thuộc vào .env của máy đang chạy.
import.meta.env.VITE_API_URL = "http://localhost:5001/api";
import.meta.env.VITE_SOCKET_URL = "http://localhost:5001";

/**
 * Storage in-memory.
 *
 * Node 26 định nghĩa sẵn global `localStorage` nhưng để undefined khi không có
 * `--localstorage-file`, và global đó che mất bản của jsdom. App lại dùng
 * localStorage (zustand persist) và sessionStorage (vị trí scroll), nên tự cài
 * một bản xác định thay vì phụ thuộc vào phiên bản Node/jsdom.
 */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();

  get length() {
    return this.#data.size;
  }

  clear() {
    this.#data.clear();
  }

  getItem(key: string) {
    return this.#data.get(String(key)) ?? null;
  }

  key(index: number) {
    return [...this.#data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#data.delete(String(key));
  }

  setItem(key: string, value: string) {
    this.#data.set(String(key), String(value));
  }
}

const installStorage = (name: "localStorage" | "sessionStorage") => {
  const storage = new MemoryStorage();

  for (const target of [globalThis, window] as unknown as Record<string, unknown>[]) {
    Object.defineProperty(target, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
};

/*
 * Cài polyfill ở TOP LEVEL, không phải trong `beforeAll`.
 *
 * Setup file được chạy trước khi test file được import, nhưng callback của
 * `beforeAll` chỉ chạy ngay trước test đầu tiên — tức là SAU khi các module đã
 * được import. `zustand/persist` đọc localStorage lúc khởi tạo store, nên nếu cài
 * muộn thì store đã nổ trước đó rồi.
 */
installStorage("localStorage");
installStorage("sessionStorage");

// jsdom chưa có matchMedia — `use-mobile.ts` gọi nó khi mount.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Radix và scroll logic dùng những API này, jsdom không cài đặt.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
