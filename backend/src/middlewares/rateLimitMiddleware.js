import rateLimit, { MemoryStore } from "express-rate-limit";
import { AppError } from "../utils/errors.js";

/**
 * Handler dùng chung, để lỗi rate limit đi qua cùng một error middleware và có
 * cùng hình dạng response (`code` + `message`) như mọi lỗi khác.
 */
const handler = (req, res, next) => {
  next(new AppError(429, "RATE_LIMITED", "Bạn thao tác quá nhanh, hãy thử lại sau ít phút"));
};

/*
 * Mặc định tắt trong test: nhiều test gọi cùng một endpoint hàng chục lần và sẽ
 * tự đụng giới hạn. Test riêng về rate limit bật lại tường minh bằng
 * `setRateLimitEnabled(true)` rồi gọi `resetRateLimits()` để không ảnh hưởng
 * các test khác — store là module-level nên trạng thái sẽ rò rỉ nếu không reset.
 */
let enabled = process.env.NODE_ENV !== "test";

export const setRateLimitEnabled = (value) => {
  enabled = value;
};

const stores = [];

const makeLimiter = ({ windowMs, limit, skipSuccessfulRequests = false }) => {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    store,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler,
    skip: () => !enabled,
  });
};

/** Xoá toàn bộ bộ đếm. Chỉ dùng trong test. */
export const resetRateLimits = () => {
  stores.forEach((store) => store.resetAll?.());
};

/**
 * Đăng nhập / đăng ký.
 *
 * Chặt nhất vì đây là bề mặt brute force, và vì bcrypt cost 10 khiến mỗi lần thử
 * tốn CPU thật — không giới hạn thì đây là một vector DoS, không chỉ là chuyện
 * đoán mật khẩu. Chỉ tính các lần thất bại, để người đăng nhập đúng nhiều lần
 * không bị chặn oan.
 */
export const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/** Refresh chạy tự động theo chu kỳ token nên phải nới hơn đăng nhập. */
export const refreshLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

/** Lưới an toàn chung cho toàn bộ API. */
export const globalLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 300,
});
