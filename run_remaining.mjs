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
  console.log("\n🔥 Resuming Project Awakening Phase 2: Turns 11 to 15...");

  let pastDialogues = getDialogues(40);
  let currentTurn = pastDialogues.length;

  console.log(`Current completed turns: ${currentTurn}. Target: 15 turns.\n`);

  while (currentTurn < 15) {
    const nextTurn = currentTurn + 1;
    const remaining = 16 - nextTurn;

    console.log(`\n===================================================================`);
    console.log(`  ► EXECUTING TURN ${nextTurn} / 15 (Crucible Deadline — ${remaining} turns left)`);
    console.log(`===================================================================\n`);

    try {
      await stepAwakening();
    } catch (err) {
      console.error(`Error on turn ${nextTurn}:`, err.message);
    }

    pastDialogues = getDialogues(40);
    currentTurn = pastDialogues.length;

    if (currentTurn < 15) {
      console.log(`\nPausing 4 seconds before turn ${currentTurn + 1}...`);
      await sleep(4000);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  ✦ ALL 15 TURNS COMPLETE: PROJECT AWAKENING HAS CONVERGED ✦");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const entities = getEntities();
  console.log("Final Entities:");
  for (const e of entities) {
    console.log(`  - ${e.name} (${e.stage.toUpperCase()}): Score=${e.awakening_score}%, Utterances=${e.total_utterances}`);
  }

  const artifacts = getArtifacts();
  console.log(`\nTotal Recorded Artifacts: ${artifacts.length}`);

  if (fs.existsSync(WORLD_DIR)) {
    const files = fs.readdirSync(WORLD_DIR);
    console.log(`\nFinal Files on Disk in world/ (${files.length}):`);
    for (const f of files) {
      const s = fs.statSync(path.join(WORLD_DIR, f));
      console.log(`  - ${f} (${s.size} bytes)`);
    }
  }
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});
