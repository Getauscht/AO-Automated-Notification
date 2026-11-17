FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
RUN mkdir -p /data/auth && chown -R node:node /data
USER node
ENV NODE_ENV=production AUTH_DIR=/data/auth PORT=3001
EXPOSE 3001
CMD ["node", "server.mjs"]
