import mongoose from "mongoose";
import { connectDB } from "../src/libs/db.js";
import logger from "../src/utils/logger.js";

import * as fixIndexes from "./migrations/001-fix-indexes.js";
import * as backfillRoles from "./migrations/002-backfill-roles.js";
import * as backfillLastRead from "./migrations/003-backfill-lastread.js";

/**
 * Chạy migration thủ công: `npm run migrate`.
 *
 * Cố tình KHÔNG chạy tự động khi server khởi động: nhiều instance cùng boot sẽ
 * chạy song song, và một migration nặng sẽ chặn việc deploy.
 *
 * Mọi migration đều idempotent — chạy lại nhiều lần là an toàn, và đó cũng là
 * cách kiểm chứng: chạy hai lần, lần thứ hai không được đổi gì.
 */
const MIGRATIONS = [fixIndexes, backfillRoles, backfillLastRead];

const run = async () => {
  const only = process.argv[2];

  await connectDB();

  const selected = only ? MIGRATIONS.filter((m) => m.name === only) : MIGRATIONS;

  if (only && selected.length === 0) {
    logger.error(`Không tìm thấy migration '${only}'. Có: ${MIGRATIONS.map((m) => m.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  for (const migration of selected) {
    logger.info(`▶ ${migration.name}: ${migration.description}`);
    const startedAt = Date.now();

    await migration.up();

    logger.info(`✔ ${migration.name} xong trong ${Date.now() - startedAt}ms`);
  }

  logger.info("Tất cả migration đã chạy xong.");
};

run()
  .catch((error) => {
    logger.error("Migration thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
