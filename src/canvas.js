// Renders an Obsidian .canvas JSON document as a two-pane board: a large
// text-input pane (write a new card, or edit whichever card is selected)
// plus a card gallery. Layout stacks input-over-gallery on narrow screens
// and splits into two columns on wide ones (see the .tb-canvas-* rules in
// style.css). Only `type: "text"` nodes are rendered/editable; every other
// node (file, link, group) and the `edges` array are preserved untouched.

const CARD_W = 260;
const CARD_H = 160;
const GAP = 40;
const COLS = 4;
const COMMIT_DEBOUNCE_MS = 300;

function isTextNode(node) {
  return node && node.type === "text";
}

/** Recompute x/y for text nodes into a simple grid, in their current array order. */
function relayout(nodes) {
  let i = 0;
  for (const node of nodes) {
    if (!isTextNode(node)) continue;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    node.x = col * (CARD_W + GAP);
    node.y = row * (CARD_H + GAP);
    node.width = node.width || CARD_W;
    node.height = node.height || CARD_H;
    i++;
  }
}

/**
 * @param {HTMLElement} container
 * @param {{ data: {nodes: any[], edges: any[]}, onChange: (data: object) => void }} opts
 */
export function createCanvasBoard(container, { data, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "tb-canvas-wrap";

  // ---- left/top pane: shared text editor (compose new, or edit selected) ----

  const editorPane = document.createElement("div");
  editorPane.className = "tb-canvas-editor-pane";

  const editorHeader = document.createElement("div");
  editorHeader.className = "tb-canvas-editor-header";
  const editorLabel = document.createElement("span");
  editorLabel.className = "tb-canvas-editor-label";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "tb-canvas-editor-new";
  newBtn.textContent = "＋ 新規";
  newBtn.title = "新しいカードを書く";
  editorHeader.appendChild(editorLabel);
  editorHeader.appendChild(newBtn);

  const textarea = document.createElement("textarea");
  textarea.className = "tb-canvas-editor-textarea";
  textarea.placeholder = "ここに書くと新しいカードになります…";
  textarea.spellcheck = false;

  editorPane.appendChild(editorHeader);
  editorPane.appendChild(textarea);

  // ---- right/bottom pane: card gallery ----

  const gridPane = document.createElement("div");
  gridPane.className = "tb-canvas-grid-pane";
  const grid = document.createElement("div");
  grid.className = "tb-canvas-grid";
  gridPane.appendChild(grid);

  wrap.appendChild(editorPane);
  wrap.appendChild(gridPane);
  container.appendChild(wrap);

  let dragId = null;
  let activeId = null; // null = composing a new card
  let debounceTimer = null;

  function emitChange() {
    onChange(data);
  }

  function findNode(id) {
    return data.nodes.find((n) => n.id === id);
  }

  /** Commit whatever is currently in the textarea: create a new card if we
   *  were composing one (and it's non-empty), or update the selected card. */
  function commitTextarea() {
    clearTimeout(debounceTimer);
    const value = textarea.value;
    if (activeId === null) {
      if (!value.trim()) return;
      const node = {
        id: crypto.randomUUID(),
        type: "text",
        text: value,
        x: 0,
        y: 0,
        width: CARD_W,
        height: CARD_H,
      };
      data.nodes.push(node);
      relayout(data.nodes);
      activeId = node.id;
      editorLabel.textContent = "編集中";
      emitChange();
      render();
    } else {
      const node = findNode(activeId);
      if (!node) return;
      if (node.text === value) return;
      node.text = value;
      emitChange();
      const textEl = grid.querySelector(`.tb-card[data-id="${activeId}"] .tb-card-text`);
      if (textEl) textEl.textContent = value;
    }
  }

  function setActive(id) {
    commitTextarea(); // flush whatever we're leaving behind first
    activeId = id;
    if (id === null) {
      textarea.value = "";
      editorLabel.textContent = "新規カード";
    } else {
      const node = findNode(id);
      textarea.value = node ? node.text || "" : "";
      editorLabel.textContent = "編集中";
    }
    highlightActive();
    textarea.focus();
  }

  /** Like setActive(null), but discards the current textarea content instead
   *  of committing it — for when the thing it would commit into is already
   *  gone (e.g. the active card was just deleted). */
  function resetEditorToNew() {
    clearTimeout(debounceTimer);
    activeId = null;
    textarea.value = "";
    editorLabel.textContent = "新規カード";
    highlightActive();
  }

  function highlightActive() {
    grid.querySelectorAll(".tb-card").forEach((el) => {
      el.classList.toggle("tb-selected", el.dataset.id === activeId);
    });
  }

  textarea.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(commitTextarea, COMMIT_DEBOUNCE_MS);
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commitTextarea();
      setActive(null); // ready for the next card right away
    }
  });

  newBtn.addEventListener("click", () => setActive(null));

  function render() {
    grid.innerHTML = "";
    const textNodes = data.nodes.filter(isTextNode);

    if (textNodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-canvas-empty";
      empty.textContent = "カードがありません。左のエリアに書いて追加してください。";
      grid.appendChild(empty);
    }

    for (const node of textNodes) {
      grid.appendChild(renderCard(node));
    }
    highlightActive();
  }

  function renderCard(node) {
    const card = document.createElement("div");
    card.className = "tb-card";
    card.draggable = true;
    card.dataset.id = node.id;

    const del = document.createElement("button");
    del.className = "tb-card-delete";
    del.type = "button";
    del.textContent = "×";
    del.title = "削除";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasActive = activeId === node.id;
      data.nodes = data.nodes.filter((n) => n.id !== node.id);
      relayout(data.nodes);
      emitChange();
      render();
      if (wasActive) resetEditorToNew();
    });
    card.appendChild(del);

    const text = document.createElement("div");
    text.className = "tb-card-text";
    text.textContent = node.text || "";
    card.appendChild(text);

    card.addEventListener("click", () => setActive(node.id));

    // drag to reorder
    card.addEventListener("dragstart", () => {
      dragId = node.id;
      card.classList.add("tb-dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("tb-dragging");
      grid.querySelectorAll(".tb-drop-target").forEach((el) => el.classList.remove("tb-drop-target"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragId && dragId !== node.id) card.classList.add("tb-drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("tb-drop-target"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("tb-drop-target");
      if (!dragId || dragId === node.id) return;
      const fromIdx = data.nodes.findIndex((n) => n.id === dragId);
      const toIdx = data.nodes.findIndex((n) => n.id === node.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = data.nodes.splice(fromIdx, 1);
      data.nodes.splice(toIdx, 0, moved);
      relayout(data.nodes);
      emitChange();
      render();
    });

    return card;
  }

  render();
  resetEditorToNew();

  return {
    getData: () => data,
    setData: (next) => {
      data = next;
      render();
      resetEditorToNew();
    },
    destroy: () => wrap.remove(),
  };
}

export { relayout };
