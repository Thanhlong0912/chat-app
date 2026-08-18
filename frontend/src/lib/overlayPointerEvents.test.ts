import { afterEach, describe, expect, it } from "vitest";
import { hasOpenOverlay, releaseStuckPointerEvents } from "./overlayPointerEvents";

afterEach(() => {
  document.body.style.removeProperty("pointer-events");
  document.body.innerHTML = "";
});

const addOverlay = (attrs: string) => {
  const el = document.createElement("div");
  for (const pair of attrs.split("|")) {
    const [name, value] = pair.split("=");
    el.setAttribute(name, value ?? "");
  }
  document.body.append(el);
  return el;
};

describe("releaseStuckPointerEvents", () => {
  it("gỡ `pointer-events: none` khi không còn overlay nào", () => {
    document.body.style.pointerEvents = "none";

    releaseStuckPointerEvents();

    expect(document.body.style.pointerEvents).toBe("");
  });

  it("không đụng vào <body> khi chưa bị khoá", () => {
    document.body.style.pointerEvents = "auto";

    releaseStuckPointerEvents();

    expect(document.body.style.pointerEvents).toBe("auto");
  });

  /*
   * Quan trọng hơn cả việc dọn được: KHÔNG dọn nhầm. Mở khoá <body> trong lúc một
   * modal còn hiển thị sẽ cho phép bấm xuyên qua lớp phủ.
   */
  it.each([
    ['role=dialog|data-state=open', "dialog đang mở"],
    ['role=alertdialog|data-state=open', "alert dialog đang mở"],
    ['data-radix-menu-content=|data-state=open', "menu đang mở"],
    ["data-radix-popper-content-wrapper=", "popover/tooltip đang mở"],
  ])("giữ nguyên khoá khi %s (%s)", (attrs) => {
    addOverlay(attrs);
    document.body.style.pointerEvents = "none";

    releaseStuckPointerEvents();

    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("bỏ qua overlay đã đóng", () => {
    addOverlay('role=dialog|data-state=closed');
    document.body.style.pointerEvents = "none";

    releaseStuckPointerEvents();

    expect(document.body.style.pointerEvents).toBe("");
  });
});

describe("hasOpenOverlay", () => {
  it("false khi DOM sạch", () => {
    expect(hasOpenOverlay()).toBe(false);
  });

  it("true khi còn một lớp đang mở", () => {
    addOverlay('role=dialog|data-state=open');

    expect(hasOpenOverlay()).toBe(true);
  });
});
