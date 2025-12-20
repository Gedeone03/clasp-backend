import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { Server as IOServer } from "socket.io";

const prisma = new PrismaClient();

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const SALT_ROUNDS = 10;

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const defaultAllowed = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://claspme.com",
  "https://www.claspme.com",
]);

for (const o of allowedOrigins) defaultAllowed.add(o);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (defaultAllowed.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "5mb" }));

/** ---------- AUTH ---------- */
type AuthedRequest = express.Request & { userId?: number };

function getBearer(req: express.Request): string | null {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
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

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password, username, displayName, termsAccepted } = req.body || {};
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
        state: "OFFLINE",
        lastSeen: new Date(),
        termsAccepted: true,
      } as any,
    });

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error("REGISTER_ERR", e);
    return res.status(500).json({ error: "Errore registrazione" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) return res.status(400).json({ error: "Campi mancanti" });

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
    });

    if (!user) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(password, (user as any).passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    await prisma.user.update({ where: { id: user.id }, data: { lastSeen: new Date() } as any }).catch(() => {});

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (e) {
    console.error("LOGIN_ERR", e);
    return res.status(500).json({ error: "Errore login" });
  }
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!me) return res.status(404).json({ error: "Utente non trovato" });
  return res.json(safeUser(me));
});

/** ---------- FRIENDS + REQUESTS ---------- */
app.get("/friends", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const rows = await prisma.friend.findMany({
    where: { OR: [{ userAId: myId }, { userBId: myId }] },
    include: { userA: true, userB: true },
  } as any);

  const friends = rows.map((f: any) => (f.userAId === myId ? f.userB : f.userA)).map(safeUser);
  return res.json(friends);
});

// ✅ endpoints che il frontend usa
app.get("/friends/requests/received", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const requests = await prisma.friendRequest.findMany({
    where: { receiverId: myId },
    orderBy: { createdAt: "desc" },
    include: { sender: true },
  } as any);

  return res.json(
    requests.map((r: any) => ({
      id: r.id,
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

  return res.json(
    requests.map((r: any) => ({
      id: r.id,
      receiver: safeUser(r.receiver),
    }))
  );
});

app.post("/friends/request/:id", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const otherId = Number(req.params.id);
  if (!otherId || Number.isNaN(otherId)) return res.status(400).json({ error: "id non valido" });
  if (otherId === myId) return res.status(400).json({ error: "Non puoi aggiungere te stesso" });

  const exists = await prisma.friendRequest.findFirst({
    where: { senderId: myId, receiverId: otherId },
  } as any);

  if (exists) return res.status(409).json({ error: "Richiesta già inviata" });

  await prisma.friendRequest.create({ data: { senderId: myId, receiverId: otherId } } as any);
  return res.json({ ok: true });
});

app.post("/friends/accept/:id", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const requestId = Number(req.params.id);

  const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } } as any);
  if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
  if ((fr as any).receiverId !== myId) return res.status(403).json({ error: "Non autorizzato" });

  const senderId = Number((fr as any).senderId);

  const existsFriend = await prisma.friend.findFirst({
    where: {
      OR: [
        { userAId: myId, userBId: senderId },
        { userAId: senderId, userBId: myId },
      ],
    },
  } as any);

  if (!existsFriend) {
    await prisma.friend.create({ data: { userAId: myId, userBId: senderId } } as any);
  }

  await prisma.friendRequest.delete({ where: { id: requestId } } as any);
  return res.json({ ok: true });
});

app.post("/friends/decline/:id", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const requestId = Number(req.params.id);

  const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } } as any);
  if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
  if ((fr as any).receiverId !== myId) return res.status(403).json({ error: "Non autorizzato" });

  await prisma.friendRequest.delete({ where: { id: requestId } } as any);
  return res.json({ ok: true });
});

/** ---------- CONVERSATIONS + MESSAGES ---------- */
app.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;

  const convs = await prisma.conversation.findMany({
    where: { participants: { some: { userId: myId } } },
    include: {
      participants: { include: { user: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: true } },
    },
    orderBy: { id: "desc" },
  } as any);

  return res.json(
    convs.map((c: any) => ({
      ...c,
      participants: c.participants.map((p: any) => ({ ...p, user: safeUser(p.user) })),
      messages: c.messages.map((m: any) => ({ ...m, sender: safeUser(m.sender) })),
    }))
  );
});

app.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const conversationId = Number(req.params.id);

  const membership = await prisma.conversationParticipant.findFirst({
    where: { conversationId, userId: myId },
  } as any);

  if (!membership) return res.status(403).json({ error: "Non autorizzato" });

  const msgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { sender: true },
  } as any);

  return res.json(msgs.map((m: any) => ({ ...m, sender: safeUser(m.sender) })));
});

app.post("/conversations/direct", requireAuth, async (req: AuthedRequest, res) => {
  const myId = req.userId!;
  const { otherUserId } = req.body || {};
  const otherId = Number(otherUserId);
  if (!otherId || Number.isNaN(otherId)) return res.status(400).json({ error: "otherUserId non valido" });

  // cerca conversazione esistente
  const existing = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: myId } } },
        { participants: { some: { userId: otherId } } },
      ],
    },
    include: { participants: { include: { user: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, include: { sender: true } } },
  } as any);

  if (existing) return res.json(existing);

  const conv = await prisma.conversation.create({
    data: {
      participants: {
        create: [{ userId: myId }, { userId: otherId }],
      },
    },
    include: { participants: { include: { user: true } } },
  } as any);

  return res.json(conv);
});

/** ---------- SOCKET.IO ---------- */
const io = new IOServer(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (defaultAllowed.has(origin)) return cb(null, true);
      return cb(new Error("CORS socket blocked"));
    },
    credentials: true,
  },
});

io.on("connection", (socket) => {
  socket.on("conversation:join", ({ conversationId }: any) => {
    if (conversationId) socket.join(`conv_${conversationId}`);
  });

  socket.on("typing", ({ conversationId, userId }: any) => {
    if (conversationId) socket.to(`conv_${conversationId}`).emit("user:typing", { conversationId, userId });
  });

  socket.on("message:send", async ({ conversationId, content, replyToId, userId }: any) => {
    try {
      if (!conversationId || !content) return;

      const msg = await prisma.message.create({
        data: {
          conversationId: Number(conversationId),
          senderId: Number(userId),
          content: String(content),
          replyToId: replyToId ? Number(replyToId) : null,
        } as any,
        include: { sender: true },
      } as any);

      io.to(`conv_${conversationId}`).emit("message:new", {
        conversationId: Number(conversationId),
        message: { ...msg, sender: safeUser(msg.sender) },
      });
    } catch (e) {
      console.error("SOCKET_SEND_ERR", e);
    }
  });
});

/** ---------- START ---------- */
server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
