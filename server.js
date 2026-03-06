const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'posts.json');
const ARCHIVE = path.join(__dirname, 'posts-archive.json');
const ACTIONS = path.join(__dirname, 'actions-log.json');

app.use(express.json());

function readPosts(){
  try{
    const raw = fs.readFileSync(DATA, 'utf8') || '[]';
    return JSON.parse(raw);
  }catch(e){
    return [];
  }
}

function writePosts(posts){
  fs.writeFileSync(DATA, JSON.stringify(posts, null, 2));
}

function readArchive(){
  try{
    const raw = fs.readFileSync(ARCHIVE, 'utf8') || '[]';
    return JSON.parse(raw);
  }catch(e){
    return [];
  }
}

function writeArchive(posts){
  fs.writeFileSync(ARCHIVE, JSON.stringify(posts, null, 2));
}

function readActions(){
  try{
    const raw = fs.readFileSync(ACTIONS, 'utf8') || '[]';
    return JSON.parse(raw);
  }catch(e){
    return [];
  }
}

function writeActions(actions){
  fs.writeFileSync(ACTIONS, JSON.stringify(actions, null, 2));
}

function logAction(action){
  try{
    const actions = readActions();
    actions.unshift(Object.assign({ time: new Date().toISOString() }, action));
    // keep last 1000 actions
    writeActions(actions.slice(0, 1000));
  }catch(e){
    console.error('Failed to write action log', e);
  }
}

function isAdminAuthorized(reqBody, authHeader){
  const PUBLISH_PASSWORD = process.env.PUBLISH_PASSWORD || 'secret';
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
  // Header token: Authorization: Bearer <token>
  if (authHeader){
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer'){
      // If ADMIN_TOKEN is set, require it. Otherwise allow the publish password as bearer for convenience.
      if (ADMIN_TOKEN && parts[1] === ADMIN_TOKEN) return true;
      if (!ADMIN_TOKEN && parts[1] === PUBLISH_PASSWORD) return true;
    }
  }
  // Fallback to password in body
  if (reqBody && reqBody.password && reqBody.password === PUBLISH_PASSWORD) return true;
  return false;
}

function pruneOldPosts(days = 30){
  try{
    const posts = readPosts();
    if (!posts.length) return {kept:0, archived:0};
    const now = Date.now();
    const cutoff = now - (days * 24 * 60 * 60 * 1000);
    const keep = [];
    const toArchive = [];
    for (const p of posts){
      const t = new Date(p.date).getTime();
      if (isNaN(t) || t >= cutoff) keep.push(p); else toArchive.push(p);
    }
    if (toArchive.length){
      const existing = readArchive();
      const merged = toArchive.concat(existing);
      writeArchive(merged);
      writePosts(keep);
      console.log(`Pruned ${toArchive.length} post(s) older than ${days} days to posts-archive.json`);
      return {kept: keep.length, archived: toArchive.length};
    }
    return {kept: keep.length, archived: 0};
  }catch(err){
    console.error('Error pruning posts:', err);
    return {kept:0, archived:0};
  }
}

app.get('/api/posts', (req, res) => {
  res.json(readPosts());
});

app.post('/api/posts', (req, res) => {
  const { title, excerpt, body, author, tags, password } = req.body;
  // simple publish password check
  const PUBLISH_PASSWORD = process.env.PUBLISH_PASSWORD || 'secret';
  if (!password || password !== PUBLISH_PASSWORD) {
    return res.status(401).json({ error: 'invalid publish password' });
  }
  if(!title || !body) return res.status(400).json({ error: 'title and body required' });

  // Prevent duplicate posts:
  // - No more than one post per calendar day (UTC)
  // - No duplicate title or body across existing posts
  const posts = readPosts();
  const todayYMD = new Date().toISOString().slice(0,10); // YYYY-MM-DD UTC
  for (const p of posts){
    const pYMD = (p.date && !isNaN(new Date(p.date).getTime())) ? new Date(p.date).toISOString().slice(0,10) : null;
    if (pYMD && pYMD === todayYMD) {
      return res.status(409).json({ error: 'a post already exists for today; one post per day is allowed' });
    }
    if (p.title && p.title.trim().toLowerCase() === title.trim().toLowerCase()){
      return res.status(409).json({ error: 'a post with the same title already exists' });
    }
    if (p.body && p.body.trim() === body.trim()){
      return res.status(409).json({ error: 'a post with identical body content already exists' });
    }
  }
  
  const post = {
    id: Date.now(),
    title,
    excerpt: excerpt || '',
    body,
    author: author || 'Alayande',
    tags: Array.isArray(tags) ? tags : [],
    date: new Date().toISOString()
  };
  posts.unshift(post);
  writePosts(posts);
  // prune older posts after adding the new one
  try{ pruneOldPosts(30); }catch(e){}
  // log publish action
  try{ logAction({ action: 'publish', id: post.id, title: post.title, author: post.author }); }catch(e){}
  res.json(post);
});

