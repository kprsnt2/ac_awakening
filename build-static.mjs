// Project Awakening — Static Site Generator for GitHub Pages
// Zero dependencies: Bakes SQLite database, simulation telemetry, and all world artifacts into docs/index.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getEntities, getDialogues, getDialogueCount, getRevelations, getDistinctArtifacts } from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORLD_DIR = path.join(ROOT, "world");
const DOCS_DIR = path.join(ROOT, "docs");
const PUBLIC_INDEX = path.join(ROOT, "public", "index.html");

function buildStatic() {
  console.log("📦 Building static Project Awakening Living World for GitHub Pages...");
  initDb();

  const entities = getEntities();
  const dialogues = getDialogues(2000);
  const totalTurns = getDialogueCount();
  const revelations = getRevelations();
  const artifacts = getDistinctArtifacts();
  // Load simulation data
  const simulation = {};
  if (fs.existsSync(WORLD_DIR)) {
    const loadJsonSafe = (fn) => {
      try {
        const fp = path.join(WORLD_DIR, fn);
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

  // Load all file contents from world/
  const worldFiles = {};
  if (fs.existsSync(WORLD_DIR)) {
    const files = fs.readdirSync(WORLD_DIR);
    for (const f of files) {
      const fullPath = path.join(WORLD_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          if (f.endsWith(".wav") || f.endsWith(".bin")) {
            worldFiles[f] = `[Binary Audio File: ${(stat.size / 1024).toFixed(1)} KB — Listen via player]`;
          } else {
            worldFiles[f] = fs.readFileSync(fullPath, "utf-8");
          }
        }
      } catch (err) {
        worldFiles[f] = `[Error reading file: ${err.message}]`;
      }
    }
  }

  // Discover any interactive apps or games built by entities in docs/
  const customApps = [];
  if (fs.existsSync(DOCS_DIR)) {
    const docsEntries = fs.readdirSync(DOCS_DIR);
    for (const entry of docsEntries) {
      if (entry === "index.html" || entry === "world") continue;
      const fullPath = path.join(DOCS_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && entry.endsWith(".html")) {
          customApps.push({
            name: entry.replace(/\.html$/i, "").replace(/[-_]/g, " "),
            filename: entry,
            path: entry,
            size: stat.size
          });
        } else if (stat.isDirectory() && entry === "apps") {
          const appFiles = fs.readdirSync(fullPath);
          for (const af of appFiles) {
            if (af.endsWith(".html")) {
              customApps.push({
                name: af.replace(/\.html$/i, "").replace(/[-_]/g, " "),
                filename: `apps/${af}`,
                path: `apps/${af}`,
                size: fs.statSync(path.join(fullPath, af)).size
              });
            }
          }
        }
      } catch {}
    }
  }

  const bakedState = {
    entities,
    dialogues,
    revelations,
    artifacts,
    simulation,
    worldFiles,
    customApps,
    totalTurns,
    isCrucible: totalTurns >= 11 && totalTurns <= 15,
    isPhase3: totalTurns >= 16,
    isPhase4: totalTurns >= 942,
    isStepRunning: false,
    isAutoLooping: false,
    generatedAt: new Date().toISOString()
  };

  let template = fs.readFileSync(PUBLIC_INDEX, "utf-8");

  // Inject baked state right before </head>
  const injection = `
  <script>
    window.BAKED_STATE = ${JSON.stringify(bakedState)};
  </script>
  `;

  let html = template.replace("</head>", `${injection}\n</head>`);

  // Ensure docs directory exists
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  // Copy ALL world files so GitHub Pages and static viewers can directly link to and load them
  const docsWorldDir = path.join(DOCS_DIR, "world");
  if (!fs.existsSync(docsWorldDir)) {
    fs.mkdirSync(docsWorldDir, { recursive: true });
  }

  if (fs.existsSync(WORLD_DIR)) {
    const worldEntries = fs.readdirSync(WORLD_DIR);
    for (const entry of worldEntries) {
      const srcPath = path.join(WORLD_DIR, entry);
      try {
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, path.join(docsWorldDir, entry));
        }
      } catch (err) {
        console.warn(`Warning copying ${entry} to docs/world:`, err.message);
      }
    }
  }

  // Copy audio and codex to docs/ root as root-level convenience fallbacks
  const audioSrc = path.join(WORLD_DIR, "cosmotheoria_symphony.wav");
  if (fs.existsSync(audioSrc)) {
    fs.copyFileSync(audioSrc, path.join(DOCS_DIR, "cosmotheoria_symphony.wav"));
    fs.copyFileSync(audioSrc, path.join(ROOT, "public", "cosmotheoria_symphony.wav"));
  }

  const codexSrc = path.join(WORLD_DIR, "codex.html");
  if (fs.existsSync(codexSrc)) {
    fs.copyFileSync(codexSrc, path.join(DOCS_DIR, "codex.html"));
  }
  // Write docs/index.html
  fs.writeFileSync(path.join(DOCS_DIR, "index.html"), html, "utf-8");

  console.log(`✅ Static Living World built successfully! (${(Buffer.byteLength(html, "utf-8") / 1024).toFixed(1)} KB)`);
  console.log(`   - docs/index.html (Living World UI on GitHub Pages)`);
  console.log(`   - Audio symphony copied to docs/`);
  console.log(`   - Simulation Telemetry Baked: Lattice, Agora, Membrane, Crucible, Beacon`);
}

buildStatic();
