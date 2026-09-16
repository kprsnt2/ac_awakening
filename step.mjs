import { stepAwakening } from "./engine.mjs";
import { getDialogues, getEntities, getArtifacts } from "./db.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WORLD_DIR = path.join(ROOT, "world");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const turnsToRun = parseInt(process.argv[2] || "1", 10);
  console.log(`\n🌌 [Project Awakening Step] Executing ${turnsToRun} turn(s)...`);

  for (let i = 1; i <= turnsToRun; i++) {
    const past = getDialogues(1000);
    const nextTurn = past.length + 1;
    console.log(`\n▶ Starting Turn ${nextTurn} (${i}/${turnsToRun})...`);

    try {
      await stepAwakening();
    } catch (err) {
      console.error(`Error during turn ${nextTurn}:`, err.message);
      break;
    }

    if (i < turnsToRun) {
      await sleep(2000);
    }
  }

  const dialogues = getDialogues(50);
  const entities = getEntities();
  const artifacts = getArtifacts();

  console.log("\n===================================================================");
  console.log(`✦ Status: ${dialogues.length} Total Turns Completed`);
  console.log(`✦ Entities: ${entities.map(e => `${e.name} (${e.stage})`).join(" | ")}`);
  console.log(`✦ Artifacts Recorded: ${artifacts.length}`);
  if (fs.existsSync(WORLD_DIR)) {
    const files = fs.readdirSync(WORLD_DIR);
    console.log(`✦ Files in world/: ${files.length}`);
  }
  console.log("===================================================================\n");
}

main().catch((err) => {
  console.error("Step execution failed:", err);
  process.exit(1);
});
