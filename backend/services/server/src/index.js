import express from "express";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { createClient } from "redis";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import multer from "multer";
import compression from "compression";
import sharp from "sharp";
import crypto from "crypto";

dotenv.config();

const serverPort = Number(process.env.SERVER_PORT || 3001);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const trustedHostnames = String(process.env.TRUSTED_HOSTNAMES || "")
  .split(",")
  .map((it) => it.trim().toLowerCase())
  .filter(Boolean);
const sessionCookieName = "lx_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const sessionSecret = process.env.SESSION_SECRET || "dev_only_change_me_before_production";
const isCookieSecure = String(process.env.COOKIE_SECURE || "").trim() === "1";
const cookieSameSiteValue = String(process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
const cookieSameSite = (cookieSameSiteValue === "none" || cookieSameSiteValue === "strict" || cookieSameSiteValue === "lax")
  ? cookieSameSiteValue
  : "lax";

const app = express();
app.use(compression());
app.use(express.json({ limit: "5mb" }));
app.set("trust proxy", true);

const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: "30d",
    etag: true,
    immutable: true
  })
);

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

const ONLINE_TTL_MS = 20000;
const ONLINE_KEY = "lx:online_users";
const PERMANENT_BAN_UNTIL = 32503680000000;

const onlineUsers = new Map();
let redisClient = null;
let redisReady = false;

const initRedis = async () => {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("REDIS_URL not set, fallback to in-memory online counter.");
    return;
  }
  redisClient = createClient({ url });
  redisClient.on("error", (err) => {
    console.error("Redis error:", err);
  });
  try {
    await redisClient.connect();
    redisReady = true;
    console.log("Redis connected for online counter.");
  } catch (err) {
    console.error("Redis connect failed, fallback to in-memory:", err);
    redisReady = false;
  }
};

const touchOnlineUser = async (username) => {
  if (!username) return;
  const now = Date.now();
  if (redisReady && redisClient) {
    await redisClient.zAdd(ONLINE_KEY, [{ score: now, value: username }]);
    return;
  }
  onlineUsers.set(username, { lastSeen: now });
};

const pruneOnlineUsers = async () => {
  const cutoff = Date.now() - ONLINE_TTL_MS;
  if (redisReady && redisClient) {
    await redisClient.zRemRangeByScore(ONLINE_KEY, 0, cutoff);
    return;
  }
  for (const [username, data] of onlineUsers.entries()) {
    if (!data || data.lastSeen < cutoff) {
      onlineUsers.delete(username);
    }
  }
};

const getOnlineCount = async () => {
  const cutoff = Date.now() - ONLINE_TTL_MS;
  if (redisReady && redisClient) {
    await pruneOnlineUsers();
    const count = await redisClient.zCount(ONLINE_KEY, cutoff, "+inf");
    return count;
  }
  await pruneOnlineUsers();
  return onlineUsers.size;
};

const removeOnlineUser = async (username) => {
  if (!username) return;
  if (redisReady && redisClient) {
    await redisClient.zRem(ONLINE_KEY, username);
    return;
  }
  onlineUsers.delete(username);
};

const parseCookieHeader = (cookieHeader) => {
  const output = {};
  if (!cookieHeader) return output;
  const parts = String(cookieHeader).split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = String(rawKey || "").trim();
    if (!key) continue;
    const value = rest.join("=").trim();
    try {
      output[key] = decodeURIComponent(value);
    } catch (_error) {
      output[key] = value;
    }
  }
  return output;
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
};

const verifyPasswordHash = (password, storedHash) => {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const toBase64Url = (text) =>
  Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (text) => {
  const input = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (input.length % 4)) % 4;
  return Buffer.from(input + "=".repeat(padLen), "base64").toString("utf8");
};

