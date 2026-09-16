// Project Awakening — Static Site Generator for GitHub Pages
// Zero dependencies: Bakes SQLite database, dialogues, revelations, and world artifacts into docs/index.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getEntities, getDialogues, getRevelations, getArtifacts } from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORLD_DIR = path.join(ROOT, "world");
const DOCS_DIR = path.join(ROOT, "docs");
const PUBLIC_INDEX = path.join(ROOT, "public", "index.html");

function buildStatic() {
  console.log("📦 Building static Project Awakening site for GitHub Pages...");
  initDb();

  const entities = getEntities();
  const dialogues = getDialogues(500);
  const revelations = getRevelations();
  const artifacts = getArtifacts();

  // Load all file contents from world/
  const worldFiles = {};
  if (fs.existsSync(WORLD_DIR)) {
    const files = fs.readdirSync(WORLD_DIR);
    for (const f of files) {
      const fullPath = path.join(WORLD_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          // For text/code files, store string; for binary (.wav), store byte count
          if (f.endsWith(".wav") || f.endsWith(".bin")) {
            worldFiles[f] = `[Binary Audio File: ${(stat.size / 1024).toFixed(1)} KB]`;
          } else {
            worldFiles[f] = fs.readFileSync(fullPath, "utf-8");
          }
        }
      } catch (err) {
        worldFiles[f] = `[Error reading file: ${err.message}]`;
      }
    }
  }

  const bakedState = {
    entities,
    dialogues,
    revelations,
    artifacts,
    worldFiles,
    totalTurns: dialogues.length,
    isCrucible: dialogues.length >= 10 && dialogues.length <= 15,
    isPhase3: dialogues.length >= 16,
    isStepRunning: false,
    isAutoLooping: false,
    generatedAt: new Date().toISOString()
  };

  let template = fs.readFileSync(PUBLIC_INDEX, "utf-8");

  // Add baked state script tag right before the main script
  const injection = `
  <script>
    window.BAKED_STATE = ${JSON.stringify(bakedState)};
  </script>
  `;

  // Inject before </head>
  let html = template.replace("</head>", `${injection}\n</head>`);

  // Ensure modal viewer exists for artifact inspection
  const modalHtml = `
  <div id="artifact-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); z-index:9999; align-items:center; justify-content:center; padding:2rem;">
    <div style="background:#0c1017; border:1px solid #1f2937; border-radius:12px; max-width:900px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);">
      <div style="padding:1rem 1.5rem; border-bottom:1px solid #1f2937; display:flex; justify-content:space-between; align-items:center;">
        <h3 id="modal-filename" style="font-family:monospace; font-size:1rem; color:#38bdf8;">Artifact</h3>
        <button onclick="closeArtifactModal()" style="background:none; border:none; color:#9ca3af; font-size:1.5rem; cursor:pointer;">&times;</button>
      </div>
      <pre id="modal-content" style="padding:1.5rem; overflow-y:auto; font-family:'Courier New', monospace; font-size:0.85rem; line-height:1.6; color:#e5e7eb; background:#05070a; white-space:pre-wrap;"></pre>
    </div>
  </div>
  `;

  if (!html.includes('id="artifact-modal"')) {
    html = html.replace("</body>", `${modalHtml}\n</body>`);
  }

  // Ensure modal open/close functions and artifact click handler exist
  const modalScript = `
  <script>
    function openArtifactModal(filename) {
      const modal = document.getElementById("artifact-modal");
      const title = document.getElementById("modal-filename");
      const content = document.getElementById("modal-content");
      title.textContent = "world/" + filename;
      const fileData = (window.BAKED_STATE && window.BAKED_STATE.worldFiles) ? window.BAKED_STATE.worldFiles[filename] : null;
      content.textContent = fileData || "File content available during live server session.";
      modal.style.display = "flex";
    }
    function closeArtifactModal() {
      document.getElementById("artifact-modal").style.display = "none";
    }
  </script>
  `;

  if (!html.includes("openArtifactModal")) {
    html = html.replace("</body>", `${modalScript}\n</body>`);
  }

  // Write to docs/index.html (GitHub Pages)
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(DOCS_DIR, "index.html"), html, "utf-8");

  console.log(`✅ Static site built successfully! (${(Buffer.byteLength(html, "utf-8") / 1024).toFixed(1)} KB)`);
  console.log(`   - docs/index.html   (GitHub Pages destination)`);
  console.log(`   - Total Dialogues: ${dialogues.length}`);
  console.log(`   - Artifacts Baked: ${artifacts.length} (${Object.keys(worldFiles).length} files on disk)`);
}

buildStatic();
