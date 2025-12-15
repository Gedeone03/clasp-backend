FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run build && npx prisma generate

EXPOSE 4000

CMD sh -c "npx prisma db push && node dist/server.js"
