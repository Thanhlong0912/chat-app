import api from "@/lib/axios";
import type { User, UserPreferences } from "@/types/user";

interface ProfileUpdate {
  displayName?: string;
  bio?: string | null;
  phone?: string | null;
  preferences?: UserPreferences;
}

export const userService = {
  uploadAvatar: async (formData: FormData) => {
    // `Content-Type` để axios tự đặt: đặt tay sẽ thiếu boundary của multipart.
    const res = await api.post("/users/uploadAvatar", formData);

    // Bỏ kiểm tra `res.status === 400`: axios reject mọi mã không phải 2xx, nên
    // nhánh đó là code chết.
    return res.data;
  },

  updateProfile: async (payload: ProfileUpdate): Promise<User> => {
    const res = await api.patch("/users/me", payload);
    return res.data.user;
  },
};
