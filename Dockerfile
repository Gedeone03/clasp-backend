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

CMD sh -c "npx prisma db execute --schema prisma/schema.prisma --file prisma_repair.sql || true; npx prisma migrate deploy; node dist/server.js"