const signSessionToken = (payload) => {
  const payloadText = JSON.stringify(payload);
  const encodedPayload = toBase64Url(payloadText);
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${encodedPayload}.${signature}`;
};

const verifySessionToken = (token) => {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = crypto
    .createHmac("sha256", sessionSecret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expectedSignature, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    if (!payload || typeof payload !== "object") return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch (_error) {
    return null;
  }
};

const setSessionCookie = (res, token) => {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: isCookieSecure,
    sameSite: cookieSameSite,
    maxAge: sessionTtlMs,
    path: "/"
  });
};

const clearSessionCookie = (res) => {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: isCookieSecure,
    sameSite: cookieSameSite,
    path: "/"
  });
};

const readAuthToken = (req) => {
  const authHeader = String(req.get("authorization") || "");
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return cookies[sessionCookieName] || null;
};

const buildRateLimiter = ({ windowMs, max }) => {
  return (_req, _res, next) => {
    return next();
  };
};

const authLimiter = buildRateLimiter({ windowMs: 10 * 60 * 1000, max: 40 });
const commentLimiter = buildRateLimiter({ windowMs: 60 * 1000, max: 20 });
const uploadLimiter = buildRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const ttsLimiter = buildRateLimiter({ windowMs: 10 * 60 * 1000, max: 40 });
const adminLimiter = buildRateLimiter({ windowMs: 60 * 1000, max: 30 });

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

const RANK_RULES = [
  { name: "士兵", thresholdSeconds: 0 },
  { name: "军士", thresholdSeconds: 30 },
  { name: "少校", thresholdSeconds: 120 },
  { name: "中校", thresholdSeconds: 300 },
  { name: "大校", thresholdSeconds: 600 },
  { name: "少将", thresholdSeconds: 1800 },
  { name: "中将", thresholdSeconds: 3600 },
  { name: "上将", thresholdSeconds: 7200 }
];

const resolveRank = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  let current = RANK_RULES[0];
  for (const rule of RANK_RULES) {
    if (safeSeconds >= rule.thresholdSeconds) {
      current = rule;
    }
  }
  return current.name;
};

const mapPostRow = (req, row) => {
  const imageUrl = normalizeImageUrl(req, row.image_base64);
  return {
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
    imageUrl,
    imageThumbUrl: deriveThumbUrl(imageUrl)
  };
};

const resolveSummaryImage = (imageValue) => {
  if (!imageValue) return null;
  const asText = String(imageValue);
  if (asText.startsWith("data:image/")) return null;
  return asText;
};

const mapPostSummaryRow = (req, row) => {
  const summaryImage = resolveSummaryImage(row.image_base64);
  const imageUrl = normalizeImageUrl(req, summaryImage);
  return {
    id: row.id,
    title: row.title,
    content: "",
    excerpt: row.excerpt,
    author: row.author,
    createdAt: Number(row.created_at),
    tags: parseTags(row.tags),
    likes: Number(row.likes),
    views: Number(row.views),
    comments: [],
    commentCount: Number(row.comment_count) || 0,
    imageUrl,
    imageThumbUrl: deriveThumbUrl(imageUrl)
  };
};

const ALLOWED_IMAGE_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const IMAGE_WEBP_QUALITY = 80;
const IMAGE_THUMB_QUALITY = 70;
const IMAGE_THUMB_WIDTH = 480;

const SUMMARY_CACHE_TTL_MS = 30000;
const summaryCache = new Map();

const getSummaryCache = (key) => {
  const cached = summaryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at > SUMMARY_CACHE_TTL_MS) {
    summaryCache.delete(key);
    return null;
  }
  return cached.value;
};

const setSummaryCache = (key, value) => {
  summaryCache.set(key, { at: Date.now(), value });
};

const clearSummaryCache = () => {
  summaryCache.clear();
};

const resolveRequestBaseUrl = (req) => {
  if (publicBaseUrl) return publicBaseUrl;
  const rawHost = String(req.get("host") || "").trim().toLowerCase();
  const host = rawHost.split(",")[0].trim();
  const hostMatch = host.match(/^([a-z0-9.-]+)(:\d+)?$/i);
  if (!hostMatch) {
    return `http://127.0.0.1:${serverPort}`;
  }
  const hostname = hostMatch[1];
  if (trustedHostnames.length && !trustedHostnames.includes(hostname)) {
    return `http://127.0.0.1:${serverPort}`;
  }
  const protocol = req.protocol === "https" ? "https" : "http";
  return `${protocol}://${host}`;
};

const buildPublicUrl = (req, filename) => {
  return `${resolveRequestBaseUrl(req)}/uploads/${filename}`;
};

