import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

interface JwtPayload {
  userId: number;
}

export interface AuthRequest extends Request {
  user?: {
    id: number;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token mancante o malformato' });

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = { id: payload.userId };
    return next();
  } catch {
    return res.status(401).json({ error: 'Token non valido' });
  }
}
