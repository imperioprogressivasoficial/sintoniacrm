#!/usr/bin/env node
/**
 * Gera o docker-compose da Sintonia para o VPS (Hostinger, Docker + Traefik).
 *
 *   node scripts/gerar-deploy.mjs > /tmp/sintonia-compose.yaml
 *
 * O código vai compactado dentro da própria receita (dockerfile_inline): o servidor monta a
 * imagem sozinho, sem precisar de acesso ao GitHub nem de terminal. Senhas e chaves NÃO entram
 * aqui: vão nas variáveis do projeto (POSTGRES_SENHA, ADMIN_*, ANTHROPIC_API_KEY...).
 *
 * Isolamento: projeto próprio, banco próprio com volume próprio, rede interna própria e nenhuma
 * porta publicada no servidor. O Traefik (rede do host) chega no app pelas etiquetas.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOMINIO = process.env.DOMINIO ?? 'sintonia.n8nimperio.tech';
const itens = ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'public', 'db', 'knowledge'];

const pacote = execFileSync('tar', ['--sort=name', '--mtime=2026-01-01', '--owner=0', '--group=0', '-czf', '-', ...itens], {
  cwd: raiz,
  maxBuffer: 64 * 1024 * 1024,
}).toString('base64');

const dockerfile = [
  'FROM node:22-alpine',
  'WORKDIR /app',
  `RUN echo ${pacote} | base64 -d | tar -xz`,
  'RUN npm ci --no-audit --no-fund && npm cache clean --force',
  'ENV NODE_ENV=production PORT=3333',
  'EXPOSE 3333',
  'USER node',
  'HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3333/saude || exit 1',
  'CMD ["node", "--import", "tsx", "src/index.ts"]',
];

const recuo = (txt, n) => txt.split('\n').map((l) => ' '.repeat(n) + l).join('\n');

const compose = `# Gerado por scripts/gerar-deploy.mjs. Não edite à mão: gere de novo.
services:
  app:
    build:
      context: .
      dockerfile_inline: |
${recuo(dockerfile.join('\n'), 8)}
    image: sintonia-app:local
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://sintonia:\${POSTGRES_SENHA:?defina POSTGRES_SENHA}@db:5432/sintonia
      COOKIE_SEGURO: "1"
      TZ: America/Bahia
      SINTONIA_EMPRESA_ID: \${SINTONIA_EMPRESA_ID:-imperio}
      ADMIN_NOME: \${ADMIN_NOME:-}
      ADMIN_EMAIL: \${ADMIN_EMAIL:-}
      ADMIN_SENHA: \${ADMIN_SENHA:-}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      TRINKS_API_KEY: \${TRINKS_API_KEY:-}
      EVOLUTION_URL: \${EVOLUTION_URL:-}
      EVOLUTION_API_KEY: \${EVOLUTION_API_KEY:-}
      EVOLUTION_WEBHOOK_TOKEN: \${EVOLUTION_WEBHOOK_TOKEN:-}
      SINTONIA_NUMEROS: \${SINTONIA_NUMEROS:-[]}
      RELATORIO_DESTINOS: \${RELATORIO_DESTINOS:-}
    networks:
      - interna
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.sintonia.rule=Host(\`${DOMINIO}\`)"
      - "traefik.http.routers.sintonia.entrypoints=websecure"
      - "traefik.http.routers.sintonia.tls.certresolver=letsencrypt"
      - "traefik.http.services.sintonia.loadbalancer.server.port=3333"

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: sintonia
      POSTGRES_DB: sintonia
      POSTGRES_PASSWORD: \${POSTGRES_SENHA:?defina POSTGRES_SENHA}
    volumes:
      - banco:/var/lib/postgresql/data
    networks:
      - interna
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sintonia -d sintonia"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  banco:
    name: sintonia_banco

networks:
  interna:
    name: sintonia_interna
`;

process.stdout.write(compose);
