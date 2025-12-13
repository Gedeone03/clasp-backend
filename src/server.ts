// src/server.ts

import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import multer from "multer";
import { Server } from "socket.io";

import { prisma } from "./prisma";
import { authMiddleware, AuthRequest } from "./middleware/auth";

dotenv.config();

// --------------------------------------------------------
// SETUP EXPRESS + HTTP + SOCKET.IO
// --------------------------------------------------------
const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const SALT_ROUNDS = 10;

const VALID_STATES = [
  "DISPONIBILE",
  "OCCUPATO",
  "ASSENTE",
  "OFFLINE",
  "INVISIBILE",
  "VISIBILE_A_TUTTI",
];

const VALID_INTERESTS = [
  "LAVORO",
  "AMICIZIA",
  "CHATTARE",
  "DATING",
  "INCONTRI",
];

// --------------------------------------------------------
// HELPER
// --------------------------------------------------------
function parseInterests(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((x) => x.trim()).filter(Boolean);
}

function serializeInterests(arr: string[]): string | null {
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
    lastSeen: user.lastSeen
      ? new Date(user.lastSeen).toISOString?.() ?? user.lastSeen
      : null,
  };
}

// --------------------------------------------------------
// STATIC PER /uploads
// --------------------------------------------------------
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"))
);

// --------------------------------------------------------
// MULTER PER UPLOAD (immagini / avatar / audio)
// --------------------------------------------------------
const baseStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, "..", "uploads"));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "_" + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  },
});

// immagini chat
const uploadImageMulter = multer({
  storage: baseStorage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo immagini permesse"));
    }
    cb(null, true);
  },
});

// avatar profilo
const uploadAvatarMulter = multer({
  storage: baseStorage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo immagini permesse"));
    }
    cb(null, true);
  },
});

// audio
const uploadAudioMulter = multer({
  storage: baseStorage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Solo file audio permessi"));
    }
    cb(null, true);
  },
});

// --------------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------------
app.get("/ping", (_req, res) => res.json({ message: "pong" }));

// --------------------------------------------------------
// AUTH
// --------------------------------------------------------
app.post("/auth/register", async (req, res) => {
  try {
    const {
      email,
      password,
      displayName,
      username,
      city,
      area,
      termsAccepted,
    } = req.body;

    if (!email || !password || !displayName || !username) {
      return res.status(400).json({
        error: "email, password, displayName e username sono obbligatori",
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        error: "Devi accettare i Termini e le Condizioni d'uso.",
      });
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "Esiste già un utente con questa email o username" });
    }

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

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      user: toUserDTO(user),
    });
  } catch (err) {
    console.error("Errore in /auth/register", err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({
        error: "emailOrUsername e password sono obbligatori",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: emailOrUsername },
          { username: emailOrUsername },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Credenziali non valide" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Credenziali non valide" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      user: toUserDTO(user),
    });
  } catch (err) {
    console.error("Errore in /auth/login", err);
    res.status(500).json({ error: "Errore server" });
  }
});

// --------------------------------------------------------
// PROFILO / ME
// --------------------------------------------------------
app.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) return res.status(404).json({ error: "Utente non trovato" });

    res.json(toUserDTO(user));
  } catch (err) {
    console.error("Errore in GET /me", err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.put("/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const {
      displayName,
      statusText,
      state,
      city,
      area,
      interests,
      avatarUrl,
      mood,
    } = req.body;

    const data: any = {};

    if (displayName !== undefined) data.displayName = displayName;
    if (statusText !== undefined) data.statusText = statusText;
    if (city !== undefined) data.city = city;
    if (area !== undefined) data.area = area;
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;
    if (mood !== undefined) data.mood = mood; 
    if (state !== undefined) {
      if (!VALID_STATES.includes(state)) {
        return res.status(400).json({
          error: `state non valido. Valori ammessi: ${VALID_STATES.join(", ")}`,
        });
      }
      data.state = state;
    }

    if (interests !== undefined) {
      if (!Array.isArray(interests)) {
        return res
          .status(400)
          .json({ error: "interests deve essere un array di stringhe" });
      }
      const errMsg = validateInterests(interests);
      if (errMsg) return res.status(400).json({ error: errMsg });

      data.interests = serializeInterests(interests);
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data,
    });

    res.json(toUserDTO(updated));
  } catch (err) {
    console.error("Errore in PUT /me", err);
    res.status(500).json({ error: "Errore server" });
  }
});

