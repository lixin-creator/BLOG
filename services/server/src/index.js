import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "lxblog",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const parseTags = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {
    if (typeof raw === "string") {
      return raw.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
};

const mapPostRow = (row) => ({
  id: row.id,
  title: row.title,
  content: row.content,
  excerpt: row.excerpt,
  author: row.author,
  createdAt: Number(row.created_at),
  tags: parseTags(row.tags),
  likes: Number(row.likes),
  views: Number(row.views),
  comments: [],
  imageUrl: row.image_base64 || null
});

const requireAdmin = async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(403).json({ error: "Admin only" });
  }

  const [rows] = await pool.query(
    "SELECT id, username, is_admin FROM users WHERE username = ? AND password = ? LIMIT 1",
    [username, password]
  );

  if (!rows.length || Number(rows[0].is_admin) !== 1) {
    return res.status(403).json({ error: "Admin only" });
  }

  req.admin = rows[0];
  return next();
};

const ensureAdminUser = async () => {
  await pool.query(
    "INSERT INTO users (username, password, is_admin, created_at) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE is_admin = 1",
    ["lx", "123456", Date.now()]
  );
};

let ttsQueue = Promise.resolve();
let lastTtsAt = 0;
const ttsCache = new Map();

app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const [rows] = await pool.query(
    "SELECT id, username, password, is_admin FROM users WHERE username = ? LIMIT 1",
    [username]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "User not found" });
  }

  const user = rows[0];
  if (user.password !== password) {
    return res.status(401).json({ error: "Invalid password" });
  }

  return res.json({ user: { id: user.id, username: user.username, isAdmin: Number(user.is_admin) === 1 } });
});

app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const [existing] = await pool.query(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );

  if (existing.length) {
    return res.status(409).json({ error: "User exists" });
  }

  const [result] = await pool.query(
    "INSERT INTO users (username, password, is_admin, created_at) VALUES (?, ?, 0, ?)",
    [username, password, Date.now()]
  );

  return res.status(201).json({ user: { id: result.insertId, username, isAdmin: false } });
});

app.get("/api/posts", async (_req, res) => {
  const [postRows] = await pool.query(
    "SELECT id, title, content, excerpt, author, created_at, tags, likes, views, image_base64 FROM posts ORDER BY created_at DESC"
  );
  const [commentRows] = await pool.query(
    "SELECT id, post_id, author, content, created_at, likes, image_base64, location FROM comments ORDER BY created_at DESC"
  );

  const posts = postRows.map(mapPostRow);
  const postMap = new Map(posts.map((p) => [p.id, p]));

  for (const row of commentRows) {
    const post = postMap.get(row.post_id);
    if (!post) continue;
    post.comments.push({
      id: row.id,
      author: row.author,
      content: row.content,
      createdAt: Number(row.created_at),
      likes: Number(row.likes),
      imageUrl: row.image_base64 || null,
      location: row.location || null
    });
  }

  return res.json({ posts });
});

app.post("/api/posts", requireAdmin, async (req, res) => {
  const { title, content, excerpt, author, tags, imageBase64 } = req.body || {};
  if (!title || !content || !excerpt || !author) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const id = Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();
  const tagJson = JSON.stringify(tags || []);

  await pool.query(
    "INSERT INTO posts (id, title, content, excerpt, author, created_at, tags, likes, views, image_base64) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
    [id, title, content, excerpt, author, createdAt, tagJson, imageBase64 || null]
  );

  return res.status(201).json({
    post: {
      id,
      title,
      content,
      excerpt,
      author,
      createdAt,
      tags: tags || [],
      likes: 0,
      views: 0,
      comments: [],
      imageUrl: imageBase64 || null
    }
  });
});

app.put("/api/posts/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, content, excerpt, tags, imageBase64 } = req.body || {};

  await pool.query(
    "UPDATE posts SET title = ?, content = ?, excerpt = ?, tags = ?, image_base64 = ? WHERE id = ?",
    [title, content, excerpt, JSON.stringify(tags || []), imageBase64 || null, id]
  );

  return res.json({ ok: true });
});

