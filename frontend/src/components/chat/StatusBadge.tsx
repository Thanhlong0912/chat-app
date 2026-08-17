import { cn } from "@/lib/utils";
import type { PresenceStatus } from "@/types/socket";

const LABEL: Record<PresenceStatus, string> = {
  online: "Đang hoạt động",
  away: "Vắng mặt",
  offline: "Không hoạt động",
};

const StatusBadge = ({ status }: { status: PresenceStatus }) => {
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-card",
        status === "online" && "status-online",
        status === "away" && "status-away",
        status === "offline" && "status-offline"
      )}
      // Màu sắc là thông tin, nên phải có bản chữ cho screen reader.
      role="img"
      aria-label={LABEL[status]}
      title={LABEL[status]}
    />
  );
};

export default StatusBadge;
