import express from "express";
import {
  listSessions,
  refreshToken,
  signIn,
  signOut,
  signOutEverywhere,
  signUp,
} from "../controllers/authController.js";
import { validate } from "../middlewares/validate.js";
import { signInSchema, signUpSchema } from "../schemas/authSchemas.js";
import { authLimiter, refreshLimiter } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.post("/signup", authLimiter, validate(signUpSchema), signUp);

router.post("/signin", authLimiter, validate(signInSchema), signIn);

router.post("/signout", signOut);

router.post("/refresh", refreshLimiter, refreshToken);

export default router;

/**
 * Route auth cần đăng nhập.
 *
 * Tách router riêng vì `authRoute` được mount trước `protectedRoute` (nó phải
 * public), còn các endpoint này cần `req.user`.
 */
export const authProtectedRoute = express.Router();

authProtectedRoute.get("/sessions", listSessions);
authProtectedRoute.post("/signout-all", signOutEverywhere);
