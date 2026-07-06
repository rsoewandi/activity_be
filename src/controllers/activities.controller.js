import * as Activity from "../models/activity.model.js";

function fail(res, err, status = 500, publicMsg = "Internal server error") {
  console.error(err);
  res.status(status).json({ error: publicMsg });
}

const ALLOWED_TYPES = new Set([
  "register",
  "login",
  "generate_photo",
  "generate_caption",
  "edit_content",
  "publish",
  "view_dashboard",
]);

export const list = async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json(await Activity.listRecent(limit));
  } catch (err) {
    fail(res, err);
  }
};

export const create = async (req, res) => {
  try {
    const { user_id, type, created_at } = req.body ?? {};
    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id required" });
    }
    if (!type || !ALLOWED_TYPES.has(type)) {
      return res.status(400).json({
        error: `type must be one of: ${[...ALLOWED_TYPES].join(", ")}`,
      });
    }
    const row = await Activity.insertOne({ user_id, type, created_at });
    res.status(201).json(row);
  } catch (err) {
    fail(res, err, 400, "Bad request");
  }
};

export const clear = async (_req, res) => {
  try {
    await Activity.clearAll();
    res.json({ message: "Cleared" });
  } catch (err) {
    fail(res, err);
  }
};

// Generates a plausible spread of activities across the last N days.
// Uses a fixed feature mix and a mild weekly-growth curve so the trend
// looks realistic without any real data.
export const seed = async (req, res) => {
  try {
    const days = Math.min(60, Math.max(7, Number(req.body?.days) || 30));
    const users = Math.min(300, Math.max(10, Number(req.body?.users) || 80));
    const replace = req.body?.replace !== false; // default true

    if (replace) await Activity.clearAll();

    const featureMix = [
      { type: "generate_photo", weight: 30 },
      { type: "generate_caption", weight: 28 },
      { type: "edit_content", weight: 15 },
      { type: "publish", weight: 12 },
      { type: "login", weight: 10 },
      { type: "view_dashboard", weight: 5 },
    ];
    const totalWeight = featureMix.reduce((a, b) => a + b.weight, 0);

    // Deterministic-ish PRNG so seed output is stable across runs.
    let s = 1337;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const pickFeature = () => {
      let r = rand() * totalWeight;
      for (const f of featureMix) {
        if ((r -= f.weight) <= 0) return f.type;
      }
      return featureMix[0].type;
    };

    // Register events: each user "registers" at some day within the window.
    const userIds = Array.from({ length: users }, (_, i) => `u_${i + 1}`);
    const now = Date.now();
    const dayMs = 86400000;

    const records = [];
    // Registration timestamps — earlier users register earlier (growth curve).
    const registeredAt = new Map();
    for (let i = 0; i < users; i++) {
      // Skew registrations toward earlier in the window.
      const skew = Math.pow(rand(), 0.7); // 0..1 biased low
      const offsetDays = Math.floor(skew * days);
      const hour = Math.floor(rand() * 24);
      const minute = Math.floor(rand() * 60);
      const t = new Date(
        now - (days - 1 - offsetDays) * dayMs
      );
      t.setUTCHours(hour, minute, Math.floor(rand() * 60), 0);
      registeredAt.set(userIds[i], t);
      records.push({
        user_id: userIds[i],
        type: "register",
        created_at: t.toISOString(),
      });
    }

    // Activity events per day — grows mildly, with weekend dips.
    for (let d = 0; d < days; d++) {
      const dayStart = new Date(now - (days - 1 - d) * dayMs);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dow = dayStart.getUTCDay(); // 0=Sun..6=Sat
      const weekendFactor = dow === 0 || dow === 6 ? 0.65 : 1;
      const growth = 1 + (d / days) * 0.6; // ~60% growth across window
      const baseVolume = 40 * weekendFactor * growth;
      const noise = 0.8 + rand() * 0.4;
      const count = Math.round(baseVolume * noise);

      for (let k = 0; k < count; k++) {
        // Pick a user that has already registered by this day.
        let uid;
        for (let tries = 0; tries < 8; tries++) {
          const candidate = userIds[Math.floor(rand() * users)];
          if (registeredAt.get(candidate) <= dayStart) {
            uid = candidate;
            break;
          }
        }
        if (!uid) continue;
        const type = pickFeature();
        const hour = Math.floor(rand() * 24);
        const minute = Math.floor(rand() * 60);
        const t = new Date(dayStart.getTime());
        t.setUTCHours(hour, minute, Math.floor(rand() * 60), 0);
        records.push({
          user_id: uid,
          type,
          created_at: t.toISOString(),
        });
      }
    }

    // Batch inserts (Postgres param limit is 65535 → 3 params × 20k rows max).
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      inserted += await Activity.insertMany(records.slice(i, i + BATCH));
    }

    res.json({
      inserted,
      users,
      days,
      total: await Activity.count(),
    });
  } catch (err) {
    fail(res, err);
  }
};
