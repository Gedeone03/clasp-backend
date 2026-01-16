FROM node:20-bullseye-slim

WORKDIR /app

# Dipendenze di sistema utili a Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build && npx prisma generate

EXPOSE 4000

CMD ["sh","-c","set -e; MIG=$(ls -1 prisma/migrations 2>/dev/null | grep -v migration_lock | head -n 1 || true); echo \"[boot] migration=$MIG\"; if [ -n \"$MIG\" ]; then echo \"[prisma] baseline $MIG\"; npx prisma migrate resolve --applied \"$MIG\" || true; fi; echo \"[prisma] migrate deploy\"; npx prisma migrate deploy; echo \"[node] start\"; node dist/server.js"]



