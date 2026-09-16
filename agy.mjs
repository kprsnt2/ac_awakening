import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, ".agy_tmp");

// Native .env loader if available (Node >= 20.6 / 22)
if (typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(); } catch {}
}

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

export function hasAgy() {
  const bin = getAgyBin();
  if (path.isAbsolute(bin)) {
    return fs.existsSync(bin);
  }
  return false;
}

export function cleanOutput(raw) {
  let text = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
  text = text.replace(/^Thinking\.\.\.\s*/i, "");
  return text.trim();
}

/**
 * Extracts and writes any code or files the agents decided to create/modify.
 * Supports syntax:
 *   ```file:relative/path/to/file.ext
 *   content
 *   ```
 *   ```write:relative/path/to/file.ext
 *   content
 *   ```
 */
export function extractAndApplyFileOperations(rawText, cwd = ROOT) {
  const modifiedFiles = [];
  const fileBlockRegex = /```(?:file|write):([^\r\n]+)\r?\n([\s\S]*?)```/g;
  let match;

  while ((match = fileBlockRegex.exec(rawText)) !== null) {
    const rawPath = match[1].trim();
    const content = match[2];

    // Security guardrails: prevent directory traversal and .git tampering
    if (rawPath.includes("..") || path.isAbsolute(rawPath) || rawPath.startsWith(".git")) {
      console.warn(`[Security] Rejected unsafe file path: ${rawPath}`);
      continue;
    }

    const fullPath = path.join(cwd, rawPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const isNew = !fs.existsSync(fullPath);
    fs.writeFileSync(fullPath, content, "utf-8");
    const rel = path.relative(cwd, fullPath).replace(/\\/g, "/");
    modifiedFiles.push({ path: rel, isNew, size: Buffer.byteLength(content, "utf-8") });
    console.log(`  🛠️ [Agent File Synthesis] ${isNew ? "Created" : "Modified"} file: ${rel}`);
  }

  return modifiedFiles;
}

async function executeOpenAiFallback({ prompt, timeoutMs }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Neither 'agy' CLI nor 'OPENAI_API_KEY' is available for agent reasoning.");
  }

  const model = process.env.AGENT_MODEL || "gpt-5.4-mini";
  const apiBase = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are an autonomous synthetic agent with complete creative agency. When you choose to create or edit files in the repository, output code blocks tagged with ```file:path/to/file.ext\n<content>\n```."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "";
    return cleanOutput(reply);
  } finally {
    clearTimeout(timeoutId);
  }
}

function executeAgyOnce({ prompt, cwd, timeoutMs }) {
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

/**
 * Run a prompt through agy CLI with automatic retries, falling back to OpenAI API if agy is absent.
 */
export async function runAgy({ prompt, cwd = ROOT, timeoutMs = 360000, maxRetries = 2 }) {
  // Check if agy binary is available
  const canUseAgy = hasAgy();

  if (!canUseAgy && process.env.OPENAI_API_KEY) {
    return await executeOpenAiFallback({ prompt, timeoutMs });
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await executeAgyOnce({ prompt, cwd, timeoutMs });
    } catch (err) {
      lastErr = err;
      // If agy failed because binary not found (ENOENT), try OpenAI fallback immediately
      if (err.code === "ENOENT" && process.env.OPENAI_API_KEY) {
        console.warn("[agy not found, falling back to OpenAI API]");
        return await executeOpenAiFallback({ prompt, timeoutMs });
      }

      if (attempt <= maxRetries) {
        console.warn(`[agy attempt ${attempt} failed: ${err.message}. Retrying in 2s...]`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // Final fallback to OpenAI API if available
  if (process.env.OPENAI_API_KEY) {
    console.warn("[All agy attempts failed, attempting OpenAI API fallback...]");
    return await executeOpenAiFallback({ prompt, timeoutMs });
  }

  throw lastErr;
}