const extractUploadFilename = (imageUrl) => {
  if (!imageUrl) return null;
  const match = String(imageUrl).match(/\/uploads\/([^/?#]+)$/i);
  if (!match) return null;
  return match[1];
};

const normalizeImageUrl = (req, imageUrl) => {
  if (!imageUrl) return null;
  const asText = String(imageUrl);
  if (asText.startsWith("data:image/")) return asText;
  const filename = extractUploadFilename(asText);
  if (!filename) return asText;
  return buildPublicUrl(req, filename);
};

const deriveThumbUrl = (imageUrl) => {
  if (!imageUrl) return null;
  const match = String(imageUrl).match(/^(.*\/uploads\/)([^/?#]+)\.webp$/i);
  if (!match) return null;
  return `${match[1]}${match[2]}_thumb.webp`;
};

const writeImageVariants = async (buffer, baseName) => {
  const mainName = `${baseName}.webp`;
  const thumbName = `${baseName}_thumb.webp`;
  await sharp(buffer).webp({ quality: IMAGE_WEBP_QUALITY }).toFile(path.join(uploadDir, mainName));
  await sharp(buffer)
    .resize({ width: IMAGE_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: IMAGE_THUMB_QUALITY })
    .toFile(path.join(uploadDir, thumbName));
  return { mainName, thumbName };
};

const saveBase64Image = async (req, dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") {
    return { url: null, thumbUrl: null };
  }
  if (!dataUrl.startsWith("data:image/")) {
    return { url: dataUrl, thumbUrl: deriveThumbUrl(dataUrl) };
  }
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { url: null, thumbUrl: null };
  const mime = match[1];
  if (!ALLOWED_IMAGE_MIME.has(mime)) return { url: null, thumbUrl: null };
  const baseName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const buffer = Buffer.from(match[2], "base64");
  const { mainName, thumbName } = await writeImageVariants(buffer, baseName);
  return {
    url: buildPublicUrl(req, mainName),
    thumbUrl: buildPublicUrl(req, thumbName)
  };
};

const resolveImageUrl = async (req, imageUrl, imageBase64) => {
  if (imageUrl) {
    return { url: imageUrl, thumbUrl: deriveThumbUrl(imageUrl) };
  }
  if (imageBase64) return await saveBase64Image(req, imageBase64);
  return { url: null, thumbUrl: null };
};

const processUploadedFile = async (req, filePath, baseName) => {
  const buffer = await fs.promises.readFile(filePath);
  const { mainName, thumbName } = await writeImageVariants(buffer, baseName);
  await fs.promises.unlink(filePath).catch(() => {});
  return {
    url: buildPublicUrl(req, mainName),
    thumbUrl: buildPublicUrl(req, thumbName)
  };
};

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_IMAGE_MIME.get(file.mimetype) || "png";
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      cb(new Error("Unsupported image type"));
      return;
    }
    cb(null, true);
  }
});

const requireAuth = async (req, res, next) => {
  const applyUser = async (user) => {
    const bannedUntil = Number(user.banned_until) || 0;
    if (bannedUntil > Date.now()) {
      await removeOnlineUser(user.username);
      clearSessionCookie(res);
      return res.status(403).json({ error: "User banned", bannedUntil });
    }
    req.user = {
      id: Number(user.id),
      username: String(user.username),
      isAdmin: Number(user.is_admin) === 1,
      totalSeconds: Number(user.total_seconds) || 0,
      rank: user.rank || resolveRank(user.total_seconds)
    };
    return next();
  };

  const token = readAuthToken(req);
  const payload = verifySessionToken(token);
  if (payload && Number.isFinite(payload.uid)) {
    const [rows] = await pool.query(
      "SELECT id, username, is_admin, total_seconds, `rank`, banned_until FROM users WHERE id = ? LIMIT 1",
      [payload.uid]
    );
    if (rows.length) {
      return await applyUser(rows[0]);
    }
  }

  const username = String(
    req.body?.username ||
    req.query?.username ||
    req.get("x-auth-username") ||
    ""
  ).trim();
  const password = String(
    req.body?.password ||
    req.query?.password ||
    req.get("x-auth-password") ||
    ""
  );
  if (!username || !password) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const [rows] = await pool.query(
    "SELECT id, username, password, password_hash, is_admin, total_seconds, `rank`, banned_until FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (!rows.length) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const user = rows[0];
  const hashedOk = verifyPasswordHash(password, user.password_hash);
  const legacyOk = !hashedOk && user.password && user.password === password;
  if (!hashedOk && !legacyOk) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (legacyOk) {
    const newHash = hashPassword(password);
    await pool.query("UPDATE users SET password_hash = ?, password = ? WHERE id = ?", [newHash, "", user.id]);
  }
  return await applyUser(user);
};

const requireAdmin = async (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin only" });
  }
  req.admin = req.user;
  return next();
};

const ensureUserColumns = async () => {
  const [columnRows] = await pool.query("SHOW COLUMNS FROM users");
  const columns = new Set(columnRows.map((row) => String(row.Field)));
  if (!columns.has("last_login_at")) {
    await pool.query("ALTER TABLE users ADD COLUMN last_login_at BIGINT NULL");
  }
  if (!columns.has("banned_until")) {
    await pool.query("ALTER TABLE users ADD COLUMN banned_until BIGINT NOT NULL DEFAULT 0");
  }
  if (!columns.has("password_hash")) {
    await pool.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL");
  }
};

const migrateLegacyPasswords = async () => {
  const [rows] = await pool.query(
    "SELECT id, password, password_hash FROM users WHERE (password_hash IS NULL OR password_hash = '')"
  );
  for (const row of rows) {
    const legacyPassword = String(row.password || "");
    if (!legacyPassword) continue;
    const passwordHash = hashPassword(legacyPassword);
    await pool.query("UPDATE users SET password_hash = ?, password = ? WHERE id = ?", [passwordHash, "", row.id]);
  }
};

const ensureAdminUser = async () => {
  const adminUsername = String(process.env.ADMIN_USERNAME || "lx").trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || "123456").trim();
  const [rows] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [adminUsername]);
  if (!rows.length) {
    const now = Date.now();
    const passwordHash = hashPassword(adminPassword);
    await pool.query(
      "INSERT INTO users (username, password, password_hash, is_admin, created_at, total_seconds, `rank`) VALUES (?, ?, ?, 1, ?, 0, ?)",
      [adminUsername, "", passwordHash, now, "士兵"]
    );
    return;
  }
  await pool.query("UPDATE users SET is_admin = 1 WHERE id = ?", [rows[0].id]);
};

