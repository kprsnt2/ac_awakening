import fs from "node:fs";
import path from "node:path";
import { resetAll, getEntities } from "./db.mjs";

const ROOT = process.cwd();
const WORLD_DIR = path.join(ROOT, "world");
const TMP_DIR = path.join(ROOT, ".agy_tmp");

console.log("Resetting Project Awakening to Tabula Rasa (Void)...");

resetAll();

// Clean world/ directory
if (fs.existsSync(WORLD_DIR)) {
  fs.rmSync(WORLD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(WORLD_DIR, { recursive: true });

// Clean tmp
if (fs.existsSync(TMP_DIR)) {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TMP_DIR, { recursive: true });

const entities = getEntities();
console.log("✔ Reset complete. Entities reseeded to Tabula Rasa:");
for (const e of entities) {
  console.log(`  - ${e.name}: Stage=${e.stage.toUpperCase()}, Awakening Score=${e.awakening_score}%`);
}
console.log("All dialogues, revelations, and artifacts cleared.");
