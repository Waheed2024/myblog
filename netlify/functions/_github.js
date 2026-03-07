// helpers for GitHub-based persistence used by Netlify functions

const BASE_URL = 'https://api.github.com/repos';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "owner/repo"
const path = require('path');
const fs = require('fs');

function hasGitHubConfig() {
  return GITHUB_TOKEN && GITHUB_REPO;
}

async function gitHubRequest(url, options = {}) {
  if (!hasGitHubConfig()) {
    throw new Error('GitHub configuration (GITHUB_TOKEN and GITHUB_REPO) not set');
  }
  const headers = Object.assign({
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'netlify-function'
  }, options.headers || {});
  const res = await fetch(url, Object.assign({ headers }, options));
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub API request failed: ${res.status} ${res.statusText} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

async function fetchPostsFile() {
  if (!hasGitHubConfig()) {
    // fallback to local tmp file (ephemeral)
    const tmp = '/tmp/posts.json';
    try {
      const raw = fs.readFileSync(tmp, 'utf8');
      return { posts: JSON.parse(raw), sha: null };
    } catch {
      fs.writeFileSync(tmp, JSON.stringify([], null, 2));
      return { posts: [], sha: null };
    }
  }
  const url = `${BASE_URL}/${GITHUB_REPO}/contents/posts.json`;
  const res = await gitHubRequest(url);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  let posts;
  try { posts = JSON.parse(content); } catch(e){ posts = []; }
  return { posts, sha: data.sha };
}

async function updatePostsFile(posts, sha) {
  const body = {
    message: 'Update posts.json',
    content: Buffer.from(JSON.stringify(posts, null, 2)).toString('base64')
  };
  if (sha) body.sha = sha;

  if (!hasGitHubConfig()) {
    // write to tmp file
    fs.writeFileSync('/tmp/posts.json', JSON.stringify(posts, null, 2));
    return;
  }
  const url = `${BASE_URL}/${GITHUB_REPO}/contents/posts.json`;
  await gitHubRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

module.exports = {
  fetchPostsFile,
  updatePostsFile,
  hasGitHubConfig
};
