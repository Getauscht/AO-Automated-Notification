FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json schema.sql ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
ENV NODE_ENV=production DB_PATH=/data/vagas.sqlite PORT=3000
EXPOSE 3000
CMD ["node", "src/server.mjs"]
