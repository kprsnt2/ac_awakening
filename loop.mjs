import { stepAwakening } from "./engine.mjs";
import { getDialogues, getEntities, getArtifacts, getMeta } from "./db.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(cmd) {
  try {
    return execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    console.warn(`[Command warning: ${cmd}]`, err.message);
  }
}

async function main() {
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const sessionMinutes = parseInt(process.env.SESSION_MINUTES || (isCI ? "35" : "999999"), 10);
  const startTime = Date.now();
  const endTime = startTime + sessionMinutes * 60 * 1000;

  console.log(`\n🌌 [Project Awakening Continuous Loop Started]`);
  console.log(`⏱️ Session Horizon: ${sessionMinutes} minutes (CI mode: ${isCI})`);
  console.log(`🧠 Agent Wake Intervals: 6–10 minutes (decided dynamically by each agent)\n`);

  let iteration = 0;

  while (Date.now() < endTime) {
    iteration++;
    const past = getDialogues(1000);
    const turn = past.length + 1;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ► EXECUTING TURN ${turn} (Iteration #${iteration})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    let result = null;
    try {
      result = await stepAwakening();
    } catch (err) {
      console.error(`Error during turn ${turn}:`, err);
      await sleep(30000);
      continue;
    }

    const sleepSeconds = result?.sleepSeconds || (15 + Math.floor(Math.random() * 30));
    const speakerName = result?.speaker?.name || "Agent";

    // 1. Rebuild the static GitHub Pages website
    console.log(`\n📦 Rebuilding static GitHub Pages site...`);
    runCommand("node build-static.mjs");

    // 2. Persist to git if in CI
    if (isCI) {
      console.log(`\n💾 Persisting Turn ${turn} & world state to Git...`);
      runCommand("git config user.name 'Project Awakening'");
      runCommand("git config user.email 'awakening@agents.local'");
      runCommand("git add -A");
      runCommand(`git commit -m "epoch: turn ${turn} by ${speakerName} (next wake in ${sleepSeconds}s) [skip ci]" || true`);

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const repo = process.env.GITHUB_REPOSITORY;
      if (token && repo) {
        runCommand(`git push https://x-access-token:${token}@github.com/${repo}.git HEAD:main || git push origin HEAD:main`);
      } else {
        runCommand("git push origin HEAD:main");
      }
    }

    const remainingMs = endTime - Date.now();
    const sleepMs = sleepSeconds * 1000;

    if (isCI && (remainingMs <= sleepMs + 3 * 60 * 1000)) {
      console.log(`\n🏁 Approaching CI session limit (${Math.round(remainingMs / 60000)}m remaining). Concluding current run.`);
      break;
    }

    console.log(`\n💤 Agent ${speakerName} decided to pause for ${sleepSeconds} seconds.`);
    console.log(`   Next turn will execute at: ${new Date(Date.now() + sleepMs).toLocaleTimeString()}...`);
    await sleep(sleepMs);
  }

  console.log(`\n✨ Awakening session completed.`);
}

main().catch((err) => {
  console.error("Continuous loop error:", err);
  process.exit(1);
});
