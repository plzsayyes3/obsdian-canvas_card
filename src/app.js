import { state, subscribe, saveSettings, setStatus, setFile, hasValidSettings, getLastFilePath } from "./store.js";
import { fetchFile, saveFile, listFiles, NotFoundError } from "./github.js";
import { createMarkdownEditor } from "./editor.js";
import { createCanvasBoard } from "./canvas.js";
import { openPalette } from "./palette.js";
import { openSettings } from "./settings.js";

const AUTOSAVE_DELAY_MS = 3000;
const PATH_LABEL_FADE_MS = 2200;

const app = document.getElementById("app");

let activeEditor = null; // { getValue, destroy } for markdown, or canvas board
let activeKind = null; // 'md' | 'canvas'
let currentContentGetter = null; // () => string, the serialized content to persist
let saveTimer = null;
let pathLabelTimer = null;
let filesCache = null; // cached file list for the palette

// ---- chrome: path label + status dot ----

const pathLabel = document.createElement("div");
pathLabel.className = "tb-path-label";
document.body.appendChild(pathLabel);

const statusDot = document.createElement("div");
statusDot.className = "tb-status-dot";
statusDot.dataset.status = "idle";
document.body.appendChild(statusDot);

// Real tappable buttons, not just a keyboard-shortcut hint — a touchscreen
// has no ⌘K, so this is the only way in on mobile.
const hint = document.createElement("div");
hint.className = "tb-hint";
const hintOpenBtn = document.createElement("button");
hintOpenBtn.type = "button";
hintOpenBtn.className = "tb-hint-btn";
hintOpenBtn.textContent = "⌘K 開く/新規";
hintOpenBtn.addEventListener("click", () => showPalette());
const hintSettingsBtn = document.createElement("button");
hintSettingsBtn.type = "button";
hintSettingsBtn.className = "tb-hint-btn";
hintSettingsBtn.textContent = "⌘, 設定";
hintSettingsBtn.addEventListener("click", () => showSettings());
hint.appendChild(hintOpenBtn);
hint.appendChild(hintSettingsBtn);
document.body.appendChild(hint);

subscribe((s) => {
  statusDot.dataset.status = s.status;
  statusDot.title = { idle: "", dirty: "未保存の変更", saving: "保存中…", saved: "保存済み", error: "保存に失敗しました" }[
    s.status
  ];
});

function flashPathLabel(text) {
  pathLabel.textContent = text;
  pathLabel.classList.add("tb-visible");
  clearTimeout(pathLabelTimer);
  pathLabelTimer = setTimeout(() => pathLabel.classList.remove("tb-visible"), PATH_LABEL_FADE_MS);
}

// ---- path filters (include/exclude folder lists from settings) ----

// "Notes/, Canvas/" -> ["Notes/", "Canvas/"]
function parsePathList(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim().replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean)
    .map((s) => `${s}/`);
}

function isPathVisible(path) {
  const includes = parsePathList(state.settings.includePaths);
  const excludes = parsePathList(state.settings.excludePaths);
  if (excludes.some((prefix) => path.startsWith(prefix))) return false;
  if (includes.length === 0) return true;
  return includes.some((prefix) => path.startsWith(prefix));
}

// ---- rendering ----

function clearStage() {
  if (activeEditor && activeEditor.destroy) activeEditor.destroy();
  activeEditor = null;
  activeKind = null;
  currentContentGetter = null;
  app.innerHTML = "";
}

function renderWelcome() {
  clearStage();
  const el = document.createElement("div");
  el.className = "tb-welcome";

  const mark = document.createElement("div");
  mark.className = "tb-mark";
  mark.textContent = "textbox";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "tb-welcome-open";
  openBtn.textContent = "ファイルを開く / 新規作成";
  openBtn.addEventListener("click", () => showPalette());

  const kbdHint = document.createElement("div");
  kbdHint.className = "tb-welcome-kbd-hint";
  kbdHint.textContent = "⌘K / Ctrl+K でも開けます";

  el.appendChild(mark);
  el.appendChild(openBtn);
  el.appendChild(kbdHint);
  app.appendChild(el);
  pathLabel.classList.remove("tb-visible");
}

