import bcrypt from "bcrypt";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Session from "../models/Session.js";
import { badRequest, conflict, forbidden, unauthorized } from "../utils/errors.js";

const ACCESS_TOKEN_TTL = "30m"; // TODO(Phase 1): giảm còn 15m khi refresh đã có rotation
const REFRESH_TOKEN_TTL = 14 * 24 * 60 * 60 * 1000; // 14 ngày

// `secure` + `sameSite: none` không hoạt động trên http://localhost, nên nới ra
// khi chạy local. Mặc định (NODE_ENV không set hoặc "production") giữ nguyên hành
// vi cũ, để deploy hiện tại không đổi.
const isLocal = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

/**
 * Thuộc tính cookie refresh token.
 *
 * `clearCookie` phải khớp `secure`/`sameSite`/`path` với lúc `cookie()`, nếu không
 * browser bỏ qua và cookie không thực sự bị xoá — đó là lý do dùng chung một const.
 */
const REFRESH_COOKIE_BASE = {
  httpOnly: true,
  secure: !isLocal,
  sameSite: isLocal ? "lax" : "none",
  path: "/",
};

const REFRESH_COOKIE_OPTS = { ...REFRESH_COOKIE_BASE, maxAge: REFRESH_TOKEN_TTL };

export const signUp = async (req, res) => {
  const { username, password, email, firstName, lastName } = req.body;

  if (!username || !password || !email || !firstName || !lastName) {
    throw badRequest(
      "MISSING_FIELDS",
      "Không thể thiếu username, password, email, firstName, và lastName",
    );
  }

  // Kiểm tra cả username và email. Trước đây chỉ kiểm tra username, nên email
  // trùng rơi vào unique index và trả về 500 thay vì 409.
  const duplicate = await User.findOne({ $or: [{ username }, { email }] })
    .select("username email")
    .lean();

  if (duplicate) {
    const field = duplicate.username === username ? "username" : "email";
    throw conflict("DUPLICATE_USER", `${field} đã tồn tại`, { field });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await User.create({
    username,
    hashedPassword,
    email,
    displayName: `${lastName} ${firstName}`,
  });

  return res.sendStatus(204);
};

export const signIn = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw badRequest("MISSING_CREDENTIALS", "Thiếu username hoặc password.");
  }

  const user = await User.findOne({ username });

  // Cùng một thông báo cho cả hai trường hợp, để không tiết lộ username nào tồn tại.
  const invalid = unauthorized("INVALID_CREDENTIALS", "username hoặc password không chính xác");

  if (!user) throw invalid;

  const passwordCorrect = await bcrypt.compare(password, user.hashedPassword);

  if (!passwordCorrect) throw invalid;

  const accessToken = jwt.sign({ userId: user._id }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  const refreshToken = crypto.randomBytes(64).toString("hex");

  // TODO(Phase 1): lưu sha256 hash thay vì plaintext, và rotate mỗi lần dùng.
  await Session.create({
    userId: user._id,
    refreshToken,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL),
  });

  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

  return res
    .status(200)
    .json({ message: `User ${user.displayName} đã logged in!`, accessToken });
};

export const signOut = async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    await Session.deleteOne({ refreshToken: token });
    res.clearCookie("refreshToken", REFRESH_COOKIE_BASE);
  }

  return res.sendStatus(204);
};

/** Tạo access token mới từ refresh token trong cookie. */
export const refreshToken = async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (!token) {
    throw unauthorized("NO_REFRESH_TOKEN", "Token không tồn tại.");
  }

  const session = await Session.findOne({ refreshToken: token });

  // Giữ 403 (thay vì 401) cho refresh token không hợp lệ: interceptor phía client
  // hiện dựa vào mã này. Sẽ hợp nhất về 401 ở Phase 9 sau khi client đã nhận cả hai.
  if (!session) {
    throw forbidden("REFRESH_TOKEN_INVALID", "Token không hợp lệ hoặc đã hết hạn");
  }

  if (session.expiresAt < new Date()) {
    await Session.deleteOne({ _id: session._id });
    throw forbidden("REFRESH_TOKEN_EXPIRED", "Token đã hết hạn.");
  }

  const accessToken = jwt.sign({ userId: session.userId }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

  return res.status(200).json({ accessToken });
};
