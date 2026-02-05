FROM node:18-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:18-alpine AS runner

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p logs uploads

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "src/server.js"]
