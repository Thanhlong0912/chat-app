import { useState } from "react";
import { Heart } from "lucide-react";
import { Spinner } from "../ui/spinner";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { User } from "@/types/user";
import { useUserStore } from "@/stores/useUserStore";
import { fieldErrors as extractFieldErrors, describeError } from "@/lib/errors";

type Props = {
  userInfo: User | null;
};

/**
 * Hồ sơ cá nhân.
 *
 * Trước đây form này hoàn toàn là giả: mọi `onChange` là `() => {}` và nút lưu
 * không có handler, nên người dùng gõ vào ô mà không có gì thay đổi. Nay nối thẳng
 * vào `PATCH /api/users/me`.
 *
 * `username` và `email` cố tình để chỉ đọc — đổi chúng kéo theo chuyện đăng nhập và
 * định danh, không thuộc phạm vi màn hình này.
 */
const PersonalInfoForm = ({ userInfo }: Props) => {
  const updateProfile = useUserStore((s) => s.updateProfile);

  const [displayName, setDisplayName] = useState(userInfo?.displayName ?? "");
  const [phone, setPhone] = useState(userInfo?.phone ?? "");
  const [bio, setBio] = useState(userInfo?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!userInfo) return null;

  const dirty =
    displayName !== (userInfo.displayName ?? "") ||
    phone !== (userInfo.phone ?? "") ||
    bio !== (userInfo.bio ?? "");

  const save = async () => {
    setSaving(true);
    setErrors({});

    try {
      await updateProfile({
        displayName: displayName.trim(),
        phone: phone.trim() || null,
        bio: bio.trim() || null,
      });

      toast.success("Đã lưu thông tin");
    } catch (error) {
      // Lỗi theo từng field để tô đỏ đúng ô, thay vì một toast chung chung.
      setErrors(extractFieldErrors(error));
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="glass-strong border-border/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="size-5 text-primary" />
          Thông tin cá nhân
        </CardTitle>
        <CardDescription>
          Cập nhật chi tiết cá nhân và thông tin hồ sơ của bạn
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="displayName">Tên hiển thị</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              aria-invalid={Boolean(errors.displayName)}
              className="glass-light border-border/30"
            />
            {errors.displayName && <p className="error-message">{errors.displayName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Số điện thoại</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={Boolean(errors.phone)}
              className="glass-light border-border/30"
            />
            {errors.phone && <p className="error-message">{errors.phone}</p>}
          </div>

          {/* Chỉ đọc: đổi username/email ảnh hưởng tới đăng nhập và định danh. */}
          <div className="space-y-2">
            <Label htmlFor="username">Tên người dùng</Label>
            <Input
              id="username"
              value={userInfo.username}
              readOnly
              disabled
              className="glass-light border-border/30"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={userInfo.email}
              readOnly
              disabled
              className="glass-light border-border/30"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Giới thiệu</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Vài dòng về bạn..."
            className="glass-light border-border/30"
          />
        </div>

        <Button
          onClick={save}
          disabled={!dirty || saving || !displayName.trim()}
          className="bg-gradient-chat text-white transition-smooth hover:opacity-90"
        >
          {saving ? (
            <>
              <Spinner />
              Đang lưu...
            </>
          ) : (
            "Lưu thay đổi"
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default PersonalInfoForm;
