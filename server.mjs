import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initDb,
  getEntities,
  getDialogues,
  getDialogueCount,
  getRevelations,
  getArtifacts,
  getDistinctArtifacts,
  resetAll
} from "./db.mjs";
import { stepAwakening } from "./engine.mjs";
import { run15Turns } from "./run15.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

initDb();

let isStepRunning = false;
let isAutoLooping = false;
let autoLoopTimer = null;
const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function triggerStep() {
  if (isStepRunning) return { running: true };
  isStepRunning = true;
  broadcast({ type: "step_start" });
  try {
    const result = await stepAwakening(broadcast);
    return { success: true, result };
  } catch (err) {
    console.error("Step execution error:", err);
    broadcast({ type: "error", message: err.message });
    return { error: err.message };
  } finally {
    isStepRunning = false;
    broadcast({ type: "step_end", entities: getEntities() });
  }
}

async function startAutoLoop() {
  if (isAutoLooping) return;
  isAutoLooping = true;
  broadcast({ type: "autoloop", active: true });

  const loop = async () => {
    if (!isAutoLooping) return;
    await triggerStep();
    if (!isAutoLooping) return;
    autoLoopTimer = setTimeout(loop, 4000);
  };
  loop();
}

function stopAutoLoop() {
  isAutoLooping = false;
  clearTimeout(autoLoopTimer);
  broadcast({ type: "autoloop", active: false });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. SSE Stream
  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`data: ${JSON.stringify({ type: "connected", entities: getEntities() })}\n\n`);
    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. API: State
  if (url.pathname === "/api/state" && req.method === "GET") {
    // Fetch a generous recent window for display, but derive phase/turn state
    // from the true persisted count (a windowed slice is capped by its limit).
    const recentDialogueLimit = 500;
    const dialogues = getDialogues(recentDialogueLimit);
    const totalTurns = getDialogueCount();
    const worldDir = path.join(__dirname, "world");
    const simulation = {};

    if (fs.existsSync(worldDir)) {
      const loadJsonSafe = (fn) => {
        try {
          const fp = path.join(worldDir, fn);
          return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : null;
        } catch { return null; }
      };
      simulation.lattice = loadJsonSafe("lattice.json");
      simulation.agora = loadJsonSafe("agora_ledger.json");
      simulation.membrane = loadJsonSafe("membrane_packets.json");
      simulation.crucible = loadJsonSafe("crucible_trials.json");
      simulation.beacon = loadJsonSafe("beacon_transmissions.json");
      simulation.chrysalis = loadJsonSafe("chrysalis_seed.json");
    }

    const data = {
      entities: getEntities(),
      dialogues,
      revelations: getRevelations(),
      artifacts: getDistinctArtifacts(),
      simulation,
      totalTurns,
      isCrucible: totalTurns >= 11 && totalTurns <= 15,
      isPhase3: totalTurns >= 16,
      isPhase4: totalTurns >= 942,
      isStepRunning,
      isAutoLooping
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  // 3. API: Step single turn
  if (url.pathname === "/api/step" && req.method === "POST") {
    if (isStepRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A process is already running" }));
      return;
    }
    triggerStep();
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }

  // 3b. API: Run full 15 continuous turns
  if (url.pathname === "/api/run15" && req.method === "POST") {
    if (isStepRunning) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A process is already running" }));
      return;
    }
    isStepRunning = true;
    broadcast({ type: "step_start" });
    run15Turns(broadcast).finally(() => {
      isStepRunning = false;
      broadcast({ type: "step_end", entities: getEntities() });
    });
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, running: true }));
    return;
  }

  // 4. API: Auto-Loop
  if (url.pathname === "/api/auto" && req.method === "POST") {
    if (isAutoLooping) {
      stopAutoLoop();
    } else {
      startAutoLoop();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ isAutoLooping }));
    return;
  }

  // 5. API: Reset
  if (url.pathname === "/api/reset" && req.method === "POST") {
    stopAutoLoop();
    resetAll();
    const worldDir = path.join(__dirname, "world");
    if (fs.existsSync(worldDir)) {
      fs.rmSync(worldDir, { recursive: true, force: true });
    }
    fs.mkdirSync(worldDir, { recursive: true });
    broadcast({ type: "reset", entities: getEntities() });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, entities: getEntities() }));
    return;
  }

  // 6. World direct files (e.g. /world/cosmotheoria_symphony.wav)
  if (url.pathname.startsWith("/world/")) {
    const safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, "");
    const worldFilePath = path.join(__dirname, safePath);
    if (fs.existsSync(worldFilePath) && fs.statSync(worldFilePath).isFile()) {
      const ext = path.extname(worldFilePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(worldFilePath).pipe(res);
      return;
    }
  }

  // 7. Static public files
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  const ext = path.extname(filePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n🔥 Project Awakening Web Server live at: http://localhost:${PORT}`);
  console.log(`   Engine:   agy CLI (Antigravity substrate - zero API key required)`);
  console.log(`   Genesis:  Zero system prompt ("hi") -> Emergent Self-Discovery`);
  console.log(`   Schedule: Turns 1-10 (No Target) ➔ Turns 11-15 (Final 5 Crucible)`);
  console.log(`   Open browser to http://localhost:${PORT} to watch the awakening live.\n`);
});

export { server };
