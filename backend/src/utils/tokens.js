import crypto from "crypto";

/**
 * Băm refresh token để lưu trữ.
 *
 * SHA-256 là đủ và đúng ở đây: đầu vào là 64 byte ngẫu nhiên từ CSPRNG, không có
 * entropy thấp để brute force, nên một KDF chậm như bcrypt chỉ đốt CPU trên mọi
 * lần refresh mà không tăng thêm an toàn thực chất.
 */
export const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

export const createRefreshToken = () => crypto.randomBytes(64).toString("hex");

/** Chuỗi ngẫu nhiên ngắn, dùng làm `jti` của access token. */
export const createTokenId = () => crypto.randomBytes(16).toString("hex");
