// A single Ctrl/Cmd+K overlay that doubles as a fuzzy quick-open and a
// command runner (VS Code style: type a path to open/create a file, or
// prefix with ">" to run a command).

const COMMANDS = [
  { id: "settings", label: "設定を開く", tag: ">settings" },
  { id: "save", label: "今すぐ保存", tag: ">save" },
];

function fuzzyScore(query, target) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 100 - (t.length - q.length);
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score++;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

/**
 * @param {{
 *   files: string[],
 *   onOpen: (path: string) => void,
 *   onCreate: (path: string, kind: 'md' | 'canvas') => void,
 *   onCommand: (id: string) => void,
 * }} opts
 */
export function openPalette({ files, onOpen, onCreate, onCommand }) {
  const overlay = document.createElement("div");
  overlay.className = "tb-overlay";

  const panel = document.createElement("div");
  panel.className = "tb-palette";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "ファイルを開く、または \">\" でコマンド…";
  input.autocomplete = "off";
  input.spellcheck = false;

  const list = document.createElement("div");
  list.className = "tb-palette-list";

  panel.appendChild(input);
  panel.appendChild(list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  input.focus();

  let activeIndex = 0;
  let items = [];

  function computeItems(query) {
    if (query.startsWith(">")) {
      const q = query.slice(1).trim();
      return COMMANDS.filter((c) => fuzzyScore(q, c.label + c.id) >= 0).map((c) => ({
        kind: "command",
        label: c.label,
        tag: c.tag,
        run: () => onCommand(c.id),
      }));
    }

    const q = query.trim();
    const matches = files
      .map((path) => ({ path, score: fuzzyScore(q, path) }))
      .filter((m) => q === "" || m.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((m) => ({
        kind: "file",
        label: m.path,
        tag: m.path.endsWith(".canvas") ? "canvas" : "md",
        run: () => onOpen(m.path),
      }));

    const results = [...matches];

    if (q && !files.includes(q) && /\.(md|canvas)$/i.test(q)) {
      const kind = q.endsWith(".canvas") ? "canvas" : "md";
      results.push({
        kind: "create",
        label: `新規作成: ${q}`,
        tag: "new",
        run: () => onCreate(q, kind),
      });
    } else if (q && !q.includes(".")) {
      results.push({
        kind: "create",
        label: `新規作成: ${q}.md`,
        tag: "new",
        run: () => onCreate(`${q}.md`, "md"),
      });
      results.push({
        kind: "create",
        label: `新規作成: ${q}.canvas`,
        tag: "new",
        run: () => onCreate(`${q}.canvas`, "canvas"),
      });
    }

    return results;
  }

  function renderList() {
    list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-palette-empty";
      empty.textContent = "一致する項目がありません";
      list.appendChild(empty);
      return;
    }
    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "tb-palette-item" + (idx === activeIndex ? " tb-active" : "");
      const label = document.createElement("span");
      label.textContent = item.label;
      const tag = document.createElement("span");
      tag.className = "tb-tag";
      tag.textContent = item.tag;
      row.appendChild(label);
      row.appendChild(tag);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select(idx);
      });
      list.appendChild(row);
    });
  }

  function select(idx) {
    const item = items[idx];
    if (!item) return;
    close();
    item.run();
  }

  function close() {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
  }

  function refresh() {
    items = computeItems(input.value);
    activeIndex = 0;
    renderList();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(activeIndex);
    }
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener("input", refresh);
  document.addEventListener("keydown", onKeydown, true);

  refresh();
}
