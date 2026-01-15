import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import rateLimit from "express-rate-limit";

// Multer: uso require per evitare problemi di typings in build
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer") as any;

const prisma = new PrismaClient();

const app = express();
console.log("BOOT_MARKER dfeb9f9");
app.get("/__version", (_req, res) => {
  res.json({
    service: "clasp-backend",
    time: new Date().toISOString(),
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
  });
});

const httpServer = http.createServer(app);

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("Missing JWT_SECRET in production");
}

const SALT_ROUNDS = 10;

// -------------------- CORS (robusto, senza throw) --------------------
// Origini base
const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://claspme.com",
  "https://www.claspme.com",
];

// Origini extra via env (comma-separated)
const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultOrigins, ...extraOrigins]);

// Netlify preview del tuo sito (modifica il nome se cambia)
const NETLIFY_SITE = process.env.NETLIFY_SITE || "unrivaled-trifle-02bba5";
const NETLIFY_PREVIEW_RE = new RegExp(
  `^https:\\/\\/[a-z0-9-]+--${NETLIFY_SITE}\\.netlify\\.app$`,
  "i"
);
const NETLIFY_PROD_RE = new RegExp(`^https:\\/\\/${NETLIFY_SITE}\\.netlify\\.app$`, "i");

function isAllowedOrigin(origin?: string): boolean {
  // richieste senza Origin (curl, server-side) → CONSENTI
  if (!origin) return true;

  if (allowedOrigins.has(origin)) return true;
  if (NETLIFY_PREVIEW_RE.test(origin)) return true;
  if (NETLIFY_PROD_RE.test(origin)) return true;

  return false;
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // IMPORTANTISSIMO: non fare throw / non passare Error, altrimenti ti genera 500
    cb(null, isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});



app.use(cors(corsOptions));
// Preflight esplicito (sicuro)
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "10mb" }));

/** ===== Uploads (avatar + immagini chat) =====
 *  Nota: per persistenza su Railway, monta un Volume su /app/uploads
 *  oppure imposta env UPLOADS_DIR a un path persistente.
 */
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), "uploads");

const AVATAR_DIR = path.join(UPLOADS_DIR, "avatars");
const CHAT_IMG_DIR = path.join(UPLOADS_DIR, "chat-images");
const FILES_DIR = path.join(UPLOADS_DIR, "files");
const AUDIO_DIR = path.join(UPLOADS_DIR, "audio");

