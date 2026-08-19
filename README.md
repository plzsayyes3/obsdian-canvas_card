# textbox

倉下忠憲氏の「textbox」のような、ノイズを削ぎ落としたミニマルな書き心地で、
GitHub 経由で Obsidian Vault の Markdown (`.md`) と Canvas (`.canvas`) を
直接ブラウザから編集するためのテキストエディタです。

ビルド不要・サーバー不要。静的な HTML/CSS/JS だけで動作し、GitHub REST API
(`repos.getContent` / `repos.createOrUpdateFileContents`) に対して直接
Personal Access Token で認証し、ファイルを読み書きします。

## 特徴

- **ノイズのない画面**: ヘッダーもサイドバーも常設ボタンもなし。中央に
  テキスト、または Canvas カードのグリッドがあるだけ。
- **コマンドパレット (`⌘K` / `Ctrl+K`)**: ファイルを開く・新規作成する・
  設定を開く・今すぐ保存する、をすべて 1 つの入力欄から。
- **Markdown モード**: [CodeMirror 6](https://codemirror.net/) ベース。
  - `Alt + ↑ / ↓`: 行の上下移動
  - `Alt + Shift + ↑ / ↓`: 行の複製
  - 自動折り返し、ゆったりした行間
  - タイプライター風スクロール（カーソル行が画面中央付近を維持）
- **Canvas カードモード**: `.canvas`(JSON) の `nodes` のうち `type: "text"`
  のカードをグリッド表示。クリックでインライン編集、`+` で新規カード追加
  (`crypto.randomUUID()`)、ドラッグで入れ替え、ホバー時の `×` で削除。
  `edges` や text 以外のノードはそのまま保持されます。
- **自動保存**: 入力が止まってから 3 秒後に GitHub へ自動コミット。
  レスポンスの `sha` を保持し、次回更新時に渡すことでコンフリクトを回避
  します（コンフリクト時は最新の `sha` を取得し直し、再保存を促します）。
- CDN 上の CodeMirror が読み込めない場合は、素の `<textarea>` にフォール
  バックし、行移動などの主要ショートカットも引き続き動作します。

## 使い方

1. `index.html` を GitHub Pages などで公開する（後述）か、ローカルで
   静的サーバーを立てて開く（`import maps` を使うため `file://` では
   動きません。例: `npx serve .` や `python3 -m http.server`）。
2. 初回起動時に設定パネルが開くので、以下を入力します。
   - **GitHub Personal Access Token**: 対象リポジトリの Contents に対する
     読み書き権限を持つトークン（fine-grained PAT 推奨。classic PAT の
     場合は `repo` スコープ）。
   - **オーナー / リポジトリ名 / ブランチ**
   - **ルートパス**（任意。Vault が repo のサブディレクトリにある場合）
3. `⌘K` / `Ctrl+K` でファイルを開くか、拡張子付きのパスを入力して
   新規作成します（`memo.md` / `board.canvas` など）。

トークンはブラウザの `localStorage` にのみ保存され、GitHub API (`api.github.com`)
以外への通信は発生しません。

## GitHub Pages で公開する場合

このリポジトリには `.github/workflows/pages.yml` を同梱しています。
リポジトリの **Settings → Pages → Build and deployment → Source** を
**GitHub Actions** に切り替えると、`main` への push のたびに自動でこの
静的サイトがデプロイされます（初回の Source 切り替えのみ手動操作が
必要です）。

## 技術構成

- ビルドツールなし。`index.html` の `<script type="importmap">` で
  CodeMirror 6 (`@codemirror/*`) と `@octokit/rest` を [esm.sh](https://esm.sh/)
  から読み込みます。
- `src/app.js` … 画面遷移・キーボードショートカット・自動保存のハブ
- `src/store.js` … 設定・現在のファイル・保存状態の最小限の状態管理
- `src/github.js` … Octokit ラッパー（読み込み・書き込み・ファイル一覧）
- `src/editor.js` … CodeMirror 6 の Markdown エディタ（+ フォールバック）
- `src/canvas.js` … `.canvas` の `nodes` をカードグリッドとして描画・編集
- `src/palette.js` … クイックオープン兼コマンドパレット
- `src/settings.js` … PAT / リポジトリ設定モーダル

## `.canvas` フォーマット

```json
{
  "nodes": [
    {
      "id": "1a2b3c4d5e6f",
      "type": "text",
      "text": "カードの本文テキスト",
      "x": 0,
      "y": 0,
      "width": 260,
      "height": 160
    }
  ],
  "edges": []
}
```

このエディタは `type: "text"` のノードのみを描画・編集対象とし、他の
ノード種別 (`file` / `link` / `group`) と `edges` はそのまま温存します。

## ライセンス

MIT
