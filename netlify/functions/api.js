const { fetchPostsFile, updatePostsFile, hasGitHubConfig } = require('./_github');

// simple admin check copied from server.js
function isAdminAuthorized(body, authHeader) {
  const PUBLISH_PASSWORD = process.env.PUBLISH_PASSWORD || 'secret';
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      if (ADMIN_TOKEN && parts[1] === ADMIN_TOKEN) return true;
      if (!ADMIN_TOKEN && parts[1] === PUBLISH_PASSWORD) return true;
    }
  }
  if (body && body.password && body.password === PUBLISH_PASSWORD) return true;
  return false;
}

// small pruner (without archive, since that's more stateful)
function pruneOldPosts(posts, days = 30) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return posts.filter(p => {
    const t = new Date(p.date).getTime();
    return isNaN(t) || t >= cutoff;
  });
}

exports.handler = async function(event, context) {
  try {
    const method = event.httpMethod;
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const segments = event.path.split('/').filter(Boolean); // ['api','posts', '123']
    const resource = segments[1] || '';
    const id = segments[2] || null;

    // shared posts storage (used by multiple resources)
    const { posts, sha } = await fetchPostsFile();
    let updatedPosts = posts.slice();

    // ---------- posts resource (/api/posts) ----------
    if (resource === 'posts') {
      // GET /api/posts
      if (method === 'GET' && !id) {
        return { statusCode: 200, body: JSON.stringify(posts) };
      }
      // POST /api/posts
      if (method === 'POST' && !id) {
        const body = JSON.parse(event.body || '{}');
        const { title, excerpt, body: bodyText, author, tags, password } = body;
        const PUBLISH_PASSWORD = process.env.PUBLISH_PASSWORD || 'secret';
        if (!password || password !== PUBLISH_PASSWORD) {
          return { statusCode: 401, body: JSON.stringify({ error: 'invalid publish password' }) };
        }
        if (!title || !bodyText) {
          return { statusCode: 400, body: JSON.stringify({ error: 'title and body required' }) };
        }
        const todayYMD = new Date().toISOString().slice(0,10);
        for (const p of posts) {
          const pYMD = (p.date && !isNaN(new Date(p.date).getTime())) ? new Date(p.date).toISOString().slice(0,10) : null;
          if (pYMD && pYMD === todayYMD) {
            return { statusCode: 409, body: JSON.stringify({ error: 'a post already exists for today; one post per day is allowed' }) };
          }
          if (p.title && p.title.trim().toLowerCase() === title.trim().toLowerCase()) {
            return { statusCode: 409, body: JSON.stringify({ error: 'a post with the same title already exists' }) };
          }
          if (p.body && p.body.trim() === bodyText.trim()) {
            return { statusCode: 409, body: JSON.stringify({ error: 'a post with identical body content already exists' }) };
          }
        }
        const post = {
          id: Date.now(),
          title,
          excerpt: excerpt || '',
          body: bodyText,
          author: author || 'Alayande',
          tags: Array.isArray(tags) ? tags : [],
          date: new Date().toISOString()
        };
        updatedPosts.unshift(post);
        updatedPosts = pruneOldPosts(updatedPosts, 30);
        await updatePostsFile(updatedPosts, sha);
        return { statusCode: 200, body: JSON.stringify(post) };
      }
      // PUT /api/posts/:id
      if (method === 'PUT' && id) {
        const body = JSON.parse(event.body || '{}');
        if (!isAdminAuthorized(body, authHeader)) {
          return { statusCode: 401, body: JSON.stringify({ error: 'invalid publish credentials' }) };
        }
        const { title, excerpt, body: bodyText, author, tags } = body;
        if (!title || !bodyText) {
          return { statusCode: 400, body: JSON.stringify({ error: 'title and body required' }) };
        }
        const idx = updatedPosts.findIndex(p => String(p.id) === String(id));
        if (idx === -1) {
          return { statusCode: 404, body: JSON.stringify({ error: 'post not found' }) };
        }
        for (const p of updatedPosts) {
          if (String(p.id) === String(id)) continue;
          if (p.title && p.title.trim().toLowerCase() === title.trim().toLowerCase()) {
            return { statusCode: 409, body: JSON.stringify({ error: 'another post with same title exists' }) };
          }
          if (p.body && p.body.trim() === bodyText.trim()) {
            return { statusCode: 409, body: JSON.stringify({ error: 'another post with identical body exists' }) };
          }
        }
        const now = new Date().toISOString();
        updatedPosts[idx].title = title;
        updatedPosts[idx].excerpt = excerpt || '';
        updatedPosts[idx].body = bodyText;
        updatedPosts[idx].author = author || updatedPosts[idx].author || 'Alayande';
        updatedPosts[idx].tags = Array.isArray(tags) ? tags : (updatedPosts[idx].tags || []);
        updatedPosts[idx].updatedAt = now;
        await updatePostsFile(updatedPosts, sha);
        return { statusCode: 200, body: JSON.stringify(updatedPosts[idx]) };
      }
      // DELETE /api/posts/:id
      if (method === 'DELETE' && id) {
        if (!isAdminAuthorized({}, authHeader)) {
          return { statusCode: 401, body: JSON.stringify({ error: 'invalid publish credentials' }) };
        }
        const idx = updatedPosts.findIndex(p => String(p.id) === String(id));
        if (idx === -1) {
          return { statusCode: 404, body: JSON.stringify({ error: 'post not found' }) };
        }
        const [removed] = updatedPosts.splice(idx,1);
        await updatePostsFile(updatedPosts, sha);
        return { statusCode: 200, body: JSON.stringify({ ok:true, removed }) };
      }
    }

    // ---------- admin resources ----------
    if (resource === 'admin') {
      // GET /api/admin/test-auth
      if (method === 'GET' && segments[2] === 'test-auth') {
        if (isAdminAuthorized({}, authHeader)) {
          return { statusCode: 200, body: JSON.stringify({ authenticated: true }) };
        } else {
          return { statusCode: 401, body: JSON.stringify({ error: 'Invalid credentials' }) };
        }
      }
      // GET /api/admin/logs
      if (method === 'GET' && segments[2] === 'logs') {
        if (!isAdminAuthorized(null, authHeader)) {
          return { statusCode: 401, body: JSON.stringify({ error: 'invalid publish credentials' }) };
        }
        // logs are not persisted in GitHub; unavailable in Netlify version
        return { statusCode: 200, body: JSON.stringify([]) };
      }
    }

    // ---------- archive ----------
    if (resource === 'archive') {
      if (!isAdminAuthorized(null, authHeader)) {
        return { statusCode: 401, body: JSON.stringify({ error: 'invalid publish credentials' }) };
      }
      if (method === 'GET' && !id) {
        return { statusCode: 200, body: JSON.stringify([]) };
      }
      if (method === 'POST' && id && segments[3] === 'restore') {
        return { statusCode: 404, body: JSON.stringify({ error: 'archive restore not supported' }) };
      }
    }

    // ---------- contact form ----------
    if (resource === 'contact' && method === 'POST') {
      // simply echo back success (no persistence on Netlify functions)
      const body = JSON.parse(event.body || '{}');
      const { name, email, subject, message } = body;
      if (!name || !email || !subject || !message) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Name, Email, Subject, and Message are required' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Message received (no storage in Netlify version)' }) };
    }

    return { statusCode: 404, body: JSON.stringify({ error: 'not found' }) };
  } catch (err) {
    console.error('Function error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'internal error' }) };
  }
};