for (const dir of [UPLOADS_DIR, AVATAR_DIR, CHAT_IMG_DIR, FILES_DIR, AUDIO_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// pubblico
app.use("/uploads", express.static(UPLOADS_DIR, {
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));

const storage = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    const field = String(file?.fieldname || "");
    if (field === "avatar") return cb(null, AVATAR_DIR);
    if (field === "audio") return cb(null, AUDIO_DIR);
    if (field === "file") return cb(null, FILES_DIR);
    // default: immagini chat
    return cb(null, CHAT_IMG_DIR);
  },
  filename: (req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname || "").slice(0, 12) || "";
    const safe = `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, safe);
  },
});

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_AUDIO_MIMES = new Set(["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4"]);
const ALLOWED_FILE_MIMES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function isAllowedUpload(fieldname: string, mimetype: string): boolean {
  const f = String(fieldname || "").toLowerCase();
  const mt = String(mimetype || "").toLowerCase();

  // avatar + immagini chat
  if (f === "avatar" || f === "image") return ALLOWED_IMAGE_MIMES.has(mt);

  // vocali
  if (f === "audio") return ALLOWED_AUDIO_MIMES.has(mt);

  // allegati
  if (f === "file") return ALLOWED_FILE_MIMES.has(mt);

  // default: blocca
  return false;
}

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req: any, file: any, cb: any) => {
    const ok = isAllowedUpload(String(file?.fieldname || ""), String(file?.mimetype || ""));
    if (!ok) return cb(new Error("Tipo file non consentito"));
    return cb(null, true);
  },
});

/** ===== Auth middleware ===== */
type AuthedRequest = Request & { userId?: number };

function getBearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: "Token mancante" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userId = Number(decoded?.userId);
    if (!userId) return res.status(401).json({ error: "Token non valido" });
    req.userId = userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Token mancante o malformato" });
  }
}

function safeUser(u: any, opts?: { includeEmail?: boolean }) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  if (opts?.includeEmail) return rest;
  const { email, ...pub } = rest;
  return pub;
}

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

/** ===== Socket.IO ===== */
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ["GET", "POST"],
  },
});

io.use((socket, next) => {
  // Il client di solito manda token in auth: { token }
  const token =
    (socket.handshake as any)?.auth?.token ||
    (socket.handshake as any)?.query?.token ||
    null;

  if (!token) {
    (socket.data as any).userId = null;
    return next();
  }

  try {
    const decoded = jwt.verify(String(token), JWT_SECRET) as any;
    (socket.data as any).userId = Number(decoded?.userId) || null;
  } catch {
    (socket.data as any).userId = null;
  }
  next();
});

async function ensureParticipant(conversationId: number, userId: number) {
  const part = await prisma.conversationParticipant.findFirst({
    where: { conversationId, userId },
  } as any);
  return !!part;
}

io.on("connection", (socket) => {
  socket.on("conversation:join", async ({ conversationId }: any) => {
    const cid = Number(conversationId);
    const uid = Number((socket.data as any).userId);
    if (!cid || !uid) return;

    const ok = await ensureParticipant(cid, uid);
    if (!ok) return;

    socket.join(`conv_${cid}`);
  });

  socket.on("typing", async ({ conversationId }: any) => {
    const cid = Number(conversationId);
    const uid = Number((socket.data as any).userId);
    if (!cid || !uid) return;

    const ok = await ensureParticipant(cid, uid);
    if (!ok) return;

    socket.to(`conv_${cid}`).emit("typing", { conversationId: cid, userId: uid });
  });

  socket.on("message:send", async ({ conversationId, content, replyToId }: any) => {
    try {
      const cid = Number(conversationId);
      const uid = Number((socket.data as any).userId);
      const text = String(content || "").trim();
      const rtid = replyToId == null ? null : Number(replyToId);

      if (!cid || !uid || !text) return;

      const ok = await ensureParticipant(cid, uid);
      if (!ok) return;

      // include sender per evitare problemi frontend
      const msg = await prisma.message.create({
        data: {
          conversationId: cid,
          senderId: uid,
          content: text,
          replyToId: Number.isFinite(rtid as any) ? (rtid as any) : null,
        } as any,
        include: { sender: true } as any,
      } as any);

      const payload = { ...msg, sender: safeUser((msg as any).sender) };

      io.to(`conv_${cid}`).emit("message:new", { conversationId: cid, message: payload });
      io.to(`conv_${cid}`).emit("message", { conversationId: cid, message: payload }); // alias compat
    } catch (e) {
      console.error("SOCKET_MESSAGE_SEND_ERR", e);
    }
  });
});

/** ===== Routes ===== */

app.get("/health", (_req, res) => res.json({ ok: true }));

// AUTH
app.post("/auth/register", authLimiter, async (req, res) => {
  try {
    const {
      email,
      password,
      username,
      displayName,
      city = null,
      area = null,
      termsAccepted,
    } = req.body || {};

    if (!email || !password || !username || !displayName) {
      return res.status(400).json({ error: "Campi mancanti" });
    }

    if (termsAccepted !== true) {
      return res.status(400).json({ error: "Devi accettare i Termini e le Condizioni" });
    }

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    } as any);
    if (exists) return res.status(409).json({ error: "Email o username già in uso" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        displayName,
        passwordHash,
        city,
        area,
        state: "OFFLINE",
        statusText: null,
        interests: null,
        lastSeen: new Date(),
        termsAccepted: true,
      } as any,
    } as any);

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user, { includeEmail: true }) });
  } catch (e) {
    console.error("REGISTER_ERR", e);
    return res.status(500).json({ error: "Errore registrazione" });
  }
});

app.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) return res.status(400).json({ error: "Campi mancanti" });

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
    } as any);

    if (!user) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(password, (user as any).passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeen: new Date() } as any,
      } as any);
    } catch {}

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user, { includeEmail: true }) });
  } catch (e) {
    console.error("LOGIN_ERR", e);
    return res.status(500).json({ error: "Errore login" });
  }
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer = require("nodemailer") as any;

const RESET_JWT_SECRET = process.env.RESET_JWT_SECRET || `${JWT_SECRET}__reset`;
const RESET_JWT_EXPIRES = process.env.RESET_JWT_EXPIRES || "30m"; // 30 minuti
const APP_URL = String(process.env.APP_URL || "https://claspme.com").replace(/\/+$/, "");

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendResetEmail(to: string, link: string) {
  if (!smtpConfigured()) {
    console.warn("SMTP non configurato. Link reset (debug):", link);
    return;
  }

  const host = String(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || "587");
  const user = String(process.env.SMTP_USER);
  const pass = String(process.env.SMTP_PASS);
  const from = String(process.env.SMTP_FROM || `CLASP <${user}>`);

  const secure = port === 465; // 465=SSL, 587=STARTTLS
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // IONOS su 587 richiede TLS/STARTTLS
    requireTLS: !secure,
  });

  const subject = "Reimposta la password - CLASP";
  const text = `Hai richiesto il reset della password.\n\nApri questo link:\n${link}\n\nSe non sei stato tu, ignora questa email.`;
  const html = `
    <p>Hai richiesto il reset della password.</p>
    <p><a href="${link}">Clicca qui per reimpostare la password</a></p>
    <p>Se non sei stato tu, ignora questa email.</p>
  `;

  await transporter.sendMail({ from, to, subject, text, html });
}

// ===== AUTH: Password reset request =====
app.post("/auth/password-reset/request", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();

  // Risposta immediata (non rivela se l’email esiste)
  res.json({ ok: true });

  setImmediate(async () => {
    try {
      if (!email) return;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return;

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      // Se SMTP non è configurato, non provare neanche
      if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
        console.warn("PASSWORD_RESET: SMTP not configured, skipping email send");
        return;
      }

      try {
        await sendPasswordResetEmail({ to: email, token });
      } catch (mailErr) {
        console.error("PASSWORD_RESET_EMAIL_ERR", mailErr);
      }
    } catch (err) {
      console.error("PASSWORD_RESET_BG_ERR", err);
    }
  });
});

// ===== AUTH: Password reset confirm =====
app.post("/auth/password-reset/confirm", resetLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!token) return res.status(400).json({ error: "Token mancante" });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password troppo corta" });

    let decoded: any = null;
    try {
      decoded = jwt.verify(token, RESET_JWT_SECRET);
    } catch {
      return res.status(400).json({ error: "Token non valido o scaduto" });
    }

    const userId = Number(decoded?.userId || 0);
    const pw = String(decoded?.pw || "");
    if (!userId || !pw) return res.status(400).json({ error: "Token non valido" });

    const user = await prisma.user.findUnique({ where: { id: userId } } as any);
    if (!user) return res.status(400).json({ error: "Token non valido" });

    const curSig = String((user as any).passwordHash || "").slice(0, 12);
    if (curSig !== pw) return res.status(400).json({ error: "Token non valido o già usato" });

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash } as any,
    } as any);

    return res.json({ ok: true });
  } catch (e) {
    console.error("PASSWORD_RESET_CONFIRM_ERR", e);
    return res.status(500).json({ error: "Errore reset password" });
  }
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.userId! } } as any);
    if (!me) return res.status(404).json({ error: "Utente non trovato" });
    return res.json(safeUser(me, { includeEmail: true }));
  } catch (e) {
    console.error("ME_ERR", e);
    return res.status(500).json({ error: "Errore /me" });
  }
});

// Profilo update (impostazioni)
app.patch("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const data: any = {};
    const body = req.body || {};

    const allowed = ["displayName", "statusText", "state", "city", "area", "interests", "mood"];
    for (const k of allowed) {
      if (k in body) data[k] = body[k];
    }

    const updated = await prisma.user.update({
      where: { id: req.userId! },
      data,
    } as any);

    return res.json(safeUser(updated, { includeEmail: true }));
  } catch (e) {
    console.error("ME_PATCH_ERR", e);
    return res.status(500).json({ error: "Errore aggiornamento profilo" });
  }
});

// Upload avatar
app.post("/upload/avatar", requireAuth, upload.single("avatar"), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File mancante" });

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl } as any,
    } as any);

    return res.json({ ok: true, avatarUrl, user: safeUser(updated, { includeEmail: true }) });
  } catch (e) {
    console.error("UPLOAD_AVATAR_ERR", e);
    return res.status(500).json({ error: "Errore upload avatar" });
  }
});

// Upload immagine chat
app.post("/upload/image", requireAuth, upload.single("image"), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File mancante" });
    const url = `/uploads/chat-images/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    console.error("UPLOAD_IMAGE_ERR", e);
    return res.status(500).json({ error: "Errore upload immagine" });
  }
});