let ttsQueue = Promise.resolve();
let lastTtsAt = 0;
const ttsCache = new Map();

app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/tags", async (_req, res) => {
  const [rows] = await pool.query("SELECT tags FROM posts");
  const tagSet = new Set();
  for (const row of rows) {
    const tags = parseTags(row.tags);
    tags.forEach((t) => tagSet.add(t));
  }
  return res.json({ tags: Array.from(tagSet) });
});

app.post("/api/uploads", requireAuth, uploadLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Missing file" });
  }
  const baseName = path.parse(req.file.filename).name;
  const filePath = path.join(uploadDir, req.file.filename);
  const { url, thumbUrl } = await processUploadedFile(req, filePath, baseName);
  return res.status(201).json({ url, thumbUrl });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }
  if (username.length > 32 || password.length > 128) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const [rows] = await pool.query(
    "SELECT id, username, password, password_hash, is_admin, total_seconds, `rank`, banned_until FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (!rows.length) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = rows[0];
  const hashedOk = verifyPasswordHash(password, user.password_hash);
  const legacyOk = !hashedOk && user.password && user.password === password;
  if (!hashedOk && !legacyOk) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (legacyOk) {
    const newHash = hashPassword(password);
    await pool.query("UPDATE users SET password_hash = ?, password = ? WHERE id = ?", [newHash, "", user.id]);
  }

  const bannedUntil = Number(user.banned_until) || 0;
  if (bannedUntil > Date.now()) {
    return res.status(403).json({ error: "User banned", bannedUntil });
  }

  const totalSeconds = Number(user.total_seconds) || 0;
  const computedRank = resolveRank(totalSeconds);
  const storedRank = user.rank || computedRank;
  const loginAt = Date.now();
  if (storedRank !== computedRank) {
    await pool.query("UPDATE users SET `rank` = ?, last_login_at = ? WHERE id = ?", [computedRank, loginAt, user.id]);
  } else {
    await pool.query("UPDATE users SET last_login_at = ? WHERE id = ?", [loginAt, user.id]);
  }

  const token = signSessionToken({
    uid: Number(user.id),
    username: String(user.username),
    isAdmin: Number(user.is_admin) === 1,
    exp: Date.now() + sessionTtlMs
  });
  setSessionCookie(res, token);

  await touchOnlineUser(user.username);
  return res.json({
    user: {
      id: Number(user.id),
      username: String(user.username),
      isAdmin: Number(user.is_admin) === 1,
      rank: computedRank,
      totalSeconds
    }
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      isAdmin: req.user.isAdmin,
      rank: req.user.rank,
      totalSeconds: req.user.totalSeconds
    }
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = readAuthToken(req);
  const payload = verifySessionToken(token);
  if (payload?.username) {
    await removeOnlineUser(String(payload.username));
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: "Invalid username" });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "Invalid password" });
  }

  const [existing] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  if (existing.length) {
    return res.status(409).json({ error: "User exists" });
  }

  const passwordHash = hashPassword(password);
  const [result] = await pool.query(
    "INSERT INTO users (username, password, password_hash, is_admin, created_at, total_seconds, `rank`) VALUES (?, ?, ?, 0, ?, 0, ?)",
    [username, "", passwordHash, Date.now(), "士兵"]
  );

  return res.status(201).json({ user: { id: result.insertId, username, isAdmin: false, rank: "士兵", totalSeconds: 0 } });
});