// --------------------------------------------------------
// RICERCA UTENTI
// --------------------------------------------------------
app.get("/users", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const visibleOnly = req.query.visibleOnly === "true";
    const mood = typeof req.query.mood === "string" ? req.query.mood.trim() : "";  // 👈 AGGIUNTO

    const where: any = {};

    if (q) {
      where.OR = [
        { username: { contains: q } },
        { displayName: { contains: q } },
        { email: { contains: q } },
      ];
    }

    if (visibleOnly) {
      where.state = "VISIBILE_A_TUTTI";
    }

    if (mood) {                     // 👈 AGGIUNTO
      where.mood = mood;
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: 50,
    });

    res.json(users.map(toUserDTO));
  } catch (err) {
    console.error("Errore in GET /users", err);
    res.status(500).json({ error: "Errore server" });
  }
});

// --------------------------------------------------------
// SISTEMA AMICI
// --------------------------------------------------------
app.post(
  "/friends/request/:id",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const receiverId = Number(req.params.id);
      const senderId = req.user!.id;

      if (receiverId === senderId) {
        return res.status(400).json({ error: "Non puoi aggiungere te stesso" });
      }

      const existing = await prisma.friendRequest.findFirst({
        where: { senderId, receiverId, status: "PENDING" },
      });

      if (existing) {
        return res.status(400).json({ error: "Richiesta già inviata" });
      }

      await prisma.friendRequest.create({
        data: {
          senderId,
          receiverId,
          status: "PENDING",
        },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Errore in POST /friends/request/:id", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.post(
  "/friends/accept/:id",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const requestId = Number(req.params.id);
      const userId = req.user!.id;

      const fr = await prisma.friendRequest.findUnique({
        where: { id: requestId },
      });

      if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
      if (fr.receiverId !== userId) {
        return res.status(403).json({ error: "Non autorizzato" });
      }

      await prisma.friend.create({
        data: {
          userAId: fr.senderId,
          userBId: fr.receiverId,
        },
      });

      await prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: "ACCEPTED" },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Errore in POST /friends/accept/:id", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.post(
  "/friends/decline/:id",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const requestId = Number(req.params.id);
      const userId = req.user!.id;

      const fr = await prisma.friendRequest.findUnique({
        where: { id: requestId },
      });

      if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
      if (fr.receiverId !== userId) {
        return res.status(403).json({ error: "Non autorizzato" });
      }

      await prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: "DECLINED" },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Errore in POST /friends/decline/:id", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.get("/friends", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const friends = await prisma.friend.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: {
        userA: true,
        userB: true,
      },
    });

    const list = friends.map((f) => {
      const other = f.userAId === userId ? f.userB : f.userA;
      return toUserDTO(other);
    });

    res.json(list);
  } catch (err) {
    console.error("Errore in GET /friends", err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.get(
  "/friends/requests/received",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;

      const reqs = await prisma.friendRequest.findMany({
        where: { receiverId: userId, status: "PENDING" },
        include: { sender: true },
      });

      res.json(
        reqs.map((r) => ({
          id: r.id,
          sender: toUserDTO(r.sender),
        }))
      );
    } catch (err) {
      console.error("Errore in GET /friends/requests/received", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.get(
  "/friends/requests/sent",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;

      const reqs = await prisma.friendRequest.findMany({
        where: { senderId: userId, status: "PENDING" },
        include: { receiver: true },
      });

      res.json(
        reqs.map((r) => ({
          id: r.id,
          receiver: toUserDTO(r.receiver),
        }))
      );
    } catch (err) {
      console.error("Errore in GET /friends/requests/sent", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

// --------------------------------------------------------
// CHAT - CONVERSAZIONI
// --------------------------------------------------------
app.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const convs = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      include: {
        participants: { include: { user: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    res.json(
      convs.map((c) => ({
        ...c,
        participants: c.participants.map((p) => ({
          ...p,
          user: p.user ? toUserDTO(p.user) : null,
        })),
      }))
    );
  } catch (err) {
    console.error("Errore in GET /conversations", err);
    res.status(500).json({ error: "Errore server" });
  }
});

app.post(
  "/conversations",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const { otherUserId } = req.body;
      const userId = req.user!.id;

      if (!otherUserId) {
        return res.status(400).json({ error: "otherUserId obbligatorio" });
      }

      if (otherUserId === userId) {
        return res
          .status(400)
          .json({ error: "Non puoi chattare con te stesso" });
      }

      const existing = await prisma.conversation.findFirst({
        where: {
          participants: { some: { userId } },
          AND: { participants: { some: { userId: otherUserId } } },
        },
        include: {
          participants: { include: { user: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      if (existing) {
        return res.json({
          ...existing,
          participants: existing.participants.map((p) => ({
            ...p,
            user: p.user ? toUserDTO(p.user) : null,
          })),
        });
      }

      const conv = await prisma.conversation.create({
        data: {
          participants: {
            create: [{ userId }, { userId: otherUserId }],
          },
        },
        include: {
          participants: { include: { user: true } },
          messages: true,
        },
      });

      res.status(201).json({
        ...conv,
        participants: conv.participants.map((p) => ({
          ...p,
          user: p.user ? toUserDTO(p.user) : null,
        })),
      });
    } catch (err) {
      console.error("Errore in POST /conversations", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

// ELIMINA CONVERSAZIONE
app.delete(
  "/conversations/:id",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const conversationId = Number(req.params.id);
      const userId = req.user!.id;

      const participant = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId },
      });

      if (!participant) {
        return res
          .status(403)
          .json({ error: "Non fai parte di questa conversazione" });
      }

      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversationParticipant.deleteMany({
        where: { conversationId },
      });
      await prisma.conversation.delete({ where: { id: conversationId } });

      res.json({ ok: true });
    } catch (err) {
      console.error("Errore in DELETE /conversations/:id", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

// MESSAGGI (HTTP)
app.get(
  "/conversations/:id/messages",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const conversationId = Number(req.params.id);
      const userId = req.user!.id;

      const participant = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId },
      });

      if (!participant) {
        return res
          .status(403)
          .json({ error: "Non fai parte di questa conversazione" });
      }

      const msgs = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        include: { sender: true },
      });

      res.json(
        msgs.map((m) => ({
          ...m,
          sender: m.sender ? toUserDTO(m.sender) : null,
        }))
      );
    } catch (err) {
      console.error("Errore in GET /conversations/:id/messages", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.post(
  "/conversations/:id/messages",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const conversationId = Number(req.params.id);
      const userId = req.user!.id;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "content obbligatorio" });
      }

      const participant = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId },
      });

      if (!participant) {
        return res
          .status(403)
          .json({ error: "Non fai parte di questa conversazione" });
      }

      const msg = await prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          content,
        },
        include: { sender: true },
      });

      res.status(201).json({
        ...msg,
        sender: msg.sender ? toUserDTO(msg.sender) : null,
      });
    } catch (err) {
      console.error("Errore in POST /conversations/:id/messages", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

// --------------------------------------------------------
// UPLOAD IMAGE / AVATAR / AUDIO
// --------------------------------------------------------
app.post(
  "/upload/image",
  authMiddleware,
  uploadImageMulter.single("image"),
  (req: AuthRequest & { file?: Express.Multer.File }, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nessun file fornito" });
      }
      const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
      res.json({ url: fileUrl });
    } catch (err) {
      console.error("Errore upload immagine", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.post(
  "/upload/avatar",
  authMiddleware,
  uploadAvatarMulter.single("avatar"),
  (req: AuthRequest & { file?: Express.Multer.File }, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nessun file avatar fornito" });
      }
      const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
      res.json({ url: fileUrl });
    } catch (err) {
      console.error("Errore upload avatar", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

app.post(
  "/upload/audio",
  authMiddleware,
  uploadAudioMulter.single("audio"),
  (req: AuthRequest & { file?: Express.Multer.File }, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nessun file audio fornito" });
      }
      const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
      res.json({ url: fileUrl });
    } catch (err) {
      console.error("Errore upload audio", err);
      res.status(500).json({ error: "Errore server" });
    }
  }
);

// --------------------------------------------------------
// SOCKET.IO
// --------------------------------------------------------
io.on("connection", async (socket) => {
  try {
    const userId = Number(socket.handshake.auth.userId);
    if (!userId || Number.isNaN(userId)) {
      socket.disconnect();
      return;
    }

    (socket as any).userId = userId;

    await prisma.user.update({
      where: { id: userId },
      data: { state: "DISPONIBILE", lastSeen: new Date() },
    });

    io.emit("user:online", { userId });

    socket.on("conversation:join", ({ conversationId }) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on("message:send", async ({ conversationId, content }) => {
      if (!content || !content.trim()) return;

      const msg = await prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          content,
        },
        include: { sender: true },
      });

      io.to(`conv_${conversationId}`).emit("message:new", {
        conversationId,
        message: {
          id: msg.id,
          senderId: msg.senderId,
          content: msg.content,
          createdAt: msg.createdAt.toISOString(),
          sender: toUserDTO(msg.sender),
        },
      });
    });

    socket.on("typing", ({ conversationId }) => {
      socket.to(`conv_${conversationId}`).emit("user:typing", {
        conversationId,
        userId,
      });
    });

    socket.on("disconnect", async () => {
      const lastSeen = new Date();
      await prisma.user.update({
        where: { id: userId },
        data: {
          state: "OFFLINE",
          lastSeen,
        },
      });

      io.emit("user:offline", {
        userId,
        lastSeen: lastSeen.toISOString(),
      });
    });
  } catch (err) {
    console.error("Errore in socket connection", err);
    socket.disconnect();
  }
});

// --------------------------------------------------------
// AVVIO SERVER
// --------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(
    `Server realtime + friends + upload attivo su http://localhost:${PORT}`
  );
});
