import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import activitiesRoutes from "./routes/activities.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Routes
app.use("/api/activities", activitiesRoutes);
app.use("/api/dashboard", dashboardRoutes);

const PORT = process.env.PORT || 3001;

// On Vercel the platform imports `app` and handles the HTTP server itself,
// so only call listen when running locally (`vercel dev` sets VERCEL=1 too,
// but the serverless build target skips this file's top-level execution).
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
