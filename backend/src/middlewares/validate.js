import { badRequest } from "../utils/errors.js";

/**
 * Validate `req.body` / `req.params` / `req.query` bằng schema zod.
 *
 * Ghi lại giá trị đã parse lên `req`, nên controller nhận dữ liệu đã được ép kiểu
 * và cắt bớt field lạ — đây là lớp chặn mass assignment.
 *
 * Chọn zod thay vì express-validator vì zod đã là dependency của frontend (không
 * thêm khái niệm mới cho team), và vì nó validate được cả payload socket ở Phase 3
 * — điều express-validator không làm được.
 */
export const validate = (schemas) => (req, res, next) => {
  for (const part of ["body", "params", "query"]) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = schema.safeParse(req[part]);

    if (!result.success) {
      throw badRequest("VALIDATION_ERROR", firstMessage(result.error), {
        fields: fieldErrors(result.error),
      });
    }

    // `req.query` trong Express 5 là getter chỉ đọc, nên phải defineProperty.
    if (part === "query") {
      Object.defineProperty(req, "query", { value: result.data, writable: true });
    } else {
      req[part] = result.data;
    }
  }

  next();
};

/** Message đầu tiên, để hiển thị cho người dùng. */
const firstMessage = (error) => error.issues?.[0]?.message ?? "Dữ liệu không hợp lệ";

/** Map path -> message, để client tô đỏ đúng field. */
const fieldErrors = (error) =>
  Object.fromEntries(
    (error.issues ?? []).map((issue) => [issue.path.join(".") || "_", issue.message]),
  );

export default validate;
