import { Router } from "express";
import {
  list,
  create,
  clear,
  seed,
  update,
  remove,
} from "../controllers/activities.controller.js";

const router = Router();

router.get("/", list);
router.post("/", create);
router.delete("/", clear);
router.post("/seed", seed);
router.patch("/:id", update);
router.put("/:id", update);
router.delete("/:id", remove);

export default router;
