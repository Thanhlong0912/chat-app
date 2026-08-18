import { useState } from "react";
import { Bell, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useThemeStore } from "@/stores/useThemeStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useUserStore } from "@/stores/useUserStore";
import { describeError } from "@/lib/errors";
import { getPermission, requestPermission } from "@/lib/notifications";
import type { UserPreferences } from "@/types/user";

const Row = ({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <Label
        htmlFor={id}
        className="text-base font-medium"
      >
        {title}
      </Label>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    {children}
  </div>
);

/**
 * Tuỳ chọn ứng dụng.
 *
 * Trước đây toàn bộ form này chỉ là state cục bộ — bật tắt xong tải lại trang là
 * mất. Nay lưu ở server qua `PATCH /api/users/me` nên đồng bộ giữa các thiết bị.
 * Riêng chủ đề sáng/tối vẫn ở localStorage: nó cần áp dụng ngay khi tải trang,
 * trước cả khi biết người dùng là ai.
 */
const PreferencesForm = () => {
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const user = useAuthStore((s) => s.user);
  const updateProfile = useUserStore((s) => s.updateProfile);

  const [saving, setSaving] = useState(false);
  const preferences = user?.preferences ?? {};

  const save = async (patch: UserPreferences) => {
    setSaving(true);

    try {
      await updateProfile({ preferences: patch });
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Bật thông báo trình duyệt.
   *
   * Quyền chỉ được xin TỪ ĐÂY — một cú bấm rõ ràng của người dùng. Xin lúc tải
   * trang thì Chrome hạ uy tín site và Safari bỏ qua hoàn toàn.
   */
  const toggleBrowserNotifications = async (enabled: boolean) => {
    if (!enabled) {
      await save({ browserNotifications: false });
      return;
    }

    const permission = await requestPermission();

    if (permission === "unsupported") {
      toast.error("Trình duyệt này không hỗ trợ thông báo");
      return;
    }

    if (permission !== "granted") {
      // Trình duyệt không cho phép xin lại sau khi bị chặn — phải nói rõ để người
      // dùng biết đường vào cài đặt trình duyệt.
      toast.error("Bạn đã chặn thông báo. Hãy bật lại trong cài đặt của trình duyệt.");
      return;
    }

    await save({ browserNotifications: true });
    toast.success("Đã bật thông báo trình duyệt");
  };

  const browserBlocked = getPermission() === "denied";

  return (
    <Card className="glass-strong border-border/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="size-5 text-primary" />
          Tuỳ chỉnh ứng dụng
        </CardTitle>
        <CardDescription>Cá nhân hoá trải nghiệm trò chuyện của bạn</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Row
          id="theme-toggle"
          title="Chế độ tối"
          description="Chuyển đổi giữa giao diện sáng và tối"
        >
          <div className="flex items-center gap-2">
            <Sun className="size-4 text-muted-foreground" />
            <Switch
              id="theme-toggle"
              checked={isDark}
              onCheckedChange={toggleTheme}
              className="data-[state=checked]:bg-primary-glow"
            />
            <Moon className="size-4 text-muted-foreground" />
          </div>
        </Row>

        <Row
          id="in-app-notifications"
          title="Thông báo trong ứng dụng"
          description="Hiện thông báo nhỏ khi có tin nhắn ở cuộc trò chuyện khác"
        >
          <Switch
            id="in-app-notifications"
            checked={preferences.inAppNotifications !== false}
            disabled={saving}
            onCheckedChange={(checked) => save({ inAppNotifications: checked })}
          />
        </Row>

        <Row
          id="browser-notifications"
          title="Thông báo trình duyệt"
          description={
            browserBlocked
              ? "Đang bị chặn trong cài đặt trình duyệt"
              : "Nhận thông báo cả khi bạn đang ở tab khác"
          }
        >
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <Switch
              id="browser-notifications"
              checked={preferences.browserNotifications === true}
              disabled={saving || browserBlocked}
              onCheckedChange={toggleBrowserNotifications}
            />
          </div>
        </Row>

        <Row
          id="show-presence"
          title="Hiện trạng thái hoạt động"
          description="Cho người khác thấy khi bạn đang online"
        >
          <Switch
            id="show-presence"
            checked={preferences.showPresence !== false}
            disabled={saving}
            onCheckedChange={(checked) => save({ showPresence: checked })}
          />
        </Row>
      </CardContent>
    </Card>
  );
};

export default PreferencesForm;