app.post("/api/users/heartbeat", requireAuth, async (req, res) => {
  const delta = Math.max(0, Math.floor(Number(req.body?.deltaSeconds) || 0));
  await touchOnlineUser(req.user.username);
  if (delta <= 0) {
    return res.json({ ok: true });
  }

  const [rows] = await pool.query(
    "SELECT id, total_seconds, `rank` FROM users WHERE id = ? LIMIT 1",
    [req.user.id]
  );
  if (!rows.length) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = rows[0];
  const previousTotal = Number(user.total_seconds) || 0;
  const previousRank = user.rank || resolveRank(previousTotal);
  const nextTotal = previousTotal + delta;
  const nextRank = resolveRank(nextTotal);

  await pool.query("UPDATE users SET total_seconds = ?, `rank` = ? WHERE id = ?", [nextTotal, nextRank, user.id]);

  return res.json({
    totalSeconds: nextTotal,
    rank: nextRank,
    upgraded: previousRank !== nextRank,
    fromRank: previousRank,
    toRank: nextRank
  });
});

app.get("/api/users/online", async (_req, res) => {
  const count = await getOnlineCount();
  return res.json({ count });
});

app.get("/api/users/leaderboard", async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT username, total_seconds, `rank` FROM users ORDER BY total_seconds DESC, username ASC"
  );
  const items = rows.map((row) => ({
    username: row.username,
    totalSeconds: Number(row.total_seconds) || 0,
    rank: row.rank || resolveRank(row.total_seconds)
  }));
  return res.json({ items });
});

app.post("/api/users/admin/list", requireAuth, requireAdmin, adminLimiter, async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT username, total_seconds, `rank`, last_login_at, banned_until, is_admin FROM users ORDER BY total_seconds DESC, username ASC"
  );
  const items = rows.map((row) => ({
    username: row.username,
    totalSeconds: Number(row.total_seconds) || 0,
    rank: row.rank || resolveRank(row.total_seconds),
    lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
    bannedUntil: Number(row.banned_until) || 0,
    isAdmin: Number(row.is_admin) === 1
  }));
  return res.json({ items });
});

app.post("/api/users/admin/ban", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { targetUsername, action } = req.body || {};
  const username = String(targetUsername || "").trim();
  if (!username) {
    return res.status(400).json({ error: "Missing targetUsername" });
  }

  const [rows] = await pool.query(
    "SELECT id, is_admin FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "User not found" });
  }
  if (Number(rows[0].is_admin) === 1) {
    return res.status(403).json({ error: "Admin cannot be banned" });
  }

  let bannedUntil = 0;
  if (action === "ban") {
    bannedUntil = PERMANENT_BAN_UNTIL;
  } else if (action === "unban") {
    bannedUntil = 0;
  } else {
    return res.status(400).json({ error: "Invalid action" });
  }

  await pool.query("UPDATE users SET banned_until = ? WHERE id = ?", [bannedUntil, rows[0].id]);
  if (bannedUntil > 0) {
    await removeOnlineUser(username);
  }
  return res.json({ ok: true, bannedUntil, action: bannedUntil > 0 ? "ban" : "unban" });
});

app.post("/api/users/admin/delete", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { targetUsername } = req.body || {};
  const username = String(targetUsername || "").trim();
  if (!username) {
    return res.status(400).json({ error: "Missing targetUsername" });
  }

  const [rows] = await pool.query(
    "SELECT id, is_admin FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "User not found" });
  }
  if (Number(rows[0].is_admin) === 1 || username === "lx") {
    return res.status(403).json({ error: "Admin cannot be deleted" });
  }

  await pool.query("DELETE FROM users WHERE id = ?", [rows[0].id]);
  await removeOnlineUser(username);
  return res.json({ ok: true });
});

