// Renders an Obsidian .canvas JSON document as a two-pane board: a large
// text-input pane (write a new card, or edit whichever card is selected)
// plus a coverflow-style card gallery (iPod-style: the selected card sits
// flat and centered, the rest fan out to either side in 3D). Layout stacks
// input-over-gallery on narrow screens and splits into two columns on wide
// ones (see the .tb-canvas-* rules in style.css). Only `type: "text"` nodes
// are rendered/editable; every other node (file, link, group) and the
// `edges` array are preserved untouched.

const CARD_W = 260;
const CARD_H = 160;
const GAP = 40;
const COMMIT_DEBOUNCE_MS = 300;

// Coverflow stage: how far apart cards sit, and how many steps out from the
// centered card still get drawn (further ones fade to invisible).
const CF_SPACING = 130;
const CF_MAX_OFFSET = 6;

function isTextNode(node) {
  return node && node.type === "text";
}

/** Lay text nodes out left-to-right in a single row, in their current array
 *  order, so the same left-to-right order is visible if this .canvas file is
 *  opened directly in Obsidian. New cards are unshifted to the front of the
 *  array (see commitTextarea), so index 0 — leftmost — is the newest card. */
function relayout(nodes) {
  let i = 0;
  for (const node of nodes) {
    if (!isTextNode(node)) continue;
    node.x = i * (CARD_W + GAP);
    node.y = 0;
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

  // A plain mouse only sends vertical wheel deltas — translate those into
  // stepping through the coverflow, not just a trackpad's horizontal swipe.
  let wheelAccum = 0;
  const WHEEL_STEP = 60;
  grid.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0 || e.deltaX !== 0) return;
      e.preventDefault();
      wheelAccum += e.deltaY;
      while (Math.abs(wheelAccum) >= WHEEL_STEP) {
        const dir = wheelAccum > 0 ? 1 : -1;
        stepActive(dir);
        wheelAccum -= dir * WHEEL_STEP;
      }
    },
    { passive: false },
  );

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
      data.nodes.unshift(node); // newest first
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

  /** Index, among the rendered text-node cards, that should sit centered
   *  (flat, in front) in the coverflow. Defaults to the newest card (index
   *  0) while composing a new one, so the stage never sits un-centered. */
  function centerIndexOf() {
    if (activeId === null) return 0;
    const idx = data.nodes.filter(isTextNode).findIndex((n) => n.id === activeId);
    return idx === -1 ? 0 : idx;
  }

  function stepActive(dir) {
    const textNodes = data.nodes.filter(isTextNode);
    if (textNodes.length === 0) return;
    const next = Math.max(0, Math.min(textNodes.length - 1, centerIndexOf() + dir));
    setActive(textNodes[next].id);
  }

  /** Toggle the selection ring and re-run the coverflow transform for every
   *  card, positioned relative to centerIndexOf(). */
  function highlightActive() {
    const center = centerIndexOf();
    grid.querySelectorAll(".tb-card").forEach((el, i) => {
      el.classList.toggle("tb-selected", el.dataset.id === activeId);

      const offset = i - center;
      const abs = Math.abs(offset);
      const visible = abs <= CF_MAX_OFFSET;
      const sign = Math.sign(offset);
      const translateX = offset * CF_SPACING;
      const rotateY = offset === 0 ? 0 : sign * 50;
      const translateZ = offset === 0 ? 30 : -Math.min(abs, 4) * 36;
      const scale = offset === 0 ? 1 : Math.max(0.7, 1 - abs * 0.09);
      const opacity = visible ? Math.max(0.3, 1 - abs * 0.16) : 0;
      el.style.transform =
        `translate(-50%, -50%) translateX(${translateX}px) translateZ(${translateZ}px) ` +
        `rotateY(${rotateY}deg) scale(${scale})`;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(1000 - abs);
      el.style.pointerEvents = visible ? "" : "none";
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
