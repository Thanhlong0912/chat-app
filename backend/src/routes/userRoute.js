import express from "express";
import {
  authMe,
  searchUserByUsername,
  uploadAvatar as uploadAvatarHandler,
} from "../controllers/userController.js";
import { uploadAvatar } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

router.get("/me", authMe);
router.get("/search", searchUserByUsername);
router.post("/uploadAvatar", uploadAvatar.single("file"), uploadAvatarHandler);

export default router;
