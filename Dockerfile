# Agent Office num contentor. A interface fica só em http://127.0.0.1:8787 (ver docker-compose.yml).
FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci

COPY . .
RUN npm run build

# Os agentes são processos `claude -p`: o Claude Code tem de existir dentro do contentor.
RUN npm install -g @anthropic-ai/claude-code

# Dados e sessão do Claude Code ficam em volumes, fora da imagem, e nada corre como root.
RUN mkdir -p /data /home/node/.claude && chown -R node:node /data /home/node/.claude /app/server
USER node

ENV AGENT_OFFICE_BIND=0.0.0.0
ENV AGENT_OFFICE_DB=/data/office.db
ENV AGENT_OFFICE_WORKSPACES=/data/workspaces

EXPOSE 8787
CMD ["node", "server/src/index.ts"]
