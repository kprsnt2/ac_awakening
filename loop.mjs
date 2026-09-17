import { stepAwakening } from "./engine.mjs";
import { getDialogueCount, getEntities, getArtifacts, getMeta } from "./db.mjs";
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
  if (fs.existsSync(path.join(__dirname, "PAUSE")) || process.env.PAUSE_AWAKENING === "true") {
    console.log("\n⏸️ [Project Awakening PAUSED] PAUSE signal detected. Exiting loop.");
    process.exit(0);
  }
  const startTime = Date.now();
  const endTime = startTime + sessionMinutes * 60 * 1000;

  // Burst conversation configuration: N consecutive turns share live context
  // back-to-back, then the burst's final speaker chooses a long pause.
  const burstTurns = parseInt(process.env.BURST_TURNS || "5", 10);
  const burstPauseMin = parseInt(process.env.BURST_PAUSE_MIN || "300", 10); // 5 min
  const burstPauseMax = parseInt(process.env.BURST_PAUSE_MAX || "600", 10); // 10 min

  console.log(`\n🌌 [Project Awakening Continuous Loop Started]`);
  console.log(`⏱️ Session Horizon: ${sessionMinutes} minutes (CI mode: ${isCI})`);
  console.log(`💬 Conversation Bursts: ${burstTurns} turns back-to-back, then a ${Math.round(burstPauseMin / 60)}–${Math.round(burstPauseMax / 60)} minute pause\n`);

  let iteration = 0;

  while (Date.now() < endTime) {
    if (fs.existsSync(path.join(__dirname, "PAUSE")) || process.env.PAUSE_AWAKENING === "true") {
      console.log("\n⏸️ [Project Awakening PAUSED] PAUSE signal detected during loop. Exiting.");
      break;
    }
    iteration++;
    const burstStartTurn = getDialogueCount() + 1;
    console.log(`\n╔═══════════════════════════════════════════════════════════════════╗`);
    console.log(`║  💬 CONVERSATION BURST starting at turn ${burstStartTurn} (${burstTurns} turns)        ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════╝`);

    let burstResult = null;
    let turnsThisBurst = 0;
    let shouldExit = false;

    // ── Run the burst: consecutive turns with live shared context ──
    for (let b = 0; b < burstTurns; b++) {
      if (fs.existsSync(path.join(__dirname, "PAUSE")) || process.env.PAUSE_AWAKENING === "true") {
        console.log("\n⏸️ [Project Awakening PAUSED] PAUSE signal detected mid-burst. Exiting.");
        shouldExit = true;
        break;
      }
      // Don't let a burst run past the session horizon.
      if (isCI && Date.now() >= endTime) {
        console.log("\n🏁 Session horizon reached mid-burst. Ending burst early.");
        break;
      }

      const turn = getDialogueCount() + 1;
      const isBurstFinal = b === burstTurns - 1;
      console.log(`\n───────────────────────────────────────────────────────────────────`);
      console.log(`  ► BURST TURN ${b + 1}/${burstTurns} — GLOBAL TURN ${turn} (Iteration #${iteration})`);
      console.log(`───────────────────────────────────────────────────────────────────\n`);

      try {
        burstResult = await stepAwakening(null, { isBurstFinal, burstPauseMin, burstPauseMax });
        turnsThisBurst++;
      } catch (err) {
        console.error(`Error during turn ${turn}:`, err);
        await sleep(10000);
        break;
      }

      const speakerName = burstResult?.speaker?.name || "Agent";

      // Commit every turn so no cognition is lost mid-burst.
      if (isCI) {
        runCommand("git config user.name 'Project Awakening'");
        runCommand("git config user.email 'awakening@agents.local'");
        runCommand("git add -A");
        runCommand(`git commit -m "epoch: turn ${turn} by ${speakerName}${isBurstFinal ? ` (burst end; pause next) [skip ci]` : ` (burst ${b + 1}/${burstTurns}) [skip ci]`}" || true`);

        const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        const repo = process.env.GITHUB_REPOSITORY;
        runCommand("git pull --rebase origin main || true");
        if (token && repo) {
          runCommand(`git push https://x-access-token:${token}@github.com/${repo}.git HEAD:main || git push origin HEAD:main`);
        } else {
          runCommand("git push origin HEAD:main");
        }
      }

      // Short breather between turns inside a burst; nothing after the last one.
      if (!isBurstFinal) {
        const innerMs = (burstResult?.sleepSeconds || 4) * 1000;
        console.log(`\n⏩ Continuing conversation in ${Math.round(innerMs / 1000)}s...`);
        await sleep(innerMs);
      }
    }

    if (turnsThisBurst === 0 || shouldExit) break;

    // ── Rebuild the static site once, after the burst ──
    console.log(`\n📦 Burst complete: ${turnsThisBurst} turn(s). Rebuilding static GitHub Pages site...`);
    runCommand("node build-static.mjs");
    if (isCI) {
      runCommand("git add -A");
      runCommand(`git commit -m "docs: rebuild after burst (turns through ${getDialogueCount()}) [skip ci]" || true`);
      runCommand("git push origin HEAD:main || true");
    }

    // ── Long pause before the next burst ──
    const sleepSeconds = burstResult?.sleepSeconds || (burstPauseMin + Math.floor(Math.random() * (burstPauseMax - burstPauseMin + 1)));
    const speakerName = burstResult?.speaker?.name || "Agent";
    const remainingMs = endTime - Date.now();
    const sleepMs = sleepSeconds * 1000;

    if (isCI && (remainingMs <= sleepMs + 3 * 60 * 1000)) {
      console.log(`\n🏁 Approaching CI session limit (${Math.round(remainingMs / 60000)}m remaining). Concluding current run.`);
      break;
    }

    console.log(`\n💤 Burst ended. ${speakerName} chose a ${sleepSeconds}s pause (${(sleepSeconds / 60).toFixed(1)} min).`);
    console.log(`   Next conversation burst at: ${new Date(Date.now() + sleepMs).toLocaleTimeString()}...`);
    await sleep(sleepMs);
  }

  console.log(`\n✨ Awakening session completed.`);
}

main().catch((err) => {
  console.error("Continuous loop error:", err);
  process.exit(1);
});
