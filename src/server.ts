import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";

import { prisma } from "./prisma";
import { authMiddleware, AuthRequest } from "./middleware/auth";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const SALT_ROUNDS = 10;

// --- CORS
const DEFAULT_ALLOWED_ORIGINS = ["https://claspme.com", "https://www.claspme.com"];
const EXTRA_ORIGINS_FROM_ENV = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ORIGINS_FROM_ENV];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

// --- Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

// --- Rate limit login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

// --- Helpers
const VALID_STATES = ["DISPONIBILE", "OCCUPATO", "ASSENTE", "OFFLINE", "INVISIBILE", "VISIBILE_A_TUTTI"];
const VALID_INTERESTS = ["LAVORO", "AMICIZIA", "CHATTARE", "DATING", "INCONTRI"];

function parseInterests(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((x) => x.trim()).filter(Boolean);
}
function serializeInterests(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return arr.join(",");
}
function validateInterests(arr: string[]): string | null {
  const invalid = arr.filter((x) => !VALID_INTERESTS.includes(x));
  return invalid.length ? `Interessi non validi: ${invalid.join(", ")}` : null;
}

function toUserDTO(user: any) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    state: user.state,
    statusText: user.statusText,
    city: user.city,
    area: user.area,
    interests: parseInterests(user.interests),
    avatarUrl: user.avatarUrl ?? null,
    mood: user.mood ?? null,
    lastSeen: user.lastSeen ? new Date(user.lastSeen).toISOString() : null,
  };
}

function toMessageDTO(msg: any) {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    content: msg.deletedAt ? "" : msg.content,
    createdAt: msg.createdAt?.toISOString?.() ?? msg.createdAt,
    editedAt: msg.editedAt ? new Date(msg.editedAt).toISOString() : null,
    deletedAt: msg.deletedAt ? new Date(msg.deletedAt).toISOString() : null,
    replyToId: msg.replyToId ?? null,
    sender: msg.sender ? toUserDTO(msg.sender) : null,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          senderId: msg.replyTo.senderId,
          content: msg.replyTo.deletedAt ? "" : msg.replyTo.content,
          createdAt: msg.replyTo.createdAt?.toISOString?.() ?? msg.replyTo.createdAt,
          editedAt: msg.replyTo.editedAt ? new Date(msg.replyTo.editedAt).toISOString() : null,
          deletedAt: msg.replyTo.deletedAt ? new Date(msg.replyTo.deletedAt).toISOString() : null,
          sender: msg.replyTo.sender ? toUserDTO(msg.replyTo.sender) : null,
        }
      : null,
  };
}

// --- uploads folder + static
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// --- multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const uploadImageMulter = multer({ storage });
const uploadAvatarMulter = multer({ storage });
const uploadAudioMulter = multer({ storage });

// --- health
app.get("/ping", (_req, res) => res.json({ message: "pong" }));

// ----------------------- AUTH -----------------------
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, displayName, username, city, area, termsAccepted } = req.body;

    if (!email || !password || !displayName || !username) {
      return res.status(400).json({ error: "email, password, displayName e username sono obbligatori" });
    }
    if (!termsAccepted) {
      return res.status(400).json({ error: "Devi accettare i Termini e le Condizioni d'uso." });
    }

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) return res.status(409).json({ error: "Esiste già un utente con questa email o username" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        email,
        username,
        displayName,
        passwordHash,
        city: city ?? null,
        area: area ?? null,
        state: "OFFLINE",
        statusText: null,
        interests: null,
        avatarUrl: null,
        mood: null,
        termsAccepted: true,
        lastSeen: new Date(),
      },
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: toUserDTO(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    if (!emailOrUsername || !password) return res.status(400).json({ error: "emailOrUsername e password sono obbligatori" });

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
    });
    if (!user) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: toUserDTO(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- ME -----------------------
app.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!me) return res.status(404).json({ error: "Utente non trovato" });
  res.json(toUserDTO(me));
});

