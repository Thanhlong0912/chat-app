import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const relativeTime = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Khoảng thời gian tương đối, dạng tiếng Việt ("5 phút trước", "3 tháng trước").
 *
 * Dùng Intl.RelativeTimeFormat có sẵn trong runtime thay vì tự ghép chuỗi: bản
 * trước trả về "m" cho cả phút và tháng, nên "5m" (5 phút) không phân biệt được
 * với "5m" (5 tháng) — và các hậu tố đều là tiếng Anh trong một UI tiếng Việt.
 */
export const formatOnlineTime = (date: Date) => {
  const diffMs = Date.now() - date.getTime();

  // Đồng hồ client có thể lệch so với server; đừng hiển thị "trong 3 phút nữa".
  if (diffMs < MINUTE) return "vừa xong";

  if (diffMs < HOUR) {
    return relativeTime.format(-Math.floor(diffMs / MINUTE), "minute");
  }

  if (diffMs < DAY) {
    return relativeTime.format(-Math.floor(diffMs / HOUR), "hour");
  }

  const diffDays = Math.floor(diffMs / DAY);

  if (diffDays < 30) {
    return relativeTime.format(-diffDays, "day");
  }

  if (diffDays < 365) {
    return relativeTime.format(-Math.floor(diffDays / 30), "month");
  }

  return relativeTime.format(-Math.floor(diffDays / 365), "year");
};

export const formatMessageTime = (date: Date) => {
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (isToday) {
    return timeStr; // ví dụ: "14:35"
  } else if (isYesterday) {
    return `Hôm qua ${timeStr}`; // ví dụ: "Hôm qua 23:10"
  } else if (date.getFullYear() === now.getFullYear()) {
    return `${date.getDate()}/${date.getMonth() + 1} ${timeStr}`; // ví dụ: "22/9 09:15"
  } else {
    return `${date.getDate()}/${
      date.getMonth() + 1
    }/${date.getFullYear()} ${timeStr}`; // ví dụ: "15/12/2023 18:40"
  }
};
