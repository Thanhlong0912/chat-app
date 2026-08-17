import { describe, expect, it } from "vitest";
import { ACTIONS, ROLES, can, getRole, isMember } from "../src/domain/groupPermissions.js";

const { OWNER, ADMIN, MEMBER } = ROLES;

describe("can()", () => {
  it("mọi vai trò đều gửi tin, rời nhóm, sửa/xoá nội dung của mình", () => {
    for (const role of [OWNER, ADMIN, MEMBER]) {
      expect(can(role, ACTIONS.SEND)).toBe(true);
      expect(can(role, ACTIONS.LEAVE)).toBe(true);
      expect(can(role, ACTIONS.EDIT_OWN)).toBe(true);
      expect(can(role, ACTIONS.DELETE_OWN)).toBe(true);
    }
  });

  it("chỉ owner và admin thêm thành viên hoặc sửa thông tin nhóm", () => {
    expect(can(OWNER, ACTIONS.MEMBER_ADD)).toBe(true);
    expect(can(ADMIN, ACTIONS.MEMBER_ADD)).toBe(true);
    expect(can(MEMBER, ACTIONS.MEMBER_ADD)).toBe(false);

    expect(can(OWNER, ACTIONS.GROUP_UPDATE)).toBe(true);
    expect(can(ADMIN, ACTIONS.GROUP_UPDATE)).toBe(true);
    expect(can(MEMBER, ACTIONS.GROUP_UPDATE)).toBe(false);
  });

  describe("member:remove", () => {
    it("owner xoá được admin và member", () => {
      expect(can(OWNER, ACTIONS.MEMBER_REMOVE, { targetRole: ADMIN })).toBe(true);
      expect(can(OWNER, ACTIONS.MEMBER_REMOVE, { targetRole: MEMBER })).toBe(true);
    });

    it("admin chỉ xoá được member thường, không xoá được admin khác", () => {
      expect(can(ADMIN, ACTIONS.MEMBER_REMOVE, { targetRole: MEMBER })).toBe(true);
      expect(can(ADMIN, ACTIONS.MEMBER_REMOVE, { targetRole: ADMIN })).toBe(false);
    });

    it("không ai xoá được owner", () => {
      for (const role of [OWNER, ADMIN, MEMBER]) {
        expect(can(role, ACTIONS.MEMBER_REMOVE, { targetRole: OWNER })).toBe(false);
      }
    });

    it("member không xoá được ai", () => {
      expect(can(MEMBER, ACTIONS.MEMBER_REMOVE, { targetRole: MEMBER })).toBe(false);
    });

    it("thiếu targetRole thì từ chối", () => {
      expect(can(OWNER, ACTIONS.MEMBER_REMOVE)).toBe(false);
    });
  });

  describe("member:setRole", () => {
    it("chỉ owner phong/giáng quyền", () => {
      expect(can(OWNER, ACTIONS.MEMBER_SET_ROLE, { targetRole: MEMBER })).toBe(true);
      expect(can(ADMIN, ACTIONS.MEMBER_SET_ROLE, { targetRole: MEMBER })).toBe(false);
      expect(can(MEMBER, ACTIONS.MEMBER_SET_ROLE, { targetRole: MEMBER })).toBe(false);
    });

    it("không giáng quyền owner qua đường này — phải dùng owner:transfer", () => {
      expect(can(OWNER, ACTIONS.MEMBER_SET_ROLE, { targetRole: OWNER })).toBe(false);
    });
  });

  it("chỉ owner chuyển quyền sở hữu hoặc xoá nhóm", () => {
    expect(can(OWNER, ACTIONS.OWNER_TRANSFER)).toBe(true);
    expect(can(ADMIN, ACTIONS.OWNER_TRANSFER)).toBe(false);
    expect(can(OWNER, ACTIONS.CONVERSATION_DELETE)).toBe(true);
    expect(can(ADMIN, ACTIONS.CONVERSATION_DELETE)).toBe(false);
  });

  it("chỉ owner và admin xoá được tin nhắn của người khác", () => {
    expect(can(OWNER, ACTIONS.MESSAGE_DELETE_ANY)).toBe(true);
    expect(can(ADMIN, ACTIONS.MESSAGE_DELETE_ANY)).toBe(true);
    expect(can(MEMBER, ACTIONS.MESSAGE_DELETE_ANY)).toBe(false);
  });

  it("mặc định từ chối: action lạ hoặc vai trò lạ luôn false", () => {
    expect(can(OWNER, "action:khong-ton-tai")).toBe(false);
    expect(can("superadmin", ACTIONS.GROUP_UPDATE)).toBe(false);
    expect(can(null, ACTIONS.SEND)).toBe(false);
    expect(can(undefined, ACTIONS.SEND)).toBe(false);
  });
});

describe("getRole()", () => {
  const conversation = (participants, createdBy) => ({
    type: "group",
    participants,
    group: { createdBy },
  });

  it("ưu tiên field role khi có", () => {
    const convo = conversation([{ userId: "u1", role: ADMIN }], "u1");

    expect(getRole(convo, "u1")).toBe(ADMIN);
  });

  it("fallback về createdBy khi chưa có role", () => {
    const convo = conversation([{ userId: "u1" }, { userId: "u2" }], "u1");

    expect(getRole(convo, "u1")).toBe(OWNER);
    expect(getRole(convo, "u2")).toBe(MEMBER);
  });

  it("trả null cho người không phải thành viên", () => {
    const convo = conversation([{ userId: "u1" }], "u1");

    expect(getRole(convo, "nguoi-la")).toBeNull();
  });

  it("direct conversation luôn là member", () => {
    const convo = { type: "direct", participants: [{ userId: "u1" }, { userId: "u2" }] };

    expect(getRole(convo, "u1")).toBe(MEMBER);
  });

  it("so sánh id theo string, nên ObjectId và string là như nhau", () => {
    const objectIdLike = { toString: () => "507f1f77bcf86cd799439011" };
    const convo = conversation([{ userId: objectIdLike }], objectIdLike);

    expect(getRole(convo, "507f1f77bcf86cd799439011")).toBe(OWNER);
  });

  it("đọc được userId đã populate thành object", () => {
    const convo = conversation([{ userId: { _id: "u1", displayName: "Long" } }], "u1");

    expect(getRole(convo, "u1")).toBe(OWNER);
  });
});

describe("isMember()", () => {
  it("phân biệt thành viên và người ngoài", () => {
    const convo = { type: "group", participants: [{ userId: "u1" }] };

    expect(isMember(convo, "u1")).toBe(true);
    expect(isMember(convo, "u2")).toBe(false);
  });

  it("an toàn với conversation rỗng hoặc null", () => {
    expect(isMember(null, "u1")).toBe(false);
    expect(isMember({}, "u1")).toBe(false);
  });
});
