import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const url = process.env.DATABASE_URL || "";
const wantSsl = /[?&]sslmode=(require|verify-|prefer)/i.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: wantSsl ? { rejectUnauthorized: false } : false,
});

export default pool;
