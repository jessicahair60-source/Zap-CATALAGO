FROM node:22-slim
WORKDIR /app
# Ferramentas para compilar o better-sqlite3 caso não exista binário pronto para esta versão do Node
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
