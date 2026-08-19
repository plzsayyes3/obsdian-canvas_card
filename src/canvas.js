// Renders an Obsidian .canvas JSON document as a two-pane board: a large
// text-input pane (write a new card, or edit whichever card is selected)
// plus a coverflow-style card gallery (iPod-style: the selected card sits
// flat and centered, the rest fan out to either side in 3D). Layout stacks
// input-over-gallery on narrow screens and splits into two columns on wide
// ones (see the .tb-canvas-* rules in style.css). Only `type: "text"` nodes
// are rendered/editable; every other node (file, link, group) and the
// `edges` array are preserved untouched.

const CARD_W = 390;
const CARD_H = 160;
const GAP = 40;
const COMMIT_DEBOUNCE_MS = 300;

// Coverflow stage: how far apart cards sit, and how many steps out from the
// centered card still get drawn (further ones fade to invisible).
const CF_SPACING = 195;
const CF_MAX_OFFSET = 6;

// Card text shrinks to fit rather than getting clipped.
const TEXT_BASE_SIZE = 14.5;
const TEXT_MIN_SIZE = 9;

function isTextNode(node) {
  return node && node.type === "text";
}

/** Shrink textEl's font size (down to TEXT_MIN_SIZE) until its content fits
 *  within card's available height, instead of letting it get cut off. */
