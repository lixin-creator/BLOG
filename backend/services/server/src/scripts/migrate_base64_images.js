import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import sharp from "sharp";

dotenv.config();

const IMAGE_WEBP_QUALITY = 80;
const IMAGE_THUMB_QUALITY = 70;
const IMAGE_THUMB_WIDTH = 480;

const ALLOWED_IMAGE_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const getArgValue = (name) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
};

const baseUrlArg = getArgValue("--base");
const baseUrl = (baseUrlArg || process.env.PUBLIC_BASE_URL || "").trim();
if (!baseUrl) {
  console.error("Missing base url. Use --base http://host:port");
  process.exit(1);
}

const normalizedBaseUrl = baseUrl.replace(/\/+$/g, "");
const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "lxblog",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

const parseDataUrl = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  if (!dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  if (!ALLOWED_IMAGE_MIME.has(mime)) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    return { mime, buffer };
  } catch {
    return null;
  }
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

const buildPublicUrl = (filename) => `${normalizedBaseUrl}/uploads/${filename}`;

const migrateTable = async (tableName) => {
  const [rows] = await pool.query(
    `SELECT id, image_base64 FROM ${tableName} WHERE image_base64 LIKE 'data:image/%'`
  );
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const parsed = parseDataUrl(row.image_base64);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    const baseName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { mainName } = await writeImageVariants(parsed.buffer, baseName);
      const url = buildPublicUrl(mainName);
      await pool.query(`UPDATE ${tableName} SET image_base64 = ? WHERE id = ?`, [url, row.id]);
      updated += 1;
    } catch (error) {
      console.error(`migrate ${tableName} ${row.id} failed:`, error?.message || error);
      skipped += 1;
    }
  }
  return { updated, skipped, total: rows.length };
};

const run = async () => {
  try {
    const postResult = await migrateTable("posts");
    const commentResult = await migrateTable("comments");
    console.log("Posts:", postResult);
    console.log("Comments:", commentResult);
  } finally {
    await pool.end();
  }
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