async function renderMarkdown(text) {
  clearStage();
  activeKind = "md";
  const wrap = document.createElement("div");
  wrap.className = "tb-editor-wrap";
  app.appendChild(wrap);
  activeEditor = await createMarkdownEditor(wrap, {
    initialText: text,
    onChange: () => scheduleAutosave(),
  });
  currentContentGetter = () => activeEditor.getValue();
  activeEditor.focus();
}

function renderCanvas(json) {
  clearStage();
  activeKind = "canvas";
  let data;
  try {
    data = JSON.parse(json || '{"nodes":[],"edges":[]}');
  } catch {
    data = { nodes: [], edges: [] };
  }
  if (!Array.isArray(data.nodes)) data.nodes = [];
  if (!Array.isArray(data.edges)) data.edges = [];

  activeEditor = createCanvasBoard(app, {
    data,
    onChange: () => scheduleAutosave(),
  });
  currentContentGetter = () => JSON.stringify(activeEditor.getData(), null, 2);
}

// ---- file open / create ----

async function openFile(path) {
  const kind = path.endsWith(".canvas") ? "canvas" : "md";
  setStatus("idle");
  try {
    const { content, sha } = await fetchFile({ ...state.settings, path });
    setFile({ path, sha, kind });
    flashPathLabel(path);
    if (kind === "canvas") await renderCanvas(content);
    else await renderMarkdown(content);
  } catch (err) {
    if (err instanceof NotFoundError) {
      await createNewFile(path, kind);
    } else {
      console.error(err);
      alert(`読み込みに失敗しました: ${err.message}`);
    }
  }
}

async function createNewFile(path, kind) {
  setFile({ path, sha: null, kind });
  flashPathLabel(`${path} (新規)`);
  if (kind === "canvas") await renderCanvas('{"nodes":[],"edges":[]}');
  else await renderMarkdown("");
  filesCache = null; // list changed
  // Create it immediately so a sha exists for subsequent saves.
  scheduleAutosave(0);
}

// ---- autosave ----

function scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
  if (!state.file || !currentContentGetter) return;
  setStatus("dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, delay);
}

async function doSave() {
  if (!state.file || !currentContentGetter) return;
  const path = state.file.path;
  const content = currentContentGetter();
  setStatus("saving");
  try {
    const sha = await saveFile({ ...state.settings, path, content, sha: state.file.sha });
    setFile({ ...state.file, sha });
    setStatus("saved");
  } catch (err) {
    if (err.status === 409) {
      // Someone else (or another tab) moved the file forward. Refetch and
      // let the user retry rather than silently overwriting their change.
      try {
        const fresh = await fetchFile({ ...state.settings, path });
        setFile({ ...state.file, sha: fresh.sha });
        setStatus("error");
        console.warn("[textbox] save conflict — refreshed sha, please retry saving.");
      } catch {
        setStatus("error");
      }
    } else {
      console.error(err);
      setStatus("error");
    }
  }
}

window.addEventListener("beforeunload", (e) => {
  if (state.status === "dirty" || state.status === "saving") {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---- palette / settings wiring ----

async function getFilesForPalette() {
  if (filesCache) return filesCache;
  try {
    const all = await listFiles(state.settings);
    filesCache = all.filter(isPathVisible);
  } catch (err) {
    console.error(err);
    filesCache = [];
  }
  return filesCache;
}

async function showPalette() {
  if (!hasValidSettings()) {
    showSettings();
    return;
  }
  const files = await getFilesForPalette();
  openPalette({
    files,
    onOpen: (path) => openFile(path),
    onCreate: (path, kind) => createNewFile(path, kind),
    onCommand: (id) => {
      if (id === "settings") showSettings();
      if (id === "save") doSave();
    },
  });
}

function showSettings() {
  openSettings({
    current: state.settings,
    onSave: (settings) => {
      saveSettings(settings);
      filesCache = null;
      if (!activeEditor) renderWelcome();
    },
  });
}

// ---- global shortcuts ----

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    showPalette();
  } else if (mod && e.key === ",") {
    e.preventDefault();
    showSettings();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    clearTimeout(saveTimer);
    doSave();
  }
});

// ---- boot ----

(async function boot() {
  if (!hasValidSettings()) {
    renderWelcome();
    showSettings();
    return;
  }
  const last = getLastFilePath();
  if (last) {
    await openFile(last);
  } else {
    renderWelcome();
  }
})();
