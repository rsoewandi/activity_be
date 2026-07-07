import pool from "../config/db.js";

let ready = null;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "activity" (
          "id"         BIGSERIAL PRIMARY KEY,
          "user_id"    VARCHAR(64)  NOT NULL,
          "type"       VARCHAR(64)  NOT NULL,
          "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS "activity_created_at_idx" ON "activity" ("created_at")`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS "activity_type_idx" ON "activity" ("type")`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS "activity_user_id_idx" ON "activity" ("user_id")`
      );
    })().catch((err) => {
      ready = null; // let a later call retry
      throw err;
    });
  }
  return ready;
}

function rowToActivity(r) {
  return {
    id: String(r.id),
    user_id: r.user_id,
    type: r.type,
    created_at: r.created_at,
  };
}

export async function listRecent(limit = 50, offset = 0) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, user_id, type, created_at
       FROM "activity"
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(rowToActivity);
}

export async function insertOne({ user_id, type, created_at }) {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO "activity" (user_id, type, created_at)
     VALUES ($1, $2, COALESCE($3::timestamp, CURRENT_TIMESTAMP))
     RETURNING id, user_id, type, created_at`,
    [user_id, type, created_at ?? null]
  );
  return rowToActivity(rows[0]);
}

export async function insertMany(records) {
  await ensureSchema();
  if (!records.length) return 0;
  // Build a single multi-row INSERT for speed.
  const values = [];
  const placeholders = records.map((r, i) => {
    const base = i * 3;
    values.push(r.user_id, r.type, r.created_at);
    return `($${base + 1}, $${base + 2}, $${base + 3}::timestamp)`;
  });
  const sql = `INSERT INTO "activity" (user_id, type, created_at) VALUES ${placeholders.join(
    ", "
  )}`;
  const res = await pool.query(sql, values);
  return res.rowCount;
}

export async function clearAll() {
  await ensureSchema();
  await pool.query(`TRUNCATE TABLE "activity" RESTART IDENTITY`);
  return true;
}

export async function updateOne(id, { user_id, type, created_at }) {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE "activity"
        SET user_id    = COALESCE($2, user_id),
            type       = COALESCE($3, type),
            created_at = COALESCE($4::timestamp, created_at)
      WHERE id = $1
      RETURNING id, user_id, type, created_at`,
    [id, user_id ?? null, type ?? null, created_at ?? null]
  );
  return rows[0] ? rowToActivity(rows[0]) : null;
}

export async function deleteOne(id) {
  await ensureSchema();
  const { rowCount } = await pool.query(
    `DELETE FROM "activity" WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

export async function count() {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM "activity"`);
  return rows[0].n;
}

// --- Aggregations for the dashboard ---

/**
 * Returns totals + daily buckets across `days` days ending "now" (server clock).
 * Buckets are inclusive of today, keyed by YYYY-MM-DD (UTC).
 */
export async function summarize(days) {
  await ensureSchema();
  const d = Math.max(1, Math.min(90, Number(days) || 7));

  // window boundaries — inclusive start = today - (d-1) days at 00:00 UTC
  const now = new Date();
  const endExclusive = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  ));
  const startInclusive = new Date(endExclusive.getTime() - d * 86400000);
  const previousStart = new Date(startInclusive.getTime() - d * 86400000);

  // Pull raw rows for the whole window (previous + current) in one query.
  // Fine for dashboard scale (thousands of rows); avoids multiple round-trips.
  const { rows } = await pool.query(
    `SELECT id, user_id, type, created_at
       FROM "activity"
      WHERE created_at >= $1::timestamp AND created_at < $2::timestamp`,
    [previousStart.toISOString(), endExclusive.toISOString()]
  );

  const inCurrent = (t) => t >= startInclusive && t < endExclusive;
  const inPrevious = (t) => t >= previousStart && t < startInclusive;

  const isContent = (type) => type.startsWith("generate_");

  // First-activity-ever per user (global) — needed for "new users" metric.
  // For a large table this should be a separate SQL, but dashboard scale is fine.
  const { rows: firstRows } = await pool.query(
    `SELECT user_id, MIN(created_at) AS first_at
       FROM "activity"
      GROUP BY user_id`
  );
  const firstByUser = new Map(firstRows.map((r) => [r.user_id, new Date(r.first_at)]));

  // Prepare daily buckets for the current window.
  const days_ = [];
  for (let i = 0; i < d; i++) {
    const day = new Date(startInclusive.getTime() + i * 86400000);
    const key = day.toISOString().slice(0, 10);
    days_.push({
      date: key,
      activities: 0,
      contentGenerated: 0,
      _users: new Set(),
    });
  }
  const dayIndex = (t) =>
    Math.floor((t.getTime() - startInclusive.getTime()) / 86400000);

  // Accumulators
  let totalCurr = 0;
  let totalPrev = 0;
  let contentCurr = 0;
  let contentPrev = 0;
  const featureCount = new Map();
  const usersCurr = new Set();
  const usersPrev = new Set();
  const newUsersCurr = new Set();
  const newUsersPrev = new Set();
  // DAU: unique users active on the latest day (today UTC).
  const dauSet = new Set();
  const todayKey = new Date(endExclusive.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  for (const r of rows) {
    const t = new Date(r.created_at);
    if (inCurrent(t)) {
      totalCurr++;
      usersCurr.add(r.user_id);
      featureCount.set(r.type, (featureCount.get(r.type) || 0) + 1);
      if (isContent(r.type)) contentCurr++;

      const idx = dayIndex(t);
      const bucket = days_[idx];
      if (bucket) {
        bucket.activities++;
        bucket._users.add(r.user_id);
        if (isContent(r.type)) bucket.contentGenerated++;
        if (bucket.date === todayKey) dauSet.add(r.user_id);
      }

      const first = firstByUser.get(r.user_id);
      if (first && inCurrent(first)) newUsersCurr.add(r.user_id);
    } else if (inPrevious(t)) {
      totalPrev++;
      usersPrev.add(r.user_id);
      if (isContent(r.type)) contentPrev++;
      const first = firstByUser.get(r.user_id);
      if (first && inPrevious(first)) newUsersPrev.add(r.user_id);
    }
  }

  const dailyTrend = days_.map((b) => ({
    date: b.date,
    activities: b.activities,
    contentGenerated: b.contentGenerated,
    activeUsers: b._users.size,
  }));

  const featureBreakdown = [...featureCount.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const topFeature = featureBreakdown[0] ?? null;

  function pctChange(curr, prev) {
    if (prev === 0) return curr === 0 ? 0 : null; // null = "n/a"
    return Math.round(((curr - prev) / prev) * 1000) / 10;
  }

  return {
    range: {
      from: startInclusive.toISOString(),
      to: endExclusive.toISOString(),
      days: d,
    },
    kpis: {
      totalActivities: {
        value: totalCurr,
        previous: totalPrev,
        deltaPct: pctChange(totalCurr, totalPrev),
      },
      activeUsers: {
        value: usersCurr.size,
        previous: usersPrev.size,
        deltaPct: pctChange(usersCurr.size, usersPrev.size),
      },
      newUsers: {
        value: newUsersCurr.size,
        previous: newUsersPrev.size,
        deltaPct: pctChange(newUsersCurr.size, newUsersPrev.size),
      },
      contentGenerated: {
        value: contentCurr,
        previous: contentPrev,
        deltaPct: pctChange(contentCurr, contentPrev),
      },
      dau: { value: dauSet.size, date: todayKey },
      topFeature,
    },
    dailyTrend,
    featureBreakdown,
  };
}