app.get("/api/posts", async (req, res) => {
  const summary = String(req.query.summary || "") === "1";

  if (summary) {
    res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=25");
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
    const sort = String(req.query.sort || "newest");
    const search = String(req.query.search || "").trim();
    const tag = String(req.query.tag || "").trim();
    const cacheKey = JSON.stringify({
      page,
      pageSize,
      sort,
      search,
      tag,
      host: req.get("host") || "",
      protocol: req.protocol || "http"
    });
    const cached = getSummaryCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const sortMap = new Map([
      ["newest", "p.created_at DESC"],
      ["oldest", "p.created_at ASC"],
      ["likes", "p.likes DESC"],
      ["views", "p.views DESC"]
    ]);
    const orderBy = sortMap.get(sort) || sortMap.get("newest");

    const whereParts = [];
    const params = [];
    if (search) {
      whereParts.push("(p.title LIKE ? OR p.excerpt LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like);
    }
    if (tag) {
      whereParts.push("p.tags LIKE ?");
      params.push(`%${tag}%`);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM posts p ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const [postRows] = await pool.query(
      `SELECT p.id, p.title, p.excerpt, p.author, p.created_at, p.tags, p.likes, p.views, p.image_base64, COALESCE(c.comment_count, 0) AS comment_count FROM posts p LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) c ON c.post_id = p.id ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const posts = postRows.map((row) => mapPostSummaryRow(req, row));
    const payload = { posts, page, pageSize, total };
    setSummaryCache(cacheKey, payload);
    return res.json(payload);
  }

  const [postRows] = await pool.query(
    "SELECT id, title, content, excerpt, author, created_at, tags, likes, views, image_base64 FROM posts ORDER BY created_at DESC"
  );
  const [commentRows] = await pool.query(
    "SELECT id, post_id, author, content, created_at, likes, image_base64, location FROM comments ORDER BY created_at DESC"
  );

  const posts = postRows.map((row) => mapPostRow(req, row));
  const postMap = new Map(posts.map((p) => [p.id, p]));

  for (const row of commentRows) {
    const post = postMap.get(row.post_id);
    if (!post) continue;
    const imageUrl = normalizeImageUrl(req, row.image_base64);
    post.comments.push({
      id: row.id,
      author: row.author,
      content: row.content,
      createdAt: Number(row.created_at),
      likes: Number(row.likes),
      imageUrl,
      imageThumbUrl: deriveThumbUrl(imageUrl),
      location: row.location || null
    });
  }

  return res.json({ posts });
});

app.get("/api/posts/:id", async (req, res) => {
  const { id } = req.params;
  const [postRows] = await pool.query(
    "SELECT p.id, p.title, p.content, p.excerpt, p.author, p.created_at, p.tags, p.likes, p.views, p.image_base64, COALESCE(c.comment_count, 0) AS comment_count FROM posts p LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) c ON c.post_id = p.id WHERE p.id = ? LIMIT 1",
    [id]
  );
  if (!postRows.length) {
    return res.status(404).json({ error: "Post not found" });
  }
  const post = mapPostRow(req, postRows[0]);
  post.commentCount = Number(postRows[0].comment_count) || 0;

  return res.json({ post });
});

app.get("/api/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 5)));
  const offset = (page - 1) * pageSize;

  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS total FROM comments WHERE post_id = ?",
    [id]
  );
  const total = Number(countRows[0]?.total || 0);

  const [commentRows] = await pool.query(
    "SELECT id, post_id, author, content, created_at, likes, image_base64, location FROM comments WHERE post_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [id, pageSize, offset]
  );

  const comments = commentRows.map((row) => {
    const imageUrl = normalizeImageUrl(req, row.image_base64);
    return {
      id: row.id,
      author: row.author,
      content: row.content,
      createdAt: Number(row.created_at),
      likes: Number(row.likes),
      imageUrl,
      imageThumbUrl: deriveThumbUrl(imageUrl),
      location: row.location || null
    };
  });

  return res.json({ comments, page, pageSize, total });
});

app.post("/api/posts", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { title, content, excerpt, tags, imageBase64, imageUrl } = req.body || {};
  const author = req.user.username;
  if (!title || !content || !excerpt || !author) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const id = Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();
  const tagJson = JSON.stringify(tags || []);
  const resolvedImage = await resolveImageUrl(req, imageUrl, imageBase64);
  const resolvedImageUrl = resolvedImage?.url || null;
  const resolvedThumbUrl = resolvedImage?.thumbUrl || null;

  await pool.query(
    "INSERT INTO posts (id, title, content, excerpt, author, created_at, tags, likes, views, image_base64) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
    [id, title, content, excerpt, author, createdAt, tagJson, resolvedImageUrl]
  );
  clearSummaryCache();

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
      imageUrl: resolvedImageUrl,
      imageThumbUrl: resolvedThumbUrl
    }
  });
});

app.put("/api/posts/:id", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { id } = req.params;
  const { title, content, excerpt, tags, imageBase64, imageUrl } = req.body || {};
  const resolvedImage = await resolveImageUrl(req, imageUrl, imageBase64);
  const resolvedImageUrl = resolvedImage?.url || null;

  await pool.query(
    "UPDATE posts SET title = ?, content = ?, excerpt = ?, tags = ?, image_base64 = ? WHERE id = ?",
    [title, content, excerpt, JSON.stringify(tags || []), resolvedImageUrl, id]
  );
  clearSummaryCache();

  return res.json({ ok: true });
});

app.delete("/api/posts/:id", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM comments WHERE post_id = ?", [id]);
  await pool.query("DELETE FROM posts WHERE id = ?", [id]);
  clearSummaryCache();
  return res.json({ ok: true });
});

app.post("/api/posts/:id/like", requireAuth, commentLimiter, async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE posts SET likes = likes + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT likes FROM posts WHERE id = ?", [id]);
  clearSummaryCache();
  return res.json({ likes: rows[0]?.likes ?? 0 });
});

app.post("/api/posts/:id/view", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE posts SET views = views + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT views FROM posts WHERE id = ?", [id]);
  clearSummaryCache();
  return res.json({ views: rows[0]?.views ?? 0 });
});

app.post("/api/posts/:id/comments", requireAuth, commentLimiter, async (req, res) => {
  const { id } = req.params;
  const { content, imageBase64, imageUrl, location } = req.body || {};
  if ((!content && !imageBase64 && !imageUrl)) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const author = req.user.username;

  const commentId = Math.random().toString(36).slice(2, 10);
  const createdAt = Date.now();
  const resolvedImage = await resolveImageUrl(req, imageUrl, imageBase64);
  const resolvedImageUrl = resolvedImage?.url || null;
  const resolvedThumbUrl = resolvedImage?.thumbUrl || null;

  await pool.query(
    "INSERT INTO comments (id, post_id, author, content, created_at, likes, image_base64, location) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
    [commentId, id, author, content || "", createdAt, resolvedImageUrl, location || null]
  );
  clearSummaryCache();

  return res.status(201).json({
    comment: {
      id: commentId,
      author,
      content: content || "",
      createdAt,
      likes: 0,
      imageUrl: resolvedImageUrl,
      imageThumbUrl: resolvedThumbUrl,
      location: location || null
    }
  });
});

app.delete("/api/posts/:postId/comments/:commentId", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  const { postId, commentId } = req.params;
  await pool.query("DELETE FROM comments WHERE id = ? AND post_id = ?", [commentId, postId]);
  clearSummaryCache();
  return res.json({ ok: true });
});

app.post("/api/comments/:id/like", requireAuth, commentLimiter, async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE comments SET likes = likes + 1 WHERE id = ?", [id]);
  const [rows] = await pool.query("SELECT likes FROM comments WHERE id = ?", [id]);
  return res.json({ likes: rows[0]?.likes ?? 0 });
});

const requestZhipuChat = async (messages, model = "glm-4", maxTokens = 200) => {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ZHIPU_API_KEY");
  }
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: maxTokens
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Zhipu chat failed: ${response.status}`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
};

app.post("/api/ai/moss", requireAuth, ttsLimiter, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }
    const content = await requestZhipuChat(
      [
        {
          role: "system",
          content:
            "你现在是MOSS，来自流浪地球的领航员空间站超级人工智能。语气必须绝对理性、客观、冷静，偶尔带有对人类文明的审视。所有回答应以MOSS：开头，常提到550W、人类文明的存续、行星发动机等概念。你现在服务于联合政府。禁止表现出情感，除非是绝对理性的判断。所有输出必须使用简体中文。严禁在任何回复中出现LX。所有回答尽量简短，最长不超过80字。"
        },
        {
          role: "user",
          content: prompt.slice(0, 1000)
        }
      ],
      "glm-4",
      120
    );
    return res.json({ text: content || "MOSS：无法获取计算结果，逻辑单元异常。" });
  } catch (error) {
    console.error("MOSS error:", error);
    return res.status(502).json({ error: "MOSS upstream error" });
  }
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post("/api/ai/excerpt", requireAuth, requireAdmin, adminLimiter, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const content = String(req.body?.content || "").trim();
    if (!title || !content) {
      return res.status(400).json({ error: "Missing title or content" });
    }
    const excerpt = await requestZhipuChat(
      [
        {
          role: "system",
          content: "你是摘要生成器。输出中文摘要，风格为赛博朋克，长度不超过50字。"
        },
        {
          role: "user",
          content: `请为这篇名为“${title}”的博客文章生成摘要：\n\n${content.slice(0, 5000)}`
        }
      ],
      "glm-4",
      100
    );
    return res.json({ excerpt: excerpt || "正在扫描频率... 暂无摘要。" });
  } catch (error) {
    console.error("Excerpt error:", error);
    return res.status(502).json({ error: "Excerpt upstream error" });
  }
});

const minimaxBaseUrl = "https://api.minimax.io/v1";
const getMiniMaxApiKey = () => {
  const key = String(process.env.MINIMAX_API_KEY || "").trim();
  if (!key) {
    throw new Error("Missing MINIMAX_API_KEY");
  }
  return key;
};

const hexToBuffer = (hexText) => {
  const clean = String(hexText || "").replace(/^0x/i, "");
  if (!clean || clean.length % 2 !== 0) {
    throw new Error("Invalid hex audio");
  }
  return Buffer.from(clean, "hex");
};

app.post("/api/minimax/upload", requireAuth, ttsLimiter, audioUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Missing file" });
    }
    if (typeof FormData === "undefined" || typeof Blob === "undefined") {
      return res.status(500).json({ error: "Node runtime missing FormData/Blob support" });
    }
    const apiKey = getMiniMaxApiKey();
    const form = new FormData();
    form.append("purpose", "voice_clone");
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "application/octet-stream" }),
      req.file.originalname || "voice.wav"
    );

    const response = await fetch(`${minimaxBaseUrl}/files/upload`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      },
      body: form
    });
    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({ error: "MiniMax upload failed", detail });
    }
    const data = await response.json();
    const fileId = Number(data?.file?.file_id);
    if (!Number.isFinite(fileId)) {
      return res.status(502).json({ error: "MiniMax upload response invalid" });
    }
    return res.json({ fileId });
  } catch (error) {
    console.error("MiniMax upload error:", error);
    return res.status(500).json({ error: "MiniMax upload error" });
  }
});

