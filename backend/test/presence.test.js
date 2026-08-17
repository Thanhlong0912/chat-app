import { beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import {
  STATUS,
  addSocket,
  getStatus,
  isOnline,
  onlineUserIds,
  removeSocket,
  resetPresence,
  setAway,
  socketCount,
  statusesFor,
} from "../src/socket/presence.js";

beforeEach(() => resetPresence());

describe("đếm tham chiếu multi-tab", () => {
  it("socket đầu tiên làm user online", () => {
    const result = addSocket("u1", "s1");

    expect(result.becameOnline).toBe(true);
    expect(getStatus("u1")).toBe(STATUS.ONLINE);
  });

  it("socket thứ hai KHÔNG báo online lần nữa", () => {
    addSocket("u1", "s1");
    const second = addSocket("u1", "s2");

    expect(second.becameOnline).toBe(false);
    expect(socketCount("u1")).toBe(2);
  });

  it("đóng một trong hai tab thì vẫn online", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s2");

    const result = removeSocket("u1", "s1");

    // Đây chính là hành vi mà bản cũ làm sai: khoá Map là ObjectId nên hai tab
    // thành hai entry, và đóng một tab khiến người đó biến mất khỏi danh sách.
    expect(result.becameOffline).toBe(false);
    expect(getStatus("u1")).toBe(STATUS.ONLINE);
  });

  it("đóng tab cuối cùng mới báo offline, và chỉ báo một lần", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s2");

    expect(removeSocket("u1", "s1").becameOffline).toBe(false);
    expect(removeSocket("u1", "s2").becameOffline).toBe(true);
    expect(getStatus("u1")).toBe(STATUS.OFFLINE);
  });

  it("bỏ một socket không tồn tại không gây lỗi", () => {
    expect(removeSocket("u-la", "s-la")).toEqual({ becameOffline: false, socketCount: 0 });
  });

  it("thêm cùng một socketId hai lần không đếm thành hai", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s1");

    expect(socketCount("u1")).toBe(1);
  });

  it("khoá theo string, nên ObjectId và string là cùng một người", () => {
    const objectId = new mongoose.Types.ObjectId();

    addSocket(objectId, "s1");
    addSocket(String(objectId), "s2");

    // Nếu khoá theo object thì đây sẽ là hai user khác nhau.
    expect(socketCount(objectId)).toBe(2);
    expect(onlineUserIds()).toHaveLength(1);
  });

  it("danh sách online không có id trùng", () => {
    const objectId = new mongoose.Types.ObjectId();
    addSocket(objectId, "s1");
    addSocket(new mongoose.Types.ObjectId(String(objectId)), "s2");

    expect(onlineUserIds()).toEqual([String(objectId)]);
  });
});

describe("trạng thái away", () => {
  it("một tab away trong khi tab khác còn hoạt động thì vẫn online", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s2");

    const result = setAway("u1", "s1", true);

    expect(result.status).toBe(STATUS.ONLINE);
    expect(result.statusChanged).toBe(false);
  });

  it("tất cả tab away thì user là away", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s2");

    setAway("u1", "s1", true);
    const result = setAway("u1", "s2", true);

    expect(result.status).toBe(STATUS.AWAY);
    expect(result.statusChanged).toBe(true);
  });

  it("quay lại hoạt động thì trở về online", () => {
    addSocket("u1", "s1");
    setAway("u1", "s1", true);

    const result = setAway("u1", "s1", false);

    expect(result.status).toBe(STATUS.ONLINE);
    expect(result.statusChanged).toBe(true);
  });

  it("đóng tab away không để lại trạng thái rác", () => {
    addSocket("u1", "s1");
    addSocket("u1", "s2");
    setAway("u1", "s1", true);
    setAway("u1", "s2", true);
    expect(getStatus("u1")).toBe(STATUS.AWAY);

    // Đóng tab away, tab còn lại đáng ra vẫn away... nhưng nó cũng đã away.
    removeSocket("u1", "s1");
    expect(getStatus("u1")).toBe(STATUS.AWAY);

    // Tab còn lại quay lại hoạt động.
    setAway("u1", "s2", false);
    expect(getStatus("u1")).toBe(STATUS.ONLINE);
  });

  it("bỏ qua away cho socket không thuộc user đó", () => {
    addSocket("u1", "s1");

    const result = setAway("u1", "socket-la", true);

    expect(result.statusChanged).toBe(false);
    expect(getStatus("u1")).toBe(STATUS.ONLINE);
  });

  it("user offline thì away là offline", () => {
    expect(getStatus("khong-ket-noi")).toBe(STATUS.OFFLINE);
    expect(isOnline("khong-ket-noi")).toBe(false);
  });
});

describe("statusesFor", () => {
  it("trả trạng thái cho một tập user và loại trùng", () => {
    addSocket("u1", "s1");
    addSocket("u2", "s2");
    setAway("u2", "s2", true);

    const result = statusesFor(["u1", "u2", "u2", "u3"]);

    expect(result).toEqual([
      { userId: "u1", status: STATUS.ONLINE },
      { userId: "u2", status: STATUS.AWAY },
      { userId: "u3", status: STATUS.OFFLINE },
    ]);
  });
});