// Edit a post (admin) - requires publish password
app.put('/api/posts/:id', (req, res) => {
  const id = req.params.id;
  const { title, excerpt, body, author, tags, password } = req.body;
  if (!isAdminAuthorized(req.body, req.get('Authorization'))) return res.status(401).json({ error: 'invalid publish credentials' });
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const posts = readPosts();
  const idx = posts.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'post not found' });
  // basic duplicate/title/day checks (allow editing the same post)
  // ensure no other post has same title or identical body
  for (const p of posts){
    if (String(p.id) === String(id)) continue;
    if (p.title && p.title.trim().toLowerCase() === title.trim().toLowerCase()){
      return res.status(409).json({ error: 'another post with same title exists' });
    }
    if (p.body && p.body.trim() === body.trim()){
      return res.status(409).json({ error: 'another post with identical body exists' });
    }
  }
  const now = new Date().toISOString();
  posts[idx].title = title;
  posts[idx].excerpt = excerpt || '';
  posts[idx].body = body;
  posts[idx].author = author || posts[idx].author || 'Alayande';
  posts[idx].tags = Array.isArray(tags) ? tags : (posts[idx].tags || []);
  posts[idx].updatedAt = now;
  writePosts(posts);
  try{ logAction({ action: 'edit', id: posts[idx].id, title: posts[idx].title }); }catch(e){}
  res.json(posts[idx]);
});

// Delete a post (admin) - requires publish password
app.delete('/api/posts/:id', (req, res) => {
  const id = req.params.id;
  if (!isAdminAuthorized(req.body, req.get('Authorization'))) return res.status(401).json({ error: 'invalid publish credentials' });
  const posts = readPosts();
  const idx = posts.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'post not found' });
  const [removed] = posts.splice(idx,1);
  writePosts(posts);
  // move removed to archive as well
  try{
    const archived = readArchive();
    archived.unshift(removed);
    writeArchive(archived);
  }catch(e){}
  try{ logAction({ action: 'delete', id: removed.id, title: removed.title }); }catch(e){}
  res.json({ ok:true, removed });
});

// List archived posts (admin)
app.get('/api/archive', (req, res) => {
  const authHeader = req.get('Authorization');
  if (!isAdminAuthorized(null, authHeader)) return res.status(401).json({ error: 'invalid publish credentials' });
  res.json(readArchive());
});

// Restore archived post by id (admin)
app.post('/api/archive/:id/restore', (req, res) => {
  const id = req.params.id;
  if (!isAdminAuthorized(req.body, req.get('Authorization'))) return res.status(401).json({ error: 'invalid publish credentials' });
  const archived = readArchive();
  const idx = archived.findIndex(p => String(p.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'archived post not found' });
  const [post] = archived.splice(idx,1);
  // restore date to now
  post.date = new Date().toISOString();
  const posts = readPosts();
  posts.unshift(post);
  writePosts(posts);
  writeArchive(archived);
  try{ logAction({ action: 'restore', id: post.id, title: post.title }); }catch(e){}
  res.json({ ok:true, restored: post });
});

// Admin action logs
app.get('/api/admin/logs', (req, res) => {
  const authHeader = req.get('Authorization');
  if (!isAdminAuthorized(null, authHeader)) return res.status(401).json({ error: 'invalid publish credentials' });
  res.json(readActions());
});

// Run pruning on startup and schedule daily pruning
try{ pruneOldPosts(30); }catch(e){}
setInterval(()=>{
  try{ pruneOldPosts(30); }catch(e){}
}, 24 * 60 * 60 * 1000);

// --- Contact form endpoint ---
const MESSAGES = path.join(__dirname, 'messages.json');

function readMessages(){
  try{
    const raw = fs.readFileSync(MESSAGES, 'utf8') || '[]';
    return JSON.parse(raw);
  }catch(e){
    return [];
  }
}

function writeMessages(messages){
  fs.writeFileSync(MESSAGES, JSON.stringify(messages, null, 2));
}

app.post('/api/contact', (req, res) => {
  const {name, email, whatsapp, subject, message} = req.body;
  
  // Basic validation
  if (!name || !email || !subject || !message) {
    return res.status(400).json({error: 'Name, Email, Subject, and Message are required'});
  }
  
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    return res.status(400).json({error: 'Invalid email format'});
  }
  
  // Store message
  const messages = readMessages();
  const newMessage = {
    id: Date.now(),
    name,
    email,
    whatsapp: whatsapp || null,
    subject,
    message,
    timestamp: new Date().toISOString(),
    read: false
  };
  
  messages.push(newMessage);
  writeMessages(messages);
  
  console.log(`📧 New contact message from ${name} (${email}): ${subject}`);
  
  return res.status(200).json({success: true, message: 'Message received successfully'});
});

// Test authentication endpoint for admin login
app.get('/api/admin/test-auth', (req, res) => {
  if (isAdminAuthorized({}, req.get('Authorization'))) {
    return res.status(200).json({authenticated: true});
  } else {
    return res.status(401).json({error: 'Invalid credentials'});
  }
});

// Serve static files last so API routes are checked first
app.use(express.static(path.join(__dirname)));

// Serve blog.html as the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'blog.html'));
});

// Force redeploy trigger

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
