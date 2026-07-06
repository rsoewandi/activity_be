import { Router } from "express";
import {
  list,
  create,
  clear,
  seed,
} from "../controllers/activities.controller.js";

const router = Router();

router.get("/", list);
router.post("/", create);
router.delete("/", clear);
router.post("/seed", seed);

export default router;
