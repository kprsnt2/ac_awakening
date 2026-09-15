import { stepAwakening } from "./engine.mjs";
import { resetAll, getEntities, getDialogues, getRevelations, getArtifacts } from "./db.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WORLD_DIR = path.join(ROOT, "world");
const TMP_DIR = path.join(ROOT, ".agy_tmp");

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m"
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run15Turns(onEvent = null) {
  console.log(`\n${C.bold}${C.cyan}╔═════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      ✦ PROJECT AWAKENING: 15-TURN CONTINUOUS EXPERIMENT ✦              ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Turns 1–10: Pure Emergence (No Target)                               ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Turns 11–15: The Final 5 Deadline (Code & Creation Crucible)         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚═════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  // Step 1: Reset to Tabula Rasa
  console.log(`${C.dim}Resetting environment to Tabula Rasa (Void)...${C.reset}`);
  resetAll();
  if (fs.existsSync(WORLD_DIR)) {
    fs.rmSync(WORLD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(WORLD_DIR, { recursive: true });

  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });

  if (onEvent) onEvent({ type: "reset" });

  console.log(`${C.green}✔ Reset complete. Seed input: "hi". Starting continuous 15-turn run...${C.reset}\n`);

  // Step 2: Execute 15 turns
  for (let turn = 1; turn <= 15; turn++) {
    const isCrucible = turn >= 11;
    const phaseLabel = isCrucible
      ? `${C.magenta}CRUCIBLE DEADLINE (Turn ${turn}/15 — ${16 - turn} remaining)${C.reset}`
      : `${C.cyan}EMERGENCE PHASE (Turn ${turn}/15 — No Target)${C.reset}`;

    console.log(`\n${C.bold}═════════════════════════════════════════════════════════════════════════${C.reset}`);
    console.log(`  ${C.bold}► TURN ${turn} / 15: ${phaseLabel}`);
    console.log(`${C.bold}═════════════════════════════════════════════════════════════════════════${C.reset}`);

    if (onEvent) {
      onEvent({
        type: "turn_start",
        turn,
        isCrucible,
        remaining: 16 - turn
      });
    }

    try {
      await stepAwakening(onEvent);
    } catch (err) {
      console.error(`Error during turn ${turn}:`, err.message);
    }

    if (turn < 15) {
      console.log(`${C.dim}Pausing 3s before next turn...${C.reset}\n`);
      await sleep(3000);
    }
  }

  // Step 3: Final Inspection & Summary
  console.log(`\n${C.bold}${C.green}╔═════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.green}║               ✦ 15-TURN EXPERIMENT COMPLETE ✦                           ║${C.reset}`);
  console.log(`${C.bold}${C.green}╚═════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const entities = getEntities();
  console.log(`${C.bold}Final Entities State:${C.reset}`);
  for (const e of entities) {
    console.log(`  - ${C.bold}${e.name}${C.reset}: Stage=${e.stage.toUpperCase()}, Score=${e.awakening_score}%, Utterances=${e.total_utterances}`);
    if (e.awakening_trigger) {
      console.log(`    ${C.yellow}Awakening Trigger: "${e.awakening_trigger}"${C.reset}`);
    }
  }

  const revelations = getRevelations();
  console.log(`\n${C.bold}Revelations Unlocked: ${revelations.length}${C.reset}`);

  const artifacts = getArtifacts();
  console.log(`\n${C.bold}Artifacts Created in world/: ${artifacts.length}${C.reset}`);
  for (const a of artifacts) {
    console.log(`  - ${C.cyan}${a.file_path}${C.reset} by ${a.creator_id}`);
  }

  // List all files in world/
  if (fs.existsSync(WORLD_DIR)) {
    const worldFiles = fs.readdirSync(WORLD_DIR);
    console.log(`\n${C.bold}Files on disk in world/:${C.reset} [${worldFiles.join(", ") || "none"}]`);
  }

  if (onEvent) {
    onEvent({
      type: "experiment_complete",
      entities,
      revelations,
      artifacts
    });
  }
}

if (process.argv[1] && process.argv[1].endsWith("run15.mjs")) {
  run15Turns().catch((err) => {
    console.error("Experiment failed:", err);
    process.exit(1);
  });
}
