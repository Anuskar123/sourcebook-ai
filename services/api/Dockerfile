FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY services/api/package.json services/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=@portfolio/api
COPY services/api services/api
USER node
EXPOSE 3000
CMD ["node", "services/api/server.js"]
