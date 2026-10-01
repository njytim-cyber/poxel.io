# Game server only (the website is served by Cloudflare). Node runs the TypeScript directly.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/node.ts"]
