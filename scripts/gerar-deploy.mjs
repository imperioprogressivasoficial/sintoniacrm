#!/usr/bin/env node
/**
 * Gera o docker-compose da Sintonia para o VPS (Hostinger, Docker + Traefik).
 *
 *   node scripts/gerar-deploy.mjs > sintonia-compose.yaml
 *
 * O código vai dentro da própria receita (dockerfile_inline), em pedaços, com a soma SHA-256
 * conferida antes de montar: o servidor monta a imagem sem acesso ao GitHub e, se o pacote chegar
 * diferente, a montagem para (nada é instalado). Senhas e chaves NÃO entram aqui: vão nas variáveis
 * do projeto (POSTGRES_SENHA, ADMIN_*, ANTHROPIC_API_KEY...).
 *
 * Pacote: o servidor em um arquivo só (esbuild, minificado), páginas, migrações, base de conhecimento
 * e um package.json só com as dependências de execução, nas versões exatas do package-lock.
 *
 * Isolamento: projeto próprio, banco próprio com volume próprio, rede interna própria e nenhuma
 * porta publicada no servidor. O Traefik (rede do host) chega no app pelas etiquetas.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOMINIO = process.env.DOMINIO ?? 'sintonia.n8nimperio.tech';
const PEDACO = 6000;

// ---- monta o pacote numa pasta temporária
const pasta = mkdtempSync(path.join(tmpdir(), 'sintonia-deploy-'));
try {
  // O servidor fica em dist/app/ para que os caminhos relativos (../../public etc.) apontem para a raiz.
  mkdirSync(path.join(pasta, 'dist/app'), { recursive: true });
  execFileSync(
    'npx',
    ['--yes', 'esbuild@0.25.0', 'src/index.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--minify', '--legal-comments=none', `--outfile=${path.join(pasta, 'dist/app/sintonia.mjs')}`, '--log-level=warning'],
    { cwd: raiz, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  for (const p of ['public', 'db', 'knowledge']) cpSync(path.join(raiz, p), path.join(pasta, p), { recursive: true });
  const pkg = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(raiz, 'package-lock.json'), 'utf8'));
  const deps = Object.fromEntries(Object.keys(pkg.dependencies).map((n) => [n, lock.packages[`node_modules/${n}`].version]));
  writeFileSync(path.join(pasta, 'package.json'), JSON.stringify({ name: 'sintonia', private: true, type: 'module', dependencies: deps }));

  const tar = execFileSync('tar', ['--sort=name', '--mtime=2026-01-01', '--owner=0', '--group=0', '-cf', '-', '.'], { cwd: pasta, maxBuffer: 64 << 20 });
  const xz = execFileSync('xz', ['-9e', '-c'], { input: tar, maxBuffer: 64 << 20 });
  const soma = createHash('sha256').update(xz).digest('hex');
  const b64 = xz.toString('base64');
  const pedacos = b64.match(new RegExp(`.{1,${PEDACO}}`, 'g'));

  const dockerfile = [
    'FROM node:22-alpine',
    'RUN apk add --no-cache xz',
    'WORKDIR /app',
    ...pedacos.map((p) => `RUN printf '%s' '${p}' >> /tmp/pacote.b64`),
    `RUN base64 -d /tmp/pacote.b64 > /tmp/pacote.txz && echo '${soma}  /tmp/pacote.txz' | sha256sum -c - && xz -dc /tmp/pacote.txz | tar -x && rm /tmp/pacote.*`,
    'RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force',
    'ENV NODE_ENV=production PORT=3333',
    'EXPOSE 3333',
    'USER node',
    'HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3333/saude || exit 1',
    'CMD ["node", "dist/app/sintonia.mjs"]',
  ];

  const recuo = (txt, n) => txt.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
  // Dentro do compose, "$" vira "$$" (o compose interpreta variáveis); o Dockerfile não usa "$".
  if (dockerfile.some((l) => l.includes('$'))) throw new Error('O Dockerfile não pode ter "$"');

  process.stdout.write(`# Gerado por scripts/gerar-deploy.mjs (pacote sha256 ${soma}). Não edite à mão: gere de novo.
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
`);
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
