import { beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "../src/domain/groupPermissions.js";
import {
  clearMembershipCache,
  invalidateMembership,
  loadMembership,
  loadMembershipCached,
} from "../src/services/membershipService.js";
import Conversation from "../src/models/Conversation.js";
import { makeGroupConversation, makeUser } from "./helpers/factories.js";

beforeEach(() => clearMembershipCache());

describe("loadMembership", () => {
  it("id sai định dạng → 400 INVALID_ID, không phải CastError 500", async () => {
    const user = await makeUser();

    await expect(loadMembership(user._id, "khong-phai-id")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_ID",
    });
  });

  it("conversation không tồn tại → 404", async () => {
    const user = await makeUser();

    await expect(
      loadMembership(user._id, "507f1f77bcf86cd799439011"),
    ).rejects.toMatchObject({ status: 404, code: "CONVERSATION_NOT_FOUND" });
  });

  it("không phải thành viên → 403", async () => {
    const [owner, outsider] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner);

    await expect(loadMembership(outsider._id, group._id)).rejects.toMatchObject({
      status: 403,
      code: "NOT_A_MEMBER",
    });
  });

  it("trả về conversation, participant và role cho thành viên", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    const result = await loadMembership(member._id, group._id);

    expect(String(result.conversation._id)).toBe(String(group._id));
    expect(String(result.participant.userId)).toBe(String(member._id));
    expect(result.role).toBe(ROLES.MEMBER);
  });

  it("nhận diện owner qua field role", async () => {
    const owner = await makeUser();
    const group = await makeGroupConversation(owner);

    const { role } = await loadMembership(owner._id, group._id);

    expect(role).toBe(ROLES.OWNER);
  });

  it("suy ra owner từ group.createdBy khi document chưa có field role", async () => {
    // Đây là hình dạng của dữ liệu production hiện tại: chưa chạy backfill.
    const [creator, other] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(creator, [other]);

    await Conversation.collection.updateOne(
      { _id: group._id },
      { $unset: { "participants.0.role": "", "participants.1.role": "" } },
    );

    const creatorResult = await loadMembership(creator._id, group._id);
    const otherResult = await loadMembership(other._id, group._id);

    // Ứng dụng phải đúng TRƯỚC khi backfill chạy — backfill chỉ là tối ưu.
    expect(creatorResult.role).toBe(ROLES.OWNER);
    expect(otherResult.role).toBe(ROLES.MEMBER);
  });

  it("direct conversation không có thứ bậc vai trò", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const convo = await Conversation.create({
      type: "direct",
      participants: [{ userId: a._id }, { userId: b._id }],
    });

    const { role } = await loadMembership(a._id, convo._id);

    expect(role).toBe(ROLES.MEMBER);
  });
});

describe("loadMembershipCached", () => {
  it("lần gọi thứ hai lấy từ cache", async () => {
    const owner = await makeUser();
    const group = await makeGroupConversation(owner);

    const first = await loadMembershipCached(owner._id, group._id);
    const second = await loadMembershipCached(owner._id, group._id);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.role).toBe(ROLES.OWNER);
  });

  it("invalidateMembership buộc đọc lại từ DB", async () => {
    const owner = await makeUser();
    const group = await makeGroupConversation(owner);

    await loadMembershipCached(owner._id, group._id);
    invalidateMembership(String(group._id));

    const afterInvalidate = await loadMembershipCached(owner._id, group._id);

    expect(afterInvalidate.cached).toBe(false);
  });

  it("invalidateMembership xoá mọi user của một conversation", async () => {
    const [owner, member] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner, [member]);

    await loadMembershipCached(owner._id, group._id);
    await loadMembershipCached(member._id, group._id);

    invalidateMembership(String(group._id));

    expect((await loadMembershipCached(owner._id, group._id)).cached).toBe(false);
    expect((await loadMembershipCached(member._id, group._id)).cached).toBe(false);
  });

  it("không cache kết quả thất bại, nên người mới được thêm dùng được ngay", async () => {
    const [owner, joiner] = await Promise.all([makeUser(), makeUser()]);
    const group = await makeGroupConversation(owner);

    await expect(loadMembershipCached(joiner._id, group._id)).rejects.toMatchObject({
      code: "NOT_A_MEMBER",
    });

    group.participants.push({ userId: joiner._id, role: ROLES.MEMBER });
    await group.save();

    // Nếu lỗi bị cache thì người này phải chờ hết TTL 30s mới vào được nhóm.
    const result = await loadMembershipCached(joiner._id, group._id);
    expect(result.role).toBe(ROLES.MEMBER);
  });
});
