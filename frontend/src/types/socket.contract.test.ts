// Chỉ file này cần API của Node (đọc file của backend). Khai báo cục bộ thay vì
// thêm "node" vào `types` của tsconfig.app.json, để code chạy trên browser không
// vô tình dùng được `process` hay `fs`.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENT_NAMES,
  LEGACY_EVENT_NAMES,
  SERVER_EVENT_NAMES,
} from "./socket";

/**
 * Giữ hợp đồng socket của frontend đồng bộ với backend.
 *
 * Backend là JavaScript thuần không có build step, nên không thể import kiểu từ nó.
 * Thay vì dựng một package dùng chung (cần build ở cả hai bên, và Render phải
 * deploy kèm thư mục ngang cấp), test này đọc chính file backend dưới dạng TEXT,
 * rút tên event bằng regex, rồi so khớp tập hợp.
 *
 * Kết quả: đổi tên một event ở một bên mà quên bên kia sẽ làm CI đỏ ngay, mà không
 * ràng buộc gì về build hay deploy giữa hai package.
 */

// Giải theo cwd (thư mục frontend khi vitest chạy) chứ không theo `import.meta.url`:
// Vite biến đổi module nên `import.meta.url` không còn là file:// URL.
const BACKEND_EVENTS_PATH = resolve(process.cwd(), "../backend/src/socket/events.js");

const backendEventsSource = readFileSync(BACKEND_EVENTS_PATH, "utf8");

/**
 * Rút tên event trong một block `export const NAME = Object.freeze({...})`.
 * Lấy phần giá trị chuỗi, tức tên event thật, không phải tên hằng.
 */
const extractBlock = (source: string, constName: string): string[] => {
  const match = source.match(
    new RegExp(`export const ${constName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`),
  );

  if (!match) {
    throw new Error(`Không tìm thấy ${constName} trong backend/src/socket/events.js`);
  }

  return [...match[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
};

const backendClientEvents = extractBlock(backendEventsSource, "CLIENT_EVENTS");
const backendServerEvents = extractBlock(backendEventsSource, "SERVER_EVENTS");
const backendLegacyEvents = extractBlock(backendEventsSource, "LEGACY_EVENTS");

describe("hợp đồng socket giữa frontend và backend", () => {
  it("đọc được file event của backend", () => {
    // Nếu regex hỏng thì các so sánh dưới sẽ vô nghĩa (rỗng khớp rỗng).
    expect(backendClientEvents.length).toBeGreaterThan(5);
    expect(backendServerEvents.length).toBeGreaterThan(5);
  });

  it("tên event client → server khớp nhau", () => {
    expect([...backendClientEvents].sort()).toEqual([...CLIENT_EVENT_NAMES].sort());
  });

  it("tên event server → client khớp nhau", () => {
    expect([...backendServerEvents].sort()).toEqual([...SERVER_EVENT_NAMES].sort());
  });

  it("tên event cũ khớp nhau", () => {
    expect([...backendLegacyEvents].sort()).toEqual([...LEGACY_EVENT_NAMES].sort());
  });

  it("không có tên event nào bị trùng giữa hai chiều", () => {
    const overlap = CLIENT_EVENT_NAMES.filter((name) =>
      (SERVER_EVENT_NAMES as readonly string[]).includes(name),
    );

    expect(overlap).toEqual([]);
  });

  it("event mới đều theo quy ước miền:hành-động", () => {
    for (const name of [...CLIENT_EVENT_NAMES, ...SERVER_EVENT_NAMES]) {
      expect(name).toMatch(/^[a-z]+:[a-z]+([A-Z][a-z]+)*$/);
    }
  });
});
