import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import Session from "../models/Session.js";
import { createRefreshToken, createTokenId, hashToken } from "../utils/tokens.js";
import { invalidateSessionCache } from "../services/sessionService.js";
import logger from "../utils/logger.js";
import { conflict, forbidden, unauthorized } from "../utils/errors.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = 14 * 24 * 60 * 60 * 1000; // 14 ngày

/**
 * Khoảng ân hạn cho refresh token vừa bị rotate.
 *
 * Nhiều request 401 xảy ra đồng thời có thể kích hoạt nhiều lần refresh song song
 * với cùng một token. Đó là hành vi lành tính của client, không phải tấn công —
 * nếu coi nó là dùng lại token thì sẽ thu hồi cả họ session và đăng xuất oan người
 * dùng. Trong khoảng này ta cấp access token mới nhưng KHÔNG rotate thêm lần nữa,
 * nên không phát thêm refresh token cho ai.
 */
const ROTATION_GRACE_MS = 15_000;

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

const signAccessToken = ({ userId, sessionId }) =>
  jwt.sign(
    { userId, sid: String(sessionId), jti: createTokenId() },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );

/** Tra cứu session chấp nhận cả hash mới và token phẳng của bản ghi cũ. */
const findSessionByToken = (raw) =>
  Session.findOne({ refreshToken: { $in: [hashToken(raw), raw] } });

const issueSession = async (req, res, { userId, familyId }) => {
  const raw = createRefreshToken();

  const session = await Session.create({
    userId,
    refreshToken: hashToken(raw),
    familyId,
    userAgent: req.headers["user-agent"],
    ip: req.ip,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL),
  });

  // Session đầu tiên của một lần đăng nhập tự làm gốc của họ.
  if (!familyId) {
    session.familyId = session._id;
    await session.save();
  }

  res.cookie("refreshToken", raw, REFRESH_COOKIE_OPTS);

  return session;
};

export const signUp = async (req, res) => {
  // Đã qua validate(signUpSchema): các field đều có, email đúng định dạng,
  // password 8..72 byte, username đã lowercase.
  const { username, password, email, firstName, lastName } = req.body;

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

  const user = await User.findOne({ username });

  // Cùng một thông báo cho cả hai trường hợp, để không tiết lộ username nào tồn tại.
  const invalid = unauthorized("INVALID_CREDENTIALS", "username hoặc password không chính xác");

  if (!user) throw invalid;

  const passwordCorrect = await bcrypt.compare(password, user.hashedPassword);

  if (!passwordCorrect) throw invalid;

  const session = await issueSession(req, res, { userId: user._id });

  return res.status(200).json({
    message: `User ${user.displayName} đã logged in!`,
    accessToken: signAccessToken({ userId: user._id, sessionId: session._id }),
  });
};

export const signOut = async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    const session = await findSessionByToken(token);

    if (session) {
      // Xoá cả họ: đăng xuất phải vô hiệu hoá mọi token sinh ra từ lần đăng nhập
      // này, không chỉ token đang giữ.
      await Session.deleteMany({
        $or: [{ _id: session._id }, { familyId: session.familyId ?? session._id }],
      });
      invalidateSessionCache(String(session._id));
    }
  }

  res.clearCookie("refreshToken", REFRESH_COOKIE_BASE);

  return res.sendStatus(204);
};

/** Đăng xuất trên mọi thiết bị. */
export const signOutEverywhere = async (req, res) => {
  const sessions = await Session.find({ userId: req.user._id }).select("_id").lean();

  await Session.deleteMany({ userId: req.user._id });
  sessions.forEach((session) => invalidateSessionCache(String(session._id)));

  res.clearCookie("refreshToken", REFRESH_COOKIE_BASE);

  return res.status(200).json({ revoked: sessions.length });
};

/** Tạo access token mới từ refresh token trong cookie, và rotate refresh token. */
export const refreshToken = async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (!token) {
    throw unauthorized("NO_REFRESH_TOKEN", "Token không tồn tại.");
  }

  const session = await findSessionByToken(token);

  // Giữ 403 (thay vì 401) cho refresh token không hợp lệ: interceptor phía client
  // hiện dựa vào mã này. Sẽ hợp nhất về 401 ở Phase 9 sau khi client đã nhận cả hai.
  if (!session) {
    throw forbidden("REFRESH_TOKEN_INVALID", "Token không hợp lệ hoặc đã hết hạn");
  }

  if (session.expiresAt < new Date()) {
    await Session.deleteOne({ _id: session._id });
    throw forbidden("REFRESH_TOKEN_EXPIRED", "Token đã hết hạn.");
  }

  if (session.rotatedAt) {
    const age = Date.now() - session.rotatedAt.getTime();

    if (age > ROTATION_GRACE_MS) {
      // Một token đã bị thay thế từ lâu mà vẫn được dùng lại: gần như chắc chắn
      // token đã bị đánh cắp. Thu hồi toàn bộ họ session.
      const familyId = session.familyId ?? session._id;
      const family = await Session.find({ familyId }).select("_id").lean();

      await Session.deleteMany({ familyId });
      family.forEach((s) => invalidateSessionCache(String(s._id)));

      logger.warn(`Phát hiện dùng lại refresh token cho user ${session.userId}`);

      throw forbidden("REFRESH_TOKEN_REUSED", "Phiên đăng nhập đã bị thu hồi, hãy đăng nhập lại");
    }

    // Trong khoảng ân hạn: đây là race của client, cấp access token mới nhưng
    // không rotate thêm.
    return res.status(200).json({
      accessToken: signAccessToken({ userId: session.userId, sessionId: session._id }),
    });
  }

  // Rotate: đánh dấu token hiện tại đã dùng, rồi phát token mới cùng họ.
  session.rotatedAt = new Date();
  session.lastUsedAt = new Date();
  await session.save();
  invalidateSessionCache(String(session._id));

  const familyId = session.familyId ?? session._id;
  const nextSession = await issueSession(req, res, { userId: session.userId, familyId });

  return res.status(200).json({
    accessToken: signAccessToken({ userId: session.userId, sessionId: nextSession._id }),
  });
};

/** Danh sách phiên đang hoạt động, cho màn hình bảo mật. */
export const listSessions = async (req, res) => {
  const sessions = await Session.find({ userId: req.user._id, rotatedAt: null })
    .select("userAgent ip lastUsedAt createdAt expiresAt")
    .sort({ lastUsedAt: -1 })
    .lean();

  return res.status(200).json({
    sessions: sessions.map((s) => ({
      _id: s._id,
      userAgent: s.userAgent ?? null,
      ip: s.ip ?? null,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      current: mongoose.isValidObjectId(req.auth?.sid)
        ? String(s._id) === String(req.auth.sid)
        : false,
    })),
  });
};
