import { describe, expect, it } from "vitest";
import { cn, formatOnlineTime } from "./utils";

const ago = (ms: number) => new Date(Date.now() - ms);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("cn", () => {
  it("gộp class và để class sau thắng", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("bỏ qua giá trị falsy", () => {
    expect(cn("p-2", false, undefined, null)).toBe("p-2");
  });
});

describe("formatOnlineTime", () => {
  it("hiển thị 'vừa xong' cho dưới một phút", () => {
    expect(formatOnlineTime(ago(5 * 1000))).toBe("vừa xong");
  });

  it("không trả về thời gian ở tương lai khi đồng hồ client lệch", () => {
    const future = new Date(Date.now() + 3 * MINUTE);

    expect(formatOnlineTime(future)).toBe("vừa xong");
  });

  it("phân biệt được phút với tháng", () => {
    const fiveMinutes = formatOnlineTime(ago(5 * MINUTE));
    const fiveMonths = formatOnlineTime(ago(5 * 30 * DAY));

    // Bản cũ trả "5m" cho cả hai trường hợp.
    expect(fiveMinutes).not.toBe(fiveMonths);
    expect(fiveMinutes).toContain("phút");
    expect(fiveMonths).toContain("tháng");
  });

  it("dùng đơn vị tiếng Việt cho từng mốc", () => {
    expect(formatOnlineTime(ago(45 * MINUTE))).toContain("phút");
    expect(formatOnlineTime(ago(3 * HOUR))).toContain("giờ");
    expect(formatOnlineTime(ago(12 * DAY))).toContain("ngày");
    expect(formatOnlineTime(ago(400 * DAY))).toContain("năm");
  });
});
