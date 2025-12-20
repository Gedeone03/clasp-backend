import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
const SALT_ROUNDS = 10;

/**
 * CORS:
 * - in produzione metti l'origine Netlify/Vercel (es: https://claspme.com)
 * - in dev lasciamo localhost
 */
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const defaultAllowed = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://claspme.com",
  "https://www.claspme.com",
]);

for (const o of allowedOrigins) defaultAllowed.add(o);

app.use(
  cors({
    origin: (origin, cb) => {
      // origin può essere undefined su curl/postman
      if (!origin) return cb(null, true);
      if (defaultAllowed.has(origin)) return cb(null, true);
      return cb(new Error(`CORS: Origin non consentita: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "3mb" }));

/** ---- Static uploads (se li usi già per avatar/file) ---- */
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

/** ---- Utils ---- */
function safeUser(u: any) {
  if (!u) return null;
  // NON esporre passwordHash
  const { passwordHash, ...rest } = u;
  return rest;
}

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

function getAuthToken(req: Request): string | null {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

type AuthedRequest = Request & { userId?: number };

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = getAuthToken(req);
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

/** ---- Healthcheck ---- */
app.get("/health", (_req, res) => res.json({ ok: true }));

/** ---- AUTH ---- */
app.post("/auth/register", async (req, res) => {
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

    // se nel tuo schema esiste termsAccepted, lo usiamo.
    // Se NON esiste, Prisma lancerà errore: in quel caso dimmelo e lo adatto al tuo schema.
    if (termsAccepted !== true) {
      return res.status(400).json({ error: "Devi accettare i Termini e le Condizioni" });
    }

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
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
        // valori compatibili con i tuoi enum-stringhe attuali
        state: "OFFLINE",
        statusText: null,
        interests: null,
        lastSeen: new Date(),
        termsAccepted: true,
      } as any,
    });

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (e: any) {
    console.error("REGISTER_ERR", e);
    return res.status(500).json({ error: "Errore registrazione" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body || {};
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "Campi mancanti" });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
    });

    if (!user) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = await bcrypt.compare(password, (user as any).passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    // aggiorna lastSeen
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeen: new Date() } as any,
      });
    } catch {
      // non bloccare il login se lastSeen non esiste nello schema
    }

    const token = signToken(user.id);
    return res.json({ token, user: safeUser(user) });
  } catch (e: any) {
    console.error("LOGIN_ERR", e);
    return res.status(500).json({ error: "Errore login" });
  }
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!me) return res.status(404).json({ error: "Utente non trovato" });
    return res.json(safeUser(me));
  } catch (e: any) {
    console.error("ME_ERR", e);
    return res.status(500).json({ error: "Errore /me" });
  }
});

/** ---- FRIENDS ----
 * Serve per risolvere subito:
 *  - 404 su /friends/requests
 */
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
      .map(safeUser);

    return res.json(friends);
  } catch (e: any) {
    console.error("FRIENDS_ERR", e);
    return res.status(500).json({ error: "Errore caricamento amici" });
  }
});

/**
 * ✅ QUESTA È LA ROTTA CHE TI MANCAVA (404):
 * GET /friends/requests
 * ritorna richieste ricevute (pending)
 */
app.get("/friends/requests", requireAuth, async (req: AuthedRequest, res) => {
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
  } catch (e: any) {
    console.error("FRIEND_REQ_IN_ERR", e);
    return res.status(500).json({ error: "Errore caricamento richieste" });
  }
});

/** richieste inviate (utile per UI) */
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
  } catch (e: any) {
    console.error("FRIEND_REQ_SENT_ERR", e);
    return res.status(500).json({ error: "Errore caricamento richieste inviate" });
  }
});

/** invia richiesta amicizia */
app.post("/friends/requests", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const { userId } = req.body || {};
    const otherId = Number(userId);

    if (!otherId || Number.isNaN(otherId)) return res.status(400).json({ error: "userId non valido" });
    if (otherId === myId) return res.status(400).json({ error: "Non puoi aggiungere te stesso" });

    // già amici?
    const existingFriend = await prisma.friend.findFirst({
      where: {
        OR: [
          { userAId: myId, userBId: otherId },
          { userAId: otherId, userBId: myId },
        ],
      },
    } as any);
    if (existingFriend) return res.status(409).json({ error: "Siete già amici" });

    // già richiesta pending?
    const existingReq = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: myId, receiverId: otherId },
          { senderId: otherId, receiverId: myId },
        ],
      },
    } as any);
    if (existingReq) return res.status(409).json({ error: "Richiesta già presente" });

    const created = await prisma.friendRequest.create({
      data: { senderId: myId, receiverId: otherId },
    } as any);

    return res.json({ ok: true, request: created });
  } catch (e: any) {
    console.error("FRIEND_REQ_CREATE_ERR", e);
    return res.status(500).json({ error: "Errore invio richiesta" });
  }
});

/** accetta richiesta */
app.post("/friends/requests/:id/accept", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const myId = req.userId!;
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: "id non valido" });

    const fr = await prisma.friendRequest.findUnique({ where: { id } } as any);
    if (!fr) return res.status(404).json({ error: "Richiesta non trovata" });
    if ((fr as any).receiverId !== myId) return res.status(403).json({ error: "Non autorizzato" });

    const senderId = Number((fr as any).senderId);

    // crea amicizia (ordinando per evitare duplicati logici)
    const a = Math.min(senderId, myId);
    const b = Math.max(senderId, myId);

    // se già esiste per qualche motivo, non fallire
    const already = await prisma.friend.findFirst({
      where: { OR: [{ userAId: a, userBId: b }, { userAId: b, userBId: a }] },
    } as any);

    if (!already) {
      await prisma.friend.create({
        data: { userAId: a, userBId: b },
      } as any);
    }

    await prisma.friendRequest.delete({ where: { id } } as any);

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("FRIEND_REQ_ACCEPT_ERR", e);
    return res.status(500).json({ error: "Errore accettazione richiesta" });
  }
});

/** rifiuta richiesta */
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
  } catch (e: any) {
    console.error("FRIEND_REQ_DECLINE_ERR", e);
    return res.status(500).json({ error: "Errore rifiuto richiesta" });
  }
});

/** ---- Error handler ---- */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("UNHANDLED_ERR", err);
  return res.status(500).json({ error: "Errore server" });
});

app.listen(PORT, () => {
  console.log(`Server HTTP in ascolto su http://localhost:${PORT}`);
});
