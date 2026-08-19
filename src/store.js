// Minimal pub-sub store. No framework — just enough state to wire the UI together.

const SETTINGS_KEY = "textbox:settings";
const LAST_FILE_KEY = "textbox:lastFile";

const listeners = new Set();

export const state = {
  settings: loadSettings(),
  status: "idle", // idle | dirty | saving | saved | error
  file: null, // { path, sha, kind: 'md' | 'canvas' }
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function hasValidSettings(s = state.settings) {
  return Boolean(s && s.token && s.owner && s.repo);
}

export function saveSettings(partial) {
  state.settings = { branch: "main", root: "", ...state.settings, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  emit();
}

export function setStatus(status) {
  state.status = status;
  emit();
}

export function setFile(file) {
  state.file = file;
  if (file) {
    localStorage.setItem(LAST_FILE_KEY, file.path);
  }
  emit();
}

export function getLastFilePath() {
  return localStorage.getItem(LAST_FILE_KEY) || "";
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}
