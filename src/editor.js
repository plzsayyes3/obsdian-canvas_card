// CodeMirror 6 markdown editor: line move/duplicate, soft wrap, and a
// gentle "typewriter" scroll that keeps the caret roughly centered.
// Falls back to a plain <textarea> if the CDN modules fail to load, so a
// flaky network never leaves the app unusable.

/**
 * @param {HTMLElement} container
 * @param {{ initialText: string, onChange: (text: string) => void }} opts
 * @returns {Promise<{ getValue(): string, setValue(text: string): void, focus(): void, destroy(): void }>}
 */
export async function createMarkdownEditor(container, { initialText, onChange }) {
  try {
    return await createCodeMirrorEditor(container, { initialText, onChange });
  } catch (err) {
    console.warn("[textbox] CodeMirror unavailable, falling back to <textarea>:", err);
    return createFallbackEditor(container, { initialText, onChange });
  }
}

async function createCodeMirrorEditor(container, { initialText, onChange }) {
  const [{ EditorState }, { EditorView, keymap, drawSelection }, commands, { markdown }] =
    await Promise.all([
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/commands"),
      import("@codemirror/lang-markdown"),
    ]);

  const { defaultKeymap, history, historyKeymap, moveLineUp, moveLineDown, copyLineUp, copyLineDown } =
    commands;

  const lineMoveKeymap = keymap.of([
    { key: "Alt-ArrowUp", run: moveLineUp, preventDefault: true },
    { key: "Alt-ArrowDown", run: moveLineDown, preventDefault: true },
    { key: "Alt-Shift-ArrowUp", run: copyLineUp, preventDefault: true },
    { key: "Alt-Shift-ArrowDown", run: copyLineDown, preventDefault: true },
    ...defaultKeymap,
    ...historyKeymap,
  ]);

  const typewriterScroll = EditorView.updateListener.of((update) => {
    if (update.selectionSet || update.docChanged) {
      const pos = update.state.selection.main.head;
      update.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    }
  });

  const changeListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString());
  });

  const state = EditorState.create({
    doc: initialText,
    extensions: [
      history(),
      drawSelection(),
      lineMoveKeymap,
      EditorView.lineWrapping,
      markdown(),
      typewriterScroll,
      changeListener,
      EditorView.theme({}, { dark: false }),
    ],
  });

  const view = new EditorView({ state, parent: container });
  // Land the caret roughly centered on open, matching the typewriter feel.
  requestAnimationFrame(() => {
    view.dispatch({ effects: EditorView.scrollIntoView(0, { y: "center" }) });
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

function createFallbackEditor(container, { initialText, onChange }) {
  const textarea = document.createElement("textarea");
  textarea.className = "tb-fallback-textarea";
  textarea.value = initialText;
  textarea.spellcheck = false;
  textarea.addEventListener("input", () => onChange(textarea.value));

  // Alt+Up/Down line move, Alt+Shift+Up/Down line duplicate — same shortcuts
  // as the CodeMirror path, implemented by hand for the fallback.
  textarea.addEventListener("keydown", (e) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const { value, selectionStart } = textarea;
    const lines = value.split("\n");
    const lineStarts = [];
    let acc = 0;
    for (const line of lines) {
      lineStarts.push(acc);
      acc += line.length + 1;
    }
    const idx = lineStarts.filter((s) => s <= selectionStart).length - 1;
    if (e.shiftKey) {
      // duplicate line up/down
      lines.splice(e.key === "ArrowUp" ? idx : idx + 1, 0, lines[idx]);
    } else {
      const swapWith = e.key === "ArrowUp" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= lines.length) return;
      [lines[idx], lines[swapWith]] = [lines[swapWith], lines[idx]];
    }
    textarea.value = lines.join("\n");
    onChange(textarea.value);
  });

  container.appendChild(textarea);

  return {
    getValue: () => textarea.value,
    setValue: (text) => {
      textarea.value = text;
    },
    focus: () => textarea.focus(),
    destroy: () => textarea.remove(),
  };
}