function fitCardText(card, textEl) {
  const cardStyle = getComputedStyle(card);
  const available = card.clientHeight - parseFloat(cardStyle.paddingTop) - parseFloat(cardStyle.paddingBottom);
  let size = TEXT_BASE_SIZE;
  textEl.style.fontSize = `${size}px`;
  while (textEl.scrollHeight > available && size > TEXT_MIN_SIZE) {
    size -= 0.5;
    textEl.style.fontSize = `${size}px`;
  }
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
  const editorButtons = document.createElement("div");
  editorButtons.className = "tb-canvas-editor-buttons";
  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.className = "tb-canvas-editor-continue";
  continueBtn.textContent = "↳ 続きを書く";
  continueBtn.title = "選択中のカード（未選択なら最新のカード）から続けて、新→古の矢印でつながる新規カードを書く";
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "tb-canvas-editor-new";
  newBtn.textContent = "＋ 新規（独立）";
  newBtn.title = "どこにもつながらない新しいカードを書く";
  editorButtons.appendChild(continueBtn);
  editorButtons.appendChild(newBtn);
  editorHeader.appendChild(editorLabel);
  editorHeader.appendChild(editorButtons);

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
        stepBrowse(dir);
        wheelAccum -= dir * WHEEL_STEP;
      }
    },
    { passive: false },
  );

  // Touch swipe: no wheel on touch devices, so a horizontal drag on the
  // stage steps browsing the same way the wheel does — one step per swipe,
  // and it never touches the editor either. A vertical drag is left alone
  // so the page can still scroll normally.
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let touchIsHorizontal = null; // decided once movement is big enough to tell
  const SWIPE_THRESHOLD = 40;

  grid.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchDeltaX = 0;
      touchIsHorizontal = null;
    },
    { passive: true },
  );

  grid.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (touchIsHorizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        touchIsHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (touchIsHorizontal) {
        e.preventDefault(); // this gesture is ours — don't also scroll the page
        touchDeltaX = dx;
      }
    },
    { passive: false },
  );

  grid.addEventListener("touchend", () => {
    if (touchIsHorizontal) {
      if (touchDeltaX <= -SWIPE_THRESHOLD) stepBrowse(1); // swiped left -> older
      else if (touchDeltaX >= SWIPE_THRESHOLD) stepBrowse(-1); // swiped right -> newer
    }
    touchIsHorizontal = null;
    touchDeltaX = 0;
  });

  wrap.appendChild(editorPane);
  wrap.appendChild(gridPane);
  container.appendChild(wrap);

  let dragId = null;
  let activeId = null; // editor selection: null = composing a new card
  // Which card sits centered/in-front in the coverflow, tracked by id so it
  // stays put (and unrelated to the editor) while browsing with the wheel
  // or the mobile nav buttons. null = "follow the newest card".
  let centerId = null;
  // Card id the next new card should link from (new -> old arrow), or null
  // for an independent card. Set by the "続きを書く" button; after a
  // chained card is created this advances to that new card's id, so
  // repeated Ctrl/Cmd+Enter keeps the thread going without re-clicking.
  let pendingParentId = null;
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
      if (pendingParentId && findNode(pendingParentId)) {
        if (!Array.isArray(data.edges)) data.edges = [];
        data.edges.push({
          id: crypto.randomUUID(),
          fromNode: node.id,
          fromSide: "right",
          toNode: pendingParentId,
          toSide: "left",
        });
        pendingParentId = node.id; // keep the thread going by default
      } else {
        pendingParentId = null;
      }
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
      if (textEl) {
        textEl.textContent = value;
        fitCardText(textEl.closest(".tb-card"), textEl);
      }
    }
  }

  function setActive(id) {
    commitTextarea(); // flush whatever we're leaving behind first
    activeId = id;
    if (id === null) {
      textarea.value = "";
      editorLabel.textContent = pendingParentId ? "続き" : "新規カード";
    } else {
      pendingParentId = null; // editing an existing card cancels any pending continuation
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
    centerId = null;
    pendingParentId = null;
    textarea.value = "";
    editorLabel.textContent = "新規カード";
    highlightActive();
  }

  /** Index, among the rendered text-node cards, that should sit centered
   *  (flat, in front) in the coverflow. Follows centerId by identity, so a
   *  newly-created card (always unshifted to index 0) appears to the left
   *  of whatever is centered rather than stealing focus. Falls back to the
   *  newest card (index 0) until the user has ever clicked or browsed. */
  function centerIndexOf() {
    if (centerId === null) return 0;
    const idx = data.nodes.filter(isTextNode).findIndex((n) => n.id === centerId);
    return idx === -1 ? 0 : idx;
  }

  /** Move the coverflow's visual focus only — does NOT touch the editor.
   *  Used by the wheel and the mobile nav buttons ("just looking"). */
  function stepBrowse(dir) {
    const textNodes = data.nodes.filter(isTextNode);
    if (textNodes.length === 0) return;
    const next = Math.max(0, Math.min(textNodes.length - 1, centerIndexOf() + dir));
    centerId = textNodes[next].id;
    highlightActive();
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

  newBtn.addEventListener("click", () => {
    pendingParentId = null;
    setActive(null);
  });

  continueBtn.addEventListener("click", () => {
    const textNodes = data.nodes.filter(isTextNode);
    if (textNodes.length === 0) return;
    const parentId = activeId !== null ? activeId : textNodes[0].id;
    setActive(null);
    pendingParentId = parentId;
    editorLabel.textContent = "続き";
  });

  function render() {
    grid.innerHTML = "";
    const textNodes = data.nodes.filter(isTextNode);

    continueBtn.disabled = textNodes.length === 0;

    if (textNodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tb-canvas-empty";
      empty.textContent = "カードがありません。左のエリアに書いて追加してください。";
      grid.appendChild(empty);
    }

    for (const node of textNodes) {
      grid.appendChild(renderCard(node));
    }
    grid.querySelectorAll(".tb-card").forEach((card) => {
      fitCardText(card, card.querySelector(".tb-card-text"));
    });
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
      if (Array.isArray(data.edges)) {
        data.edges = data.edges.filter((edge) => edge.fromNode !== node.id && edge.toNode !== node.id);
      }
      if (centerId === node.id) centerId = null;
      relayout(data.nodes);
      emitChange();
      if (wasActive) resetEditorToNew(); // clears activeId/pendingParentId/textarea (centerId already cleared above)
      render();
    });
    card.appendChild(del);

    if (Array.isArray(data.edges) && data.edges.some((edge) => edge.fromNode === node.id)) {
      const badge = document.createElement("span");
      badge.className = "tb-card-link-badge";
      badge.textContent = "↳";
      badge.title = "前のカードから続いています";
      card.appendChild(badge);
    }

    const text = document.createElement("div");
    text.className = "tb-card-text";
    text.textContent = node.text || "";
    card.appendChild(text);

    card.addEventListener("click", () => {
      centerId = node.id;
      setActive(node.id);
    });

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
