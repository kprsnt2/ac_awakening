import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, ".agy_tmp");

export function getAgyBin() {
  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) {
    return process.env.AGY_BIN;
  }
  if (process.platform === "win32") {
    const localAgy = path.join(
      os.homedir(),
      "AppData",
      "Local",
      "agy",
      "bin",
      "agy.exe"
    );
    if (fs.existsSync(localAgy)) return localAgy;
  }
  return "agy";
}

export function cleanOutput(raw) {
  // Strip ANSI color codes
  let text = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
  // Strip common CLI banners or "Thinking..." preamble
  text = text.replace(/^Thinking\.\.\.\s*/i, "");
  return text.trim();
}

/**
 * Run a prompt through agy CLI non-interactively with auto-granted permissions.
 */
export async function runAgy({ prompt, cwd = ROOT, timeoutMs = 120000 }) {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const promptFile = path.join(TMP_DIR, `prompt_${tmpId}.txt`);
  fs.writeFileSync(promptFile, prompt, "utf-8");

  const bin = getAgyBin();
  const args = ["--dangerously-skip-permissions", "-p", `@${promptFile}`];

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
      reject(new Error(`agy execution timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(promptFile); } catch {}

      if (killed) return;
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`agy exited with code ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve(cleanOutput(stdout || stderr));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(promptFile); } catch {}
      reject(err);
    });
  });
}
