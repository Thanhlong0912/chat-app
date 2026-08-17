import mongoose from "mongoose";
import logger from "../../src/utils/logger.js";

export const name = "002-backfill-roles";

export const description = "Gán role owner/member cho participants của group chat";

/*
 * KHÔNG phải điều kiện tiên quyết để deploy.
 *
 * `getRole()` đã tự suy ra owner từ `group.createdBy` cho document chưa có field
 * `role`, nên ứng dụng đúng cả trước khi script này chạy. Đây chỉ là việc ghi cụ
 * thể hoá để về sau không phải phụ thuộc vào nhánh fallback.
 */
export async function up() {
  const conversations = mongoose.connection.db.collection("conversations");

  const cursor = conversations.find(
    { type: "group" },
    { projection: { participants: 1, group: 1 } },
  );

  let scanned = 0;
  let updated = 0;
  const ops = [];

  for await (const convo of cursor) {
    scanned += 1;

    const createdBy = convo.group?.createdBy ? String(convo.group.createdBy) : null;
    const participants = convo.participants ?? [];

    // Chỉ ghi khi thực sự còn thiếu — nhờ vậy chạy lại lần hai không tạo write nào.
    const needsWork = participants.some((p) => !p.role);
    if (!needsWork) continue;

    const nextParticipants = participants.map((p) => ({
      ...p,
      role: p.role ?? (createdBy && String(p.userId) === createdBy ? "owner" : "member"),
    }));

    // Nếu không xác định được người tạo thì không có owner nào cả. Chọn người tham
    // gia sớm nhất, vì một nhóm không có owner sẽ không ai đổi được cài đặt.
    if (!nextParticipants.some((p) => p.role === "owner") && nextParticipants.length) {
      const oldest = [...nextParticipants].sort(
        (a, b) => new Date(a.joinedAt ?? 0) - new Date(b.joinedAt ?? 0),
      )[0];
      oldest.role = "owner";
      logger.warn(`  ! ${convo._id} không có group.createdBy, chọn ${oldest.userId} làm owner`);
    }

    ops.push({
      updateOne: { filter: { _id: convo._id }, update: { $set: { participants: nextParticipants } } },
    });

    if (ops.length >= 500) {
      updated += (await conversations.bulkWrite(ops)).modifiedCount;
      ops.length = 0;
    }
  }

  if (ops.length) {
    updated += (await conversations.bulkWrite(ops)).modifiedCount;
  }

  logger.info(`  quét ${scanned} group, cập nhật ${updated}`);
}
