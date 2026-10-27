# Single-container build for hosts other than Render (Railway, Fly.io, a VM, …).
#   docker build -t tripsync .
#   docker run -p 4000:4000 --env-file .env -e NODE_ENV=production tripsync

FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
USER node
EXPOSE 4000
CMD ["node", "server.js"]