app.put("/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { displayName, statusText, state, city, area, interests, avatarUrl, mood } = req.body;
    const data: any = {};

    if (displayName !== undefined) data.displayName = displayName;
    if (statusText !== undefined) data.statusText = statusText;
    if (city !== undefined) data.city = city;
    if (area !== undefined) data.area = area;
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;
    if (mood !== undefined) data.mood = mood;

    if (state !== undefined) {
      if (!VALID_STATES.includes(state)) return res.status(400).json({ error: `state non valido` });
      data.state = state;
    }

    if (interests !== undefined) {
      if (!Array.isArray(interests)) return res.status(400).json({ error: "interests deve essere un array" });
      const msg = validateInterests(interests);
      if (msg) return res.status(400).json({ error: msg });
      data.interests = serializeInterests(interests);
    }

    const updated = await prisma.user.update({ where: { id: req.user!.id }, data });
    res.json(toUserDTO(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- USERS SEARCH -----------------------
app.get("/users", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const visibleOnly = req.query.visibleOnly === "true";
    const mood = typeof req.query.mood === "string" ? req.query.mood.trim() : "";

    const where: any = {};
    if (q) where.OR = [{ username: { contains: q } }, { displayName: { contains: q } }, { email: { contains: q } }];
    if (visibleOnly) where.state = "VISIBILE_A_TUTTI";
    if (mood) where.mood = mood;

    const users = await prisma.user.findMany({ where, orderBy: { displayName: "asc" }, take: 50 });
    res.json(users.map(toUserDTO));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- FRIENDS -----------------------
app.post("/friends/request/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const receiverId = Number(req.params.id);
    const senderId = req.user!.id;
    if (receiverId === senderId) return res.status(400).json({ error: "Non puoi aggiungere te stesso" });

    const existing = await prisma.friendRequest.findFirst({
      where: { senderId, receiverId, status: "PENDING" },
    });
    if (existing) return res.status(400).json({ error: "Richiesta già inviata" });

    await prisma.friendRequest.create({ data: { senderId, receiverId, status: "PENDING" } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.get("/friends", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const friends = await prisma.friend.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: { userA: true, userB: true },
    });
    const list = friends.map((f) => (f.userAId === userId ? f.userB : f.userA)).map(toUserDTO);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.get("/friends/requests/received", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const reqs = await prisma.friendRequest.findMany({
      where: { receiverId: userId, status: "PENDING" },
      include: { sender: true },
    });
    res.json(reqs.map((r) => ({ id: r.id, sender: toUserDTO(r.sender) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.get("/friends/requests/sent", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const reqs = await prisma.friendRequest.findMany({
      where: { senderId: userId, status: "PENDING" },
      include: { receiver: true },
    });
    res.json(reqs.map((r) => ({ id: r.id, receiver: toUserDTO(r.receiver) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post("/friends/accept/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requestId = Number(req.params.id);
    const userId = req.user!.id;

    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
    if (fr.receiverId !== userId) return res.status(403).json({ error: "Non autorizzato" });

    await prisma.friend.create({ data: { userAId: fr.senderId, userBId: fr.receiverId } });
    await prisma.friendRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED" } });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post("/friends/decline/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requestId = Number(req.params.id);
    const userId = req.user!.id;

    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
    if (fr.receiverId !== userId) return res.status(403).json({ error: "Non autorizzato" });

    await prisma.friendRequest.update({ where: { id: requestId }, data: { status: "DECLINED" } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- CONVERSATIONS -----------------------
app.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const convs = await prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        participants: { include: { user: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { sender: true, replyTo: { include: { sender: true } } },
        },
      },
      orderBy: { id: "desc" },
    });

    res.json(
      convs.map((c) => ({
        ...c,
        participants: c.participants.map((p) => ({ ...p, user: p.user ? toUserDTO(p.user) : null })),
        messages: c.messages.map((m) => toMessageDTO(m)),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { otherUserId } = req.body;
    const userId = req.user!.id;

    if (!otherUserId) return res.status(400).json({ error: "otherUserId obbligatorio" });
    if (otherUserId === userId) return res.status(400).json({ error: "Non puoi chattare con te stesso" });

    const existing = await prisma.conversation.findFirst({
      where: { participants: { some: { userId } }, AND: { participants: { some: { userId: otherUserId } } } },
      include: {
        participants: { include: { user: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: true, replyTo: { include: { sender: true } } } },
      },
    });

    if (existing) {
      return res.json({
        ...existing,
        participants: existing.participants.map((p) => ({ ...p, user: p.user ? toUserDTO(p.user) : null })),
        messages: existing.messages.map((m) => toMessageDTO(m)),
      });
    }

    const conv = await prisma.conversation.create({
      data: { participants: { create: [{ userId }, { userId: otherUserId }] } },
      include: { participants: { include: { user: true } } },
    });

    res.status(201).json({
      ...conv,
      participants: conv.participants.map((p) => ({ ...p, user: p.user ? toUserDTO(p.user) : null })),
      messages: [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.delete("/conversations/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = req.user!.id;

    const participant = await prisma.conversationParticipant.findFirst({ where: { conversationId, userId } });
    if (!participant) return res.status(403).json({ error: "Non fai parte di questa conversazione" });

    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversationParticipant.deleteMany({ where: { conversationId } });
    await prisma.conversation.delete({ where: { id: conversationId } });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- MESSAGES (HTTP) -----------------------
app.get("/conversations/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = req.user!.id;

    const participant = await prisma.conversationParticipant.findFirst({ where: { conversationId, userId } });
    if (!participant) return res.status(403).json({ error: "Non fai parte di questa conversazione" });

    const msgs = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { sender: true, replyTo: { include: { sender: true } } },
    });

    res.json(msgs.map((m) => toMessageDTO(m)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.patch("/messages/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user!.id;
    const { content } = req.body;

    if (!content || !content.trim()) return res.status(400).json({ error: "content obbligatorio" });

    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) return res.status(404).json({ error: "Messaggio non trovato" });
    if (msg.senderId !== userId) return res.status(403).json({ error: "Non autorizzato" });
    if (msg.deletedAt) return res.status(400).json({ error: "Messaggio eliminato" });

    const updated = await prisma.message.update({
      where: { id },
      data: { content, editedAt: new Date() },
      include: { sender: true, replyTo: { include: { sender: true } } },
    });

    const dto = toMessageDTO(updated);
    io.to(`conv_${updated.conversationId}`).emit("message:update", { conversationId: updated.conversationId, message: dto });
    res.json(dto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.delete("/messages/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user!.id;

    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) return res.status(404).json({ error: "Messaggio non trovato" });
    if (msg.senderId !== userId) return res.status(403).json({ error: "Non autorizzato" });

    const updated = await prisma.message.update({
      where: { id },
      data: { deletedAt: new Date(), content: "" },
      include: { sender: true, replyTo: { include: { sender: true } } },
    });

    const dto = toMessageDTO(updated);
    io.to(`conv_${updated.conversationId}`).emit("message:delete", { conversationId: updated.conversationId, message: dto });
    res.json(dto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ----------------------- UPLOADS -----------------------
app.post("/upload/image", authMiddleware, uploadImageMulter.single("image"), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "Nessun file" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ url });
});

app.post("/upload/avatar", authMiddleware, uploadAvatarMulter.single("avatar"), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "Nessun file" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ url });
});

app.post("/upload/audio", authMiddleware, uploadAudioMulter.single("audio"), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "Nessun file" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ url });
});

// ----------------------- SOCKET -----------------------
io.on("connection", async (socket) => {
  try {
    const userId = Number((socket.handshake.auth as any)?.userId);
    if (!userId || Number.isNaN(userId)) return socket.disconnect();

    (socket as any).userId = userId;

    await prisma.user.update({ where: { id: userId }, data: { state: "DISPONIBILE", lastSeen: new Date() } });
    io.emit("user:online", { userId });

    socket.on("conversation:join", ({ conversationId }) => socket.join(`conv_${conversationId}`));

    socket.on("typing", ({ conversationId }) => {
      socket.to(`conv_${conversationId}`).emit("user:typing", { conversationId, userId });
    });

    socket.on("message:send", async ({ conversationId, content, replyToId }) => {
      if (!content || !content.trim()) return;

      let validReplyToId: number | null = null;
      if (replyToId) {
        const rt = await prisma.message.findUnique({ where: { id: Number(replyToId) } });
        if (rt && rt.conversationId === Number(conversationId)) validReplyToId = rt.id;
      }

      const msg = await prisma.message.create({
        data: { conversationId: Number(conversationId), senderId: userId, content, replyToId: validReplyToId },
        include: { sender: true, replyTo: { include: { sender: true } } },
      });

      const dto = toMessageDTO(msg);
      io.to(`conv_${conversationId}`).emit("message:new", { conversationId: Number(conversationId), message: dto });
    });

    socket.on("disconnect", async () => {
      const lastSeen = new Date();
      await prisma.user.update({ where: { id: userId }, data: { state: "OFFLINE", lastSeen } });
      io.emit("user:offline", { userId, lastSeen: lastSeen.toISOString() });
    });
  } catch (err) {
    console.error("Socket error:", err);
    socket.disconnect();
  }
});

// safe error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Internal error:", err);
  res.status(500).json({ error: "Internal server error" });
});

httpServer.listen(PORT, () => console.log(`CLASP backend listening on port ${PORT}`));
