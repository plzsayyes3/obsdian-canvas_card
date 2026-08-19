// Settings modal: GitHub PAT + owner/repo/branch, persisted to localStorage
// by the caller (store.js). The token never leaves the browser except in
// Authorization headers sent directly to api.github.com.

/**
 * @param {{ current: object, onSave: (settings: object) => void }} opts
 */
export function openSettings({ current, onSave }) {
  const overlay = document.createElement("div");
  overlay.className = "tb-overlay";

  const panel = document.createElement("div");
  panel.className = "tb-settings";

  panel.innerHTML = `
    <h2>設定</h2>
    <div class="tb-field">
      <label for="tb-s-token">GitHub Personal Access Token</label>
      <input id="tb-s-token" type="password" autocomplete="off" placeholder="ghp_..." />
    </div>
    <div class="tb-field">
      <label for="tb-s-owner">オーナー (ユーザー名 / 組織名)</label>
      <input id="tb-s-owner" type="text" autocomplete="off" placeholder="your-username" />
    </div>
    <div class="tb-field">
      <label for="tb-s-repo">リポジトリ名</label>
      <input id="tb-s-repo" type="text" autocomplete="off" placeholder="my-vault" />
    </div>
    <div class="tb-field">
      <label for="tb-s-branch">ブランチ</label>
      <input id="tb-s-branch" type="text" autocomplete="off" placeholder="main" />
    </div>
    <div class="tb-field">
      <label for="tb-s-include">表示するフォルダ (任意, カンマ区切り, 例: Notes/, Canvas/)</label>
      <input id="tb-s-include" type="text" autocomplete="off" placeholder="空欄なら全フォルダを表示" />
    </div>
    <div class="tb-field">
      <label for="tb-s-exclude">除外するフォルダ (任意, カンマ区切り, 例: .obsidian/, templates/)</label>
      <input id="tb-s-exclude" type="text" autocomplete="off" placeholder="" />
    </div>
    <p class="tb-settings-note">
      トークンはこのブラウザの localStorage にのみ保存され、GitHub API 以外へは送信されません。
      Fine-grained PAT の場合は対象リポジトリへの Contents 読み書き権限が必要です。
    </p>
    <div class="tb-settings-actions">
      <button type="button" class="tb-btn" data-action="cancel">閉じる</button>
      <button type="button" class="tb-btn tb-primary" data-action="save">保存</button>
    </div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const $ = (sel) => panel.querySelector(sel);
  $("#tb-s-token").value = current.token || "";
  $("#tb-s-owner").value = current.owner || "";
  $("#tb-s-repo").value = current.repo || "";
  $("#tb-s-branch").value = current.branch || "main";
  $("#tb-s-include").value = current.includePaths || "";
  $("#tb-s-exclude").value = current.excludePaths || "";

  $("#tb-s-owner").focus();

  function close() {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
  }

  function save() {
    onSave({
      token: $("#tb-s-token").value.trim(),
      owner: $("#tb-s-owner").value.trim(),
      repo: $("#tb-s-repo").value.trim(),
      branch: $("#tb-s-branch").value.trim() || "main",
      includePaths: $("#tb-s-include").value.trim(),
      excludePaths: $("#tb-s-exclude").value.trim(),
    });
    close();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  panel.querySelector('[data-action="cancel"]').addEventListener("click", close);
  panel.querySelector('[data-action="save"]').addEventListener("click", save);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown, true);
}