// Upload file generico (documenti, ecc.)
app.post("/upload/file", requireAuth, upload.single("file"), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File mancante" });
    const url = `/uploads/files/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    console.error("UPLOAD_FILE_ERR", e);
    return res.status(500).json({ error: "Errore upload file" });
  }
});

// Upload audio (vocali)
app.post("/upload/audio", requireAuth, upload.single("audio"), async (req: any, res: any) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File mancante" });
    const url = `/uploads/audio/${req.file.filename}`;
    return res.json({ ok: true, url });
  } catch (e) {
    console.error("UPLOAD_AUDIO_ERR", e);
    return res.status(500).json({ error: "Errore upload audio" });
  }
});

// Ricerca utenti (colonna ricerca)
app.get("/users/search", searchLimiter, requireAuth, async (req: AuthedRequest, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const city = String(req.query.city || "").trim();
    const area = String(req.query.area || "").trim();
    const mood = String(req.query.mood || "").trim();
    const state = String(req.query.state || "").trim();
    const visibleOnly = String(req.query.visibleOnly || "").trim() === "true";

    const where: any = { NOT: { id: req.userId! } };

    if (q) {
      where.OR = [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ];
    }
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (area) where.area = { contains: area, mode: "insensitive" };
    if (mood) where.mood = mood;
    if (state) where.state = state;
    if (visibleOnly) where.state = "VISIBILE_A_TUTTI";

    const users = await prisma.user.findMany({
      where,
      orderBy: { id: "desc" },
      take: 80,
    } as any);

    return res.json(users.map((u: any) => safeUser(u)));
  } catch (e) {
    console.error("USER_SEARCH_ERR", e);
    return res.status(500).json({ error: "Errore ricerca utenti" });
  }
});
// ===============================
// COMPAT: ricerca utenti via /users?q=...
// ===============================
app.get("/users", searchLimiter, requireAuth, async (req: AuthedRequest, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const city = String(req.query.city || "").trim();
    const area = String(req.query.area || "").trim();
    const mood = String(req.query.mood || "").trim();
    const state = String(req.query.state || "").trim();
    const visibleOnly = String(req.query.visibleOnly || "").trim() === "true";

    const where: any = { NOT: { id: req.userId! } };

    if (q) {
      where.OR = [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    if (city) where.city = { contains: city, mode: "insensitive" };
    if (area) where.area = { contains: area, mode: "insensitive" };
    if (mood) where.mood = mood;
    if (state) where.state = state;
    if (visibleOnly) where.state = "VISIBILE_A_TUTTI";

    const users = await prisma.user.findMany({
      where,
      orderBy: { id: "desc" },
      take: 80,
    } as any);

    res.json(users.map((u: any) => safeUser(u)));
  } catch (e) {
    console.error("GET /users error:", e);
    res.status(500).json({ error: "Errore ricerca utenti" });
  }
});

/** FRIENDS */
app.get("/friends", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const rows = await prisma.friend.findMany({
      where: { OR: [{ userAId: myId }, { userBId: myId }] },
      include: { userA: true, userB: true },
    } as any);

    const friends = rows
      .map((f: any) => (f.userAId === myId ? f.userB : f.userA))
      .filter(Boolean)
      .map((u: any) => safeUser(u));

    return res.json(friends);
  } catch (e) {
    console.error("FRIENDS_ERR", e);
    return res.status(500).json({ error: "Errore caricamento amici" });
  }
});

// richieste ricevute
app.get("/friends/requests/received", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: myId },
      orderBy: { createdAt: "desc" },
      include: { sender: true },
    } as any);

    return res.json(
      requests.map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        senderId: r.senderId,
        receiverId: r.receiverId,
        sender: safeUser(r.sender),
      }))
    );
  } catch (e) {
    console.error("REQ_RECEIVED_ERR", e);
    return res.status(500).json({ error: "Errore caricamento richieste" });
  }
});

// richieste inviate
app.get("/friends/requests/sent", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const requests = await prisma.friendRequest.findMany({
      where: { senderId: myId },
      orderBy: { createdAt: "desc" },
      include: { receiver: true },
    } as any);

    return res.json(
      requests.map((r: any) => ({
        id: r.id,
        createdAt: r.createdAt,
        senderId: r.senderId,
        receiverId: r.receiverId,
        receiver: safeUser(r.receiver),
      }))
    );
  } catch (e) {
    console.error("REQ_SENT_ERR", e);
    return res.status(500).json({ error: "Errore caricamento richieste inviate" });
  }
});

// alias compat (alcune versioni del frontend chiamano /friends/requests)
app.get("/friends/requests", requireAuth, async (req: AuthedRequest, res) => {
  // per compat: rimando le ricevute
  return app._router.handle(
    { ...req, url: "/friends/requests/received", path: "/friends/requests/received" } as any,
    res,
    (() => {}) as any
  );
});

// invio richiesta amicizia
app.post("/friends/requests", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const otherId = Number(req.body?.userId);

    if (!otherId || Number.isNaN(otherId)) return res.status(400).json({ error: "userId non valido" });
    if (otherId === myId) return res.status(400).json({ error: "Non puoi aggiungere te stesso" });

    const alreadyFriend = await prisma.friend.findFirst({
      where: {
        OR: [
          { userAId: myId, userBId: otherId },
          { userAId: otherId, userBId: myId },
        ],
      },
    } as any);
    if (alreadyFriend) return res.status(409).json({ error: "Siete già amici" });

    const existingReq = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: myId, receiverId: otherId },
          { senderId: otherId, receiverId: myId },
        ],
      },
    } as any);
    if (existingReq) return res.status(409).json({ error: "Richiesta già presente" });

    const fr = await prisma.friendRequest.create({
      data: { senderId: myId, receiverId: otherId, status: "PENDING" } as any,
    } as any);

    return res.json({ ok: true, request: fr });
  } catch (e) {
    console.error("REQ_CREATE_ERR", e);
    return res.status(500).json({ error: "Errore invio richiesta" });
  }
});

app.post("/friends/requests/:id/accept", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "id non valido" });

    const fr = await prisma.friendRequest.findUnique({ where: { id } } as any);
    if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
    if ((fr as any).receiverId !== myId) return res.status(403).json({ error: "Non autorizzato" });

    const senderId = Number((fr as any).senderId);
    const a = Math.min(senderId, myId);
    const b = Math.max(senderId, myId);

    const already = await prisma.friend.findFirst({
      where: { OR: [{ userAId: a, userBId: b }, { userAId: b, userBId: a }] },
    } as any);

    if (!already) {
      await prisma.friend.create({ data: { userAId: a, userBId: b } as any } as any);
    }

    await prisma.friendRequest.delete({ where: { id } } as any);
    return res.json({ ok: true });
  } catch (e) {
    console.error("REQ_ACCEPT_ERR", e);
    return res.status(500).json({ error: "Errore accettazione richiesta" });
  }
});

app.post("/friends/requests/:id/decline", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "id non valido" });

    const fr = await prisma.friendRequest.findUnique({ where: { id } } as any);
    if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
    if ((fr as any).receiverId !== myId) return res.status(403).json({ error: "Non autorizzato" });

    await prisma.friendRequest.delete({ where: { id } } as any);
    return res.json({ ok: true });
  } catch (e) {
    console.error("REQ_DECLINE_ERR", e);
    return res.status(500).json({ error: "Errore rifiuto richiesta" });
  }
});

/** CONVERSATIONS */
app.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;

    const convs = await prisma.conversation.findMany({
      where: { participants: { some: { userId: myId } } },
      include: {
        participants: { include: { user: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { sender: true } as any,
        },
      },
      orderBy: { id: "desc" },
    } as any);

    return res.json(
      convs.map((c: any) => {
        const participants = (c.participants || []).map((p: any) => ({ ...p, user: safeUser(p.user) }));
        const last = (c.messages && c.messages[0]) ? { ...c.messages[0], sender: safeUser(c.messages[0].sender) } : null;
        return {
          ...c,
          participants,
          lastMessage: last,
        };
      })
    );
  } catch (e) {
    console.error("CONV_LIST_ERR", e);
    return res.status(500).json({ error: "Errore caricamento conversazioni" });
  }
});

// crea o recupera chat 1-1
app.post("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const otherUserId = Number(req.body?.otherUserId);

    if (!otherUserId || Number.isNaN(otherUserId)) return res.status(400).json({ error: "otherUserId non valido" });
    if (otherUserId === myId) return res.status(400).json({ error: "Non valido" });

    const existing = await prisma.conversation.findFirst({
      where: {
        participants: { some: { userId: myId } },
        AND: [{ participants: { some: { userId: otherUserId } } }],
      },
      include: { participants: { include: { user: true } } },
    } as any);

    if (existing) {
      return res.json({
        ...existing,
        participants: (existing as any).participants.map((p: any) => ({ ...p, user: safeUser(p.user) })),
      });
    }

    const created = await prisma.conversation.create({
      data: {
        participants: {
          create: [{ userId: myId }, { userId: otherUserId }],
        },
      } as any,
      include: { participants: { include: { user: true } } },
    } as any);

    return res.json({
      ...created,
      participants: (created as any).participants.map((p: any) => ({ ...p, user: safeUser(p.user) })),
    });
  } catch (e) {
    console.error("CONV_CREATE_ERR", e);
    return res.status(500).json({ error: "Errore creazione conversazione" });
  }
});

app.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const conversationId = Number(req.params.id);

    const ok = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: myId },
    } as any);

    if (!ok) return res.status(403).json({ error: "Non autorizzato" });

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { sender: true } as any,
    } as any);

    // replyTo manual (senza dipendere dalla relation Prisma)
    const replyIds = Array.from(
      new Set(
        messages
          .map((m: any) => (m.replyToId == null ? null : Number(m.replyToId)))
          .filter((v: any) => typeof v === "number" && Number.isFinite(v))
      )
    );

    let replyMap: Record<number, any> = {};
    if (replyIds.length > 0) {
      const replied = await prisma.message.findMany({
        where: { id: { in: replyIds } },
        include: { sender: true } as any,
      } as any);

      replyMap = Object.fromEntries(
        replied.map((m: any) => [
          m.id,
          { ...m, sender: safeUser(m.sender) },
        ])
      );
    }

    return res.json(
      messages.map((m: any) => ({
        ...m,
        sender: safeUser(m.sender),
        replyTo: m.replyToId ? replyMap[Number(m.replyToId)] || null : null,
      }))
    );
  } catch (e) {
    console.error("MSG_LIST_ERR", e);
    return res.status(500).json({ error: "Errore caricamento messaggi" });
  }
});

// invio messaggio via HTTP (fallback)
app.post("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const conversationId = Number(req.params.id);
    const content = String(req.body?.content || "").trim();
    const replyToId = req.body?.replyToId == null ? null : Number(req.body.replyToId);

    if (!content) return res.status(400).json({ error: "Messaggio vuoto" });

    const ok = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: myId },
    } as any);
    if (!ok) return res.status(403).json({ error: "Non autorizzato" });

    const msg = await prisma.message.create({
      data: { conversationId, senderId: myId, content, replyToId } as any,
      include: { sender: true } as any,
    } as any);

    const payload = { ...msg, sender: safeUser((msg as any).sender) };
    io.to(`conv_${conversationId}`).emit("message:new", { conversationId, message: payload });

    return res.json(payload);
  } catch (e) {
    console.error("MSG_SEND_ERR", e);
    return res.status(500).json({ error: "Errore invio messaggio" });
  }
});

// invio messaggio via endpoint compat /messages (fallback di alcuni frontend)
app.post("/messages", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const conversationId = Number(req.body?.conversationId);
    const content = String(req.body?.content || req.body?.text || req.body?.message || "").trim();
    const replyToId = req.body?.replyToId == null ? null : Number(req.body.replyToId);

    if (!conversationId || Number.isNaN(conversationId)) return res.status(400).json({ error: "conversationId non valido" });
    if (!content) return res.status(400).json({ error: "Messaggio vuoto" });

    const ok = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: myId },
    } as any);
    if (!ok) return res.status(403).json({ error: "Non autorizzato" });

    const msg = await prisma.message.create({
      data: { conversationId, senderId: myId, content, replyToId } as any,
      include: { sender: true } as any,
    } as any);

    const payload = { ...msg, sender: safeUser((msg as any).sender) };
    io.to(`conv_${conversationId}`).emit("message:new", { conversationId, message: payload });

    return res.json(payload);
  } catch (e) {
    console.error("MSG_SEND_COMPAT_ERR", e);
    return res.status(500).json({ error: "Errore invio messaggio" });
  }
});

// edit messaggio
app.patch("/messages/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const id = Number(req.params.id);
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Contenuto vuoto" });

    const msg0 = await prisma.message.findUnique({ where: { id } } as any);
    if (!msg0) return res.status(404).json({ error: "Messaggio non trovato" });
    if ((msg0 as any).senderId !== myId) return res.status(403).json({ error: "Non autorizzato" });

    const msg = await prisma.message.update({
      where: { id },
      data: { content, editedAt: new Date() } as any,
      include: { sender: true } as any,
    } as any);

    const payload = { ...msg, sender: safeUser((msg as any).sender) };
    io.to(`conv_${(msg as any).conversationId}`).emit("message:updated", { conversationId: (msg as any).conversationId, message: payload });

    return res.json(payload);
  } catch (e) {
    console.error("MSG_EDIT_ERR", e);
    return res.status(500).json({ error: "Errore modifica messaggio" });
  }
});

// delete messaggio (soft)
app.delete("/messages/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const id = Number(req.params.id);

    const msg0 = await prisma.message.findUnique({ where: { id } } as any);
    if (!msg0) return res.status(404).json({ error: "Messaggio non trovato" });
    if ((msg0 as any).senderId !== myId) return res.status(403).json({ error: "Non autorizzato" });

    const msg = await prisma.message.update({
      where: { id },
      data: { deletedAt: new Date(), content: "" } as any,
      include: { sender: true } as any,
    } as any);

    const payload = { ...msg, sender: safeUser((msg as any).sender) };
    io.to(`conv_${(msg as any).conversationId}`).emit("message:deleted", { conversationId: (msg as any).conversationId, message: payload });

    return res.json(payload);
  } catch (e) {
    console.error("MSG_DELETE_ERR", e);
    return res.status(500).json({ error: "Errore eliminazione messaggio" });
  }
});

// delete conversazione
app.delete("/conversations/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const conversationId = Number(req.params.id);

    const ok = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: myId },
    } as any);
    if (!ok) return res.status(403).json({ error: "Non autorizzato" });

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } } as any),
      prisma.conversationParticipant.deleteMany({ where: { conversationId } } as any),
      prisma.conversation.delete({ where: { id: conversationId } } as any),
    ] as any);

    return res.json({ ok: true });
  } catch (e) {
    console.error("CONV_DELETE_ERR", e);
    return res.status(500).json({ error: "Errore eliminazione conversazione" });
  }
});

/** ===== Error handling ===== */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("UNHANDLED_ERR", err);
  return res.status(500).json({ error: "Errore server" });
});

app.use((_req, res) => {
  return res.status(404).json({ error: "Not found" });
});

httpServer.listen(PORT, () => {
  console.log(`Backend online su http://localhost:${PORT}`);
});