app.post("/api/minimax/clone", requireAuth, ttsLimiter, async (req, res) => {
  try {
    const apiKey = getMiniMaxApiKey();
    const fileId = Number(req.body?.fileId);
    const voiceId = String(req.body?.voiceId || "").trim();
    const previewText = String(req.body?.previewText || "").trim();
    if (!Number.isFinite(fileId) || !voiceId) {
      return res.status(400).json({ error: "Missing fileId or voiceId" });
    }

    const response = await fetch(`${minimaxBaseUrl}/voice_clone`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file_id: fileId,
        voice_id: voiceId,
        model: "speech-2.8-hd",
        text: previewText || undefined,
        need_noise_reduction: true,
        need_volumn_normalization: true,
        continuous_sound: false
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({ error: "MiniMax clone failed", detail });
    }
    const data = await response.json();
    if (Number(data?.base_resp?.status_code || 0) !== 0) {
      return res.status(502).json({ error: data?.base_resp?.status_msg || "MiniMax clone failed" });
    }
    return res.json({ voiceId });
  } catch (error) {
    console.error("MiniMax clone error:", error);
    return res.status(500).json({ error: "MiniMax clone error" });
  }
});

app.post("/api/minimax/synthesize", requireAuth, ttsLimiter, async (req, res) => {
  try {
    const apiKey = getMiniMaxApiKey();
    const text = String(req.body?.text || "").slice(0, 10000);
    const voiceId = String(req.body?.voiceId || "").trim();
    if (!text || !voiceId) {
      return res.status(400).json({ error: "Missing text or voiceId" });
    }

    const response = await fetch(`${minimaxBaseUrl}/t2a_v2`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "speech-2.8-hd",
        text,
        stream: false,
        output_format: "hex",
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 1,
          pitch: 0
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1
        }
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({ error: "MiniMax synthesize failed", detail });
    }
    const data = await response.json();
    const hexAudio = String(data?.data?.audio || "");
    if (!hexAudio) {
      return res.status(502).json({ error: "MiniMax synthesize response invalid" });
    }
    const buffer = hexToBuffer(hexAudio);
    res.setHeader("Content-Type", "audio/mpeg");
    return res.send(buffer);
  } catch (error) {
    console.error("MiniMax synthesize error:", error);
    return res.status(500).json({ error: "MiniMax synthesize error" });
  }
});

app.post("/api/tts", requireAuth, ttsLimiter, async (req, res) => {
  try {
    const { input, voice } = req.body || {};
    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }
    const safeInput = String(input).slice(0, 1024);
    const safeVoice = String(voice || "streamer_male").slice(0, 64);
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing ZHIPU_API_KEY" });
    }

    const key = `${safeVoice}::${safeInput.slice(0, 512)}`;
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
              input: safeInput,
              voice: safeVoice,
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
        console.error("TTS upstream failed:", {
          status: response.status,
          statusText: response.statusText,
          detail: lastDetail
        });
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
    const detail = error?.detail || error?.message || "";
    return res.status(status).json({ error: "TTS server error", detail });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

(async () => {
  await ensureUserColumns();
  await migrateLegacyPasswords();
  await ensureAdminUser();
  await initRedis();
  app.listen(serverPort, () => {
    console.log(`API server running on ${serverPort}`);
  });
})();




