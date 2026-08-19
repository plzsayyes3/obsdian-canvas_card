// Renders the `nodes` of an Obsidian .canvas JSON document as a card grid,
// supports inline editing, add/delete, and drag-to-reorder. Only `type:
// "text"` nodes are rendered/editable; every other node (file, link, group)
// and the `edges` array are preserved untouched in the underlying data.

const CARD_W = 260;
const CARD_H = 160;
const GAP = 40;
const COLS = 4;

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
  const grid = document.createElement("div");
  grid.className = "tb-canvas-grid";
  wrap.appendChild(grid);
  container.appendChild(wrap);

  let dragId = null;

  function emitChange() {
    onChange(data);
  }

  function render() {
    grid.innerHTML = "";
    const textNodes = data.nodes.filter(isTextNode);

    if (textNodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-canvas-empty";
      empty.textContent = "カードがありません。＋ で追加してください。";
      grid.appendChild(empty);
    }

    for (const node of textNodes) {
      grid.appendChild(renderCard(node));
    }

    const addBtn = document.createElement("button");
    addBtn.className = "tb-card-add";
    addBtn.type = "button";
    addBtn.textContent = "+";
    addBtn.title = "新規カードを追加";
    addBtn.addEventListener("click", () => {
      data.nodes.push({
        id: crypto.randomUUID(),
        type: "text",
        text: "",
        x: 0,
        y: 0,
        width: CARD_W,
        height: CARD_H,
      });
      relayout(data.nodes);
      emitChange();
      render();
      const cards = grid.querySelectorAll(".tb-card");
      const last = cards[cards.length - 1];
      if (last) last.querySelector(".tb-card-text")?.click();
    });
    grid.appendChild(addBtn);
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
      data.nodes = data.nodes.filter((n) => n.id !== node.id);
      relayout(data.nodes);
      emitChange();
      render();
    });
    card.appendChild(del);

    const text = document.createElement("div");
    text.className = "tb-card-text";
    text.textContent = node.text || "";
    text.addEventListener("click", () => startEditing(card, node, text));
    card.appendChild(text);

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

  function startEditing(card, node, textEl) {
    const textarea = document.createElement("textarea");
    textarea.className = "tb-card-textarea";
    textarea.value = node.text || "";
    card.replaceChild(textarea, textEl);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    let debounceTimer = null;
    const commit = () => {
      node.text = textarea.value;
      emitChange();
    };

    textarea.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(commit, 300);
    });

    textarea.addEventListener("blur", () => {
      clearTimeout(debounceTimer);
      commit();
      const fresh = document.createElement("div");
      fresh.className = "tb-card-text";
      fresh.textContent = node.text || "";
      fresh.addEventListener("click", () => startEditing(card, node, fresh));
      if (textarea.parentElement === card) card.replaceChild(fresh, textarea);
    });
  }

  render();

  return {
    getData: () => data,
    setData: (next) => {
      data = next;
      render();
    },
    destroy: () => wrap.remove(),
  };
}

export { relayout };
