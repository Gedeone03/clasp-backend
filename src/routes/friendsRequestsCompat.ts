import type { Express, Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";

type AuthMw = (req: Request, res: Response, next: NextFunction) => void;

function getAuthUserId(req: any): number | null {
  const raw =
    req.userId ??
    req.user?.id ??
    req.user?.userId ??
    req.auth?.userId ??
    req.auth?.id ??
    null;

  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function userSelect() {
  return {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    state: true,
    mood: true,
    city: true,
    area: true,
  } as const;
}

export function mountFriendsRequestsCompat(app: Express, prisma: PrismaClient, authMiddleware: AuthMw) {
  async function handler(req: Request, res: Response) {
    const userId = getAuthUserId(req as any);
    if (!userId) return res.status(401).json({ message: "Non autorizzato." });

    const incoming = await (prisma as any).friendRequest.findMany({
      where: { receiverId: userId },
      include: { sender: { select: userSelect() } },
      orderBy: { createdAt: "desc" },
    });

    const outgoing = await (prisma as any).friendRequest.findMany({
      where: { senderId: userId },
      include: { receiver: { select: userSelect() } },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ incoming, outgoing });
  }

  app.get("/friends/requests", authMiddleware, (req, res) => {
    handler(req, res).catch((e: any) => {
      console.error("GET /friends/requests error:", e);
      res.status(500).json({ message: "Errore caricamento richieste amicizia." });
    });
  });

  app.get("/friend-requests", authMiddleware, (req, res) => {
    handler(req, res).catch((e: any) => {
      console.error("GET /friend-requests error:", e);
      res.status(500).json({ message: "Errore caricamento richieste amicizia." });
    });
  });
}
