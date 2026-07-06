import * as Activity from "../models/activity.model.js";

export const summary = async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const data = await Activity.summarize(days);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
};
