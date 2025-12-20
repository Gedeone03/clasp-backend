import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const SALT_ROUNDS = 10;

const defaultOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://claspme.com",
  "https://www.claspme.com",
];

const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultOrigins, ...extraOrigins]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "3mb" }));

// ✅ Socket.IO (così sparisce anche websocket 404)
const io = new Server(server, {
  cors: {
    origin: Array.from(allowedOrigins),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

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

function safeUser(u: any) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// AUTH
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, username, displayName, city = null, area = null, termsAccepted } = req.body || {};
    if (!email || !password || !username || !displayName) return res.status(400).json({ error: "Campi mancanti" });
    if (termsAccepted !== true) return res.status(400).json({ error: "Devi accettare i Termini e le Condizioni" });

    const exists = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
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
    });

    const token = signToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error("REGISTER_ERR", e);
    res.status(500).json({ error: "Errore registrazione" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) return res.status(400).json({ error: "Campi mancanti" });

    const user = await prisma.user.findFirst({ where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] } });
    if (!user) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(password, (user as any).passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    try { await prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } as any }); } catch {}

    const token = signToken(user.id);
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error("LOGIN_ERR", e);
    res.status(500).json({ error: "Errore login" });
  }
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(404).json({ error: "Utente non trovato" });
  res.json(safeUser(me));
});

// FRIENDS
app.get("/friends", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const rows = await prisma.friend.findMany({
    where: { OR: [{ userAId: myId }, { userBId: myId }] },
    include: { userA: true, userB: true },
  } as any);

  const friends = rows.map((f: any) => (f.userAId === myId ? f.userB : f.userA)).filter(Boolean).map(safeUser);
  res.json(friends);
});

app.get("/friends/requests/received", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const requests = await prisma.friendRequest.findMany({
    where: { receiverId: myId },
    orderBy: { createdAt: "desc" },
    include: { sender: true },
  } as any);

  res.json(
    requests.map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      senderId: r.senderId,
      receiverId: r.receiverId,
      sender: safeUser(r.sender),
    }))
  );
});

app.get("/friends/requests/sent", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const requests = await prisma.friendRequest.findMany({
    where: { senderId: myId },
    orderBy: { createdAt: "desc" },
    include: { receiver: true },
  } as any);

  res.json(
    requests.map((r: any) => ({
      id: r.id,
      createdAt: r.createdAt,
      senderId: r.senderId,
      receiverId: r.receiverId,
      receiver: safeUser(r.receiver),
    }))
  );
});

// CONVERSATIONS
app.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const convs = await prisma.conversation.findMany({
    where: { participants: { some: { userId: myId } } },
    include: {
      participants: { include: { user: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: true } }, // ✅ include sender
    },
    orderBy: { id: "desc" },
  } as any);

  res.json(
    convs.map((c: any) => ({
      ...c,
      participants: c.participants.map((p: any) => ({ ...p, user: safeUser(p.user) })),
      messages: (c.messages || []).map((m: any) => ({
        ...m,
        sender: safeUser((m as any).sender), // ✅ cast per TS
      })),
    }))
  );
});

app.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const conversationId = Number(req.params.id);

  const part = await prisma.conversationParticipant.findFirst({
    where: { conversationId, userId: myId },
  } as any);
  if (!part) return res.status(403).json({ error: "Non autorizzato" });

  const msgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { sender: true }, // ✅ include sender
  } as any);

  res.json(
    msgs.map((m: any) => ({
      ...m,
      sender: safeUser((m as any).sender), // ✅ cast per TS
    }))
  );
});

// SOCKET: join + typing + send (minimo)
io.on("connection", (socket) => {
  socket.on("conversation:join", ({ conversationId }: any) => {
    if (!conversationId) return;
    socket.join(`conv_${conversationId}`);
  });

  socket.on("typing", ({ conversationId, userId }: any) => {
    if (!conversationId) return;
    socket.to(`conv_${conversationId}`).emit("user:typing", { conversationId, userId });
  });

  socket.on("message:send", async ({ conversationId, senderId, content }: any) => {
    try {
      if (!conversationId || !senderId || !content) return;
      const msg = await prisma.message.create({
        data: { conversationId: Number(conversationId), senderId: Number(senderId), content: String(content) } as any,
      });
      io.to(`conv_${conversationId}`).emit("message:new", { conversationId: Number(conversationId), message: msg });
    } catch (e) {
      console.error("SOCKET_SEND_ERR", e);
    }
  });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("UNHANDLED_ERR", err);
  res.status(500).json({ error: "Errore server" });
});

server.listen(PORT, () => {
  console.log(`Backend online su :${PORT}`);
});