app.delete("/api/posts/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM comments WHERE post_id = ?", [id]);
  await pool.query("DELETE FROM posts WHERE id = ?", [id]);
  return res.json({ ok: true });
});

app.post("/api/posts/:id/like", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE posts SET likes = likes + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT likes FROM posts WHERE id = ?", [id]);
  return res.json({ likes: rows[0]?.likes ?? 0 });
});

app.post("/api/posts/:id/view", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE posts SET views = views + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT views FROM posts WHERE id = ?", [id]);
  return res.json({ views: rows[0]?.views ?? 0 });
});

app.post("/api/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const { author, content, imageBase64, location } = req.body || {};
  if (!author || (!content && !imageBase64)) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const commentId = Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();

  await pool.query(
    "INSERT INTO comments (id, post_id, author, content, created_at, likes, image_base64, location) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
    [commentId, id, author, content || "", createdAt, imageBase64 || null, location || null]
  );

  return res.status(201).json({
    comment: {
      id: commentId,
      author,
      content: content || "",
      createdAt,
      likes: 0,
      imageUrl: imageBase64 || null,
      location: location || null
    }
  });
});

app.delete("/api/posts/:postId/comments/:commentId", requireAdmin, async (req, res) => {
  const { postId, commentId } = req.params;
  await pool.query("DELETE FROM comments WHERE id = ? AND post_id = ?", [commentId, postId]);
  return res.json({ ok: true });
});

app.post("/api/comments/:id/like", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE comments SET likes = likes + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT likes FROM comments WHERE id = ?", [id]);
  return res.json({ likes: rows[0]?.likes ?? 0 });
});

app.post("/api/tts", async (req, res) => {
  try {
    const { input, voice } = req.body || {};
    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ZHIPU_API_KEY" });
    }

    const key = `${voice || "streamer_male"}::${String(input).slice(0, 512)}`;
    const cached = ttsCache.get(key);
    if (cached && Date.now() - cached.at < 60000) {
      res.setHeader("Content-Type", cached.type);
      return res.send(cached.buffer);
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const runTask = async () => {
      const now = Date.now();
      const minInterval = 2000;
      if (now - lastTtsAt < minInterval) {
        await sleep(minInterval - (now - lastTtsAt));
      }
      lastTtsAt = Date.now();

      const maxRetries = 3;
      let response = null;
      let lastDetail = "";

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        try {
          response = await fetch("https://open.bigmodel.cn/api/paas/v4/audio/speech", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "glm-tts",
              input: String(input).slice(0, 1024),
              voice: voice || "streamer_male",
              response_format: "wav",
              stream: false,
              speed: 1.0,
              volume: 1.0
            }),
            signal: controller.signal
          });
        } catch (err) {
          lastDetail = err?.message || "fetch failed";
          if (attempt === maxRetries) throw err;
          const delay = 800 * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        } finally {
          clearTimeout(timeoutId);
        }

        if (response.ok) break;
        lastDetail = await response.text();
        if (response.status !== 429 || attempt === maxRetries) break;
        const delay = 800 * Math.pow(2, attempt);
        await sleep(delay);
      }

      if (!response.ok) {
        const error = new Error("TTS request failed");
        error.status = response.status;
        error.detail = lastDetail;
        throw error;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") || "audio/wav";
      ttsCache.set(key, { buffer, type, at: Date.now() });
      return { buffer, type };
    };

    const task = ttsQueue.then(runTask);
    ttsQueue = task.catch(() => {});

    const result = await task;
    res.setHeader("Content-Type", result.type);
    return res.send(result.buffer);
  } catch (error) {
    console.error("TTS error:", error);
    const status = error?.status || 500;
    const detail = error?.detail || "";
    return res.status(status).json({ error: "TTS server error", detail });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

const port = Number(process.env.SERVER_PORT || 3001);
(async () => {
  await ensureAdminUser();
  app.listen(port, () => {
    console.log(`API server running on ${port}`);
  });
})();
