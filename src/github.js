// Thin wrapper around Octokit for the three operations this app needs:
// read a file, write a file (with sha-based optimistic concurrency), and
// list the .md / .canvas files in a repo for the quick-open palette.

// Octokit is imported lazily (only once a GitHub call is actually made) so
// that a CDN hiccup never prevents the rest of the app — settings, the
// palette, the welcome screen — from rendering.

let client = null;
let clientToken = null;

async function getClient(token) {
  if (!client || clientToken !== token) {
    const { Octokit } = await import("@octokit/rest");
    client = new Octokit({ auth: token || undefined });
    clientToken = token;
  }
  return client;
}

// ---- UTF-8 safe base64 helpers (atob/btoa are latin1-only) ----

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

class NotFoundError extends Error {
  constructor(path) {
    super(`not found: ${path}`);
    this.status = 404;
  }
}

/**
 * Fetch a file's decoded text content and its blob sha (needed to update it later).
 * Throws NotFoundError (status 404) if the file does not exist yet.
 */
export async function fetchFile({ token, owner, repo, branch, path }) {
  try {
    const octokit = await getClient(token);
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });
    if (Array.isArray(res.data) || res.data.type !== "file") {
      throw new Error(`${path} is not a file`);
    }
    return { content: base64ToUtf8(res.data.content), sha: res.data.sha };
  } catch (err) {
    if (err.status === 404) throw new NotFoundError(path);
    throw err;
  }
}

/**
 * Create or update a file. Pass the previously-known `sha` to update an
 * existing file; omit it to create a new one. Returns the new sha.
 */
export async function saveFile({ token, owner, repo, branch, path, content, sha, message }) {
  const octokit = await getClient(token);
  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message: message || (sha ? `update ${path}` : `create ${path}`),
    content: utf8ToBase64(content),
    sha: sha || undefined,
  });
  return res.data.content.sha;
}

/**
 * List every .md / .canvas file path in the repo (recursive tree walk),
 * used to power the quick-open command palette.
 */
export async function listFiles({ token, owner, repo, branch }) {
  const octokit = await getClient(token);
  const branchInfo = await octokit.rest.repos.getBranch({ owner, repo, branch });
  const treeSha = branchInfo.data.commit.commit.tree.sha;
  const res = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "true",
  });
  return res.data.tree
    .filter((item) => item.type === "blob" && /\.(md|canvas)$/i.test(item.path))
    .map((item) => item.path)
    .sort();
}

export { NotFoundError };
