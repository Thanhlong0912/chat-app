import express from "express";
import {
  authMe,
  searchUserByUsername,
  updateMe,
  uploadAvatar as uploadAvatarHandler,
} from "../controllers/userController.js";
import { uploadAvatar } from "../middlewares/uploadMiddleware.js";
import { validate } from "../middlewares/validate.js";
import { updateMeSchema } from "../schemas/userSchemas.js";

const router = express.Router();

router.get("/me", authMe);
router.patch("/me", validate(updateMeSchema), updateMe);
router.get("/search", searchUserByUsername);
router.post("/uploadAvatar", uploadAvatar.single("file"), uploadAvatarHandler);

export default router;
