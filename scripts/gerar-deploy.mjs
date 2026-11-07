#!/usr/bin/env node
/**
 * Gera o docker-compose da Sintonia para o VPS (Hostinger, Docker + Traefik).
 *
 *   SENHA_BANCO=<hex> node scripts/gerar-deploy.mjs > sintonia-compose.yaml
 *
 * O código vai dentro da própria receita (variáveis PACOTE_1..N do serviço), com a soma SHA-256
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

  const tar = execFileSync('tar', ['--sort=name', '--mtime=2026-01-01', '--owner=0', '--group=0', '-czf', '-', '.'], { cwd: pasta, maxBuffer: 64 << 20 });
  const soma = createHash('sha256').update(tar).digest('hex');
  const b64 = tar.toString('base64');
  // Cada variável de ambiente tem limite (128 KB no Linux): o pacote vai em pedaços de 60 KB.
  const pedacos = b64.match(/.{1,60000}/g);
  // Pacote grande demais para variáveis de ambiente (limite do Linux ~2 MB no total): com PACOTE_URL o container
  // baixa o pacote (base64) desse endereço na primeira subida; a soma SHA-256 continua sendo conferida.
  const PACOTE_URL = process.env.PACOTE_URL;
  if (PACOTE_URL && !/^https:\/\/[\w.\/-]+$/.test(PACOTE_URL)) throw new Error('PACOTE_URL inválida');
  if (process.env.PACOTE_ARQUIVO) writeFileSync(process.env.PACOTE_ARQUIVO, b64);

  // Sem "build": o gerenciador de Docker da Hostinger só sobe imagens prontas. O pacote vai numa
  // variável do próprio serviço; ao iniciar, o container confere a soma, extrai e instala.
  // A senha do banco é fixada aqui (SENHA_BANCO) porque o painel não repassa variáveis do projeto.
  const senha = process.env.SENHA_BANCO;
  if (!senha || !/^[a-f0-9]{32,}$/.test(senha)) throw new Error('Defina SENHA_BANCO (hex, 32+ caracteres)');
  // Instala uma vez só, num volume fixo (sintonia_app, montado em /home/node). Ao reiniciar, se a marca
  // da versão existe, sobe direto do disco, sem depender da internet. Versão nova: refaz a pasta.
  const marca = `app/.versao-${soma}`;
  const instalar = [
    'rm -rf app', 'mkdir app', 'cd app',
    PACOTE_URL
      ? `wget -qO- '${PACOTE_URL}' | tr -d '\\n' | base64 -d > /tmp/pacote.tgz`
      : `{ ${pedacos.map((_, i) => `printenv PACOTE_${i + 1};`).join(' ')} } | tr -d '\\n' | base64 -d > /tmp/pacote.tgz`,
    `echo '${soma}  /tmp/pacote.tgz' | sha256sum -c -`,
    'tar -xzf /tmp/pacote.tgz', 'rm /tmp/pacote.tgz',
    'npm install --omit=dev --no-audit --no-fund',
    `touch .versao-${soma}`,
  ].join(' && ');
  const iniciar = `cd /home/node && { [ -f ${marca} ] || { ${instalar}; }; } && cd /home/node/app && exec node dist/app/sintonia.mjs`;
  if (iniciar.includes('$') || iniciar.includes('"')) throw new Error('comando não pode ter $ ou aspas duplas');

  process.stdout.write(`# Gerado por scripts/gerar-deploy.mjs (pacote sha256 ${soma}). Não edite à mão: gere de novo.
services:
  app:
    image: node:22-alpine
    restart: unless-stopped
    user: node
    depends_on:
      db:
        condition: service_healthy
    command: ["sh", "-c", "${iniciar}"]
    environment:
      NODE_ENV: production
      PORT: "3333"
      DATABASE_URL: postgres://sintonia:${senha}@db:5432/sintonia
      COOKIE_SEGURO: "1"
      TZ: America/Bahia
      SINTONIA_EMPRESA_ID: imperio
${process.env.ADMIN_EMAIL ? `      ADMIN_NOME: ${process.env.ADMIN_NOME ?? 'Administrador'}\n      ADMIN_EMAIL: ${process.env.ADMIN_EMAIL}\n      ADMIN_SENHA_HASH: '${String(process.env.ADMIN_SENHA_HASH).replaceAll('$', '$$$$')}'\n` : ''}${PACOTE_URL ? '' : pedacos.map((p, i) => `      PACOTE_${i + 1}: ${p}`).join('\n')}
    volumes:
      - app:/home/node
    networks:
      - interna
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3333/saude || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s
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
      POSTGRES_PASSWORD: ${senha}
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
  app:
    name: sintonia_app

networks:
  interna:
    name: sintonia_interna
`);
} finally {
  rmSync(pasta, { recursive: true, force: true });
}
