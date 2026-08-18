import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * swagger.json phải mô tả đúng những route thực sự tồn tại.
 *
 * Bản swagger trước đây trôi rất xa thực tế: nó được ghi lại từ một REST client
 * nên path chứa ObjectId thật thay vì tham số, và thiếu khoảng hai chục endpoint.
 * Một tài liệu API sai còn tệ hơn không có tài liệu, vì người đọc tin vào nó.
 *
 * Test này đọc các file route dưới dạng TEXT chứ không duyệt router của Express:
 * Express 5 không còn phơi ra mount path của layer, nên mọi cách lần theo nội bộ
 * đều sẽ vỡ ở lần nâng cấp kế tiếp. Cùng kỹ thuật với contract test của socket.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const read = (...parts) => readFileSync(join(SRC, ...parts), "utf8");

/** `app.use("/api/xxx", yyyRoute)` → tiền tố mount theo tên biến router. */
function mountPrefixes() {
  const app = read("app.js");
  const prefixes = new Map();

  for (const [, path, name] of app.matchAll(/app\.use\(\s*"(\/api\/[^"]+)"\s*,\s*(\w+)\s*\)/g)) {
    // Một tiền tố có thể mount nhiều router (ví dụ /api/auth mount cả hai
    // router công khai và router đã xác thực).
    prefixes.set(name, path);
  }

  return prefixes;
}

/** Tên biến router trong app.js → file route tương ứng. */
function routerFiles() {
  const app = read("app.js");
  const files = new Map();

  // `import authRoute, { authProtectedRoute } from "./routes/authRoute.js"`
  for (const [, clause, file] of app.matchAll(
    /import\s+([^;]+?)\s+from\s+"\.\/routes\/([^"]+)"/g,
  )) {
    for (const name of clause.replace(/[{}]/g, ",").split(",")) {
      const trimmed = name.trim();
      if (trimmed) files.set(trimmed, file);
    }
  }

  return files;
}

/** Mọi route đã đăng ký, dạng `METHOD /đường/dẫn` với param chuẩn OpenAPI. */
function registeredRoutes() {
  const prefixes = mountPrefixes();
  const files = routerFiles();
  const routes = new Set();

  for (const [name, prefix] of prefixes) {
    const file = files.get(name);
    if (!file) continue;

    const source = read("routes", file);

    // Bắt cả `router.get("/x", ...)` lẫn `authProtectedRoute.get("/x", ...)`.
    for (const [, method, path] of source.matchAll(
      /\b\w*[Rr]oute[r]?\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g,
    )) {
      const full = `${prefix}${path}`
        .replace(/\/+$/, "") // bỏ dấu / thừa ở cuối
        .replace(/:(\w+)/g, "{$1}"); // :conversationId → {conversationId}

      routes.add(`${method.toUpperCase()} ${full.replace("/api", "")}`);
    }
  }

  return routes;
}

/** Mọi operation được mô tả trong swagger.json. */
function documentedRoutes() {
  const spec = JSON.parse(read("swagger.json"));
  const routes = new Set();

  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of Object.keys(operations)) {
      routes.add(`${method.toUpperCase()} ${path}`);
    }
  }

  return routes;
}

describe("swagger.json khớp với route thật", () => {
  it("mọi route đã đăng ký đều có trong tài liệu", () => {
    const missing = [...registeredRoutes()].filter((r) => !documentedRoutes().has(r));

    expect(missing).toEqual([]);
  });

  it("không mô tả route không tồn tại", () => {
    const registered = registeredRoutes();
    const ghosts = [...documentedRoutes()].filter((r) => !registered.has(r));

    expect(ghosts).toEqual([]);
  });

  it("đọc được đủ số route để test này có ý nghĩa", () => {
    // Bảo hiểm cho chính test này: nếu regex hỏng và không bắt được gì, hai
    // assertion trên sẽ "pass" một cách vô nghĩa.
    expect(registeredRoutes().size).toBeGreaterThan(30);
  });

  it("không còn ObjectId thật nằm trong path", () => {
    const spec = JSON.parse(read("swagger.json"));
    const hardcoded = Object.keys(spec.paths).filter((p) => /[0-9a-f]{24}/.test(p));

    // Bản cũ có `/friends/requests/68faed19defb37e90657d7d6/accept`.
    expect(hardcoded).toEqual([]);
  });

  it("mỗi schema được $ref tới đều thực sự tồn tại", () => {
    const raw = read("swagger.json");
    const spec = JSON.parse(raw);
    const defined = new Set(Object.keys(spec.components.schemas));

    const referenced = [...raw.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((name) => !defined.has(name));

    expect(dangling).toEqual([]);
  });

  it("mỗi response được $ref tới đều thực sự tồn tại", () => {
    const raw = read("swagger.json");
    const spec = JSON.parse(raw);
    const defined = new Set(Object.keys(spec.components.responses));

    const referenced = [...raw.matchAll(/"#\/components\/responses\/(\w+)"/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((name) => !defined.has(name));

    expect(dangling).toEqual([]);
  });
});

describe("scripts/build-swagger.mjs là nguồn của swagger.json", () => {
  it("chạy lại script không làm file thay đổi", async () => {
    const before = read("swagger.json");

    const scripts = readdirSync(join(SRC, "..", "scripts"));
    expect(scripts).toContain("build-swagger.mjs");

    // Sửa tay swagger.json rồi quên cập nhật script là cách chắc chắn nhất để hai
    // bên lệch nhau. Chạy lại script và so nguyên văn.
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", [join(SRC, "..", "scripts", "build-swagger.mjs")]);

    expect(read("swagger.json")).toBe(before);
  });
});
