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
  for (const p of ['public', 'db', 'knowledge', 'deploy/presenca']) cpSync(path.join(raiz, p), path.join(pasta, p), { recursive: true });
  // Fotos da demonstração: o código lê ./rostos e ./clientes ao lado do arquivo do servidor (dist/app).
  for (const p of ['rostos', 'clientes']) cpSync(path.join(raiz, 'src/demo', p), path.join(pasta, 'dist/app', p), { recursive: true });
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

  // Ligação com a Evolution (WhatsApp), que roda no projeto do Espaço Rainha: o app entra na rede dela e lê a chave
  // de um arquivo no volume do Espaço Rainha (a chave nunca entra no código nem na receita). EVOLUTION_REDE= (vazio) desliga.
  // O que for salvo em Mais › Conexões (endereço e chave da Evolution) vale por cima disto.
  const REDE_EVOLUTION = process.env.EVOLUTION_REDE ?? 'rainha-saas_default';
  const VOLUME_CHAVE = process.env.EVOLUTION_VOLUME_CHAVE ?? 'rainha-saas_app';
  const comEvolution = Boolean(REDE_EVOLUTION);
  // Presença da equipe (disponível / fora do ar) agora é do próprio app (/api/presenca, tabela presencas).
  // O serviço antigo à parte (deploy/presenca) só volta com PRESENCA=1.
  const comPresenca = process.env.PRESENCA === '1';
  // Transcrição de áudio grátis no próprio servidor (faster-whisper em CPU, modelo small). WHISPER=0 desliga.
  const comWhisper = process.env.WHISPER !== '0';
  // Cópia do banco todo dia (pg_dump), um arquivo por dia da semana (sobrescreve: guarda 7 dias). COPIA=0 desliga.
  const comCopia = process.env.COPIA !== '0';
  // Monitor de queda (Uptime Kuma) em status.<raiz> e estatísticas do site (Umami) em estatisticas.<raiz>. EXTRAS=0 desliga.
  const comExtras = process.env.EXTRAS !== '0';
  const RAIZ = DOMINIO.split('.').slice(1).join('.');
  // Segredo do Umami derivado da senha do banco (estável entre publicações, nunca escrito no código).
  const segredoUmami = createHash('sha256').update(`umami:${process.env.SENHA_BANCO ?? ''}`).digest('hex');
  // SINTONIA_SEGREDO (chave das conexões salvas) fica sempre com o endereço original do banco, mesmo se o nome mudar.
  // Com o app em duas redes, "db" ficaria ambíguo (o Espaço Rainha também tem um "db"): o banco ganha o nome sintonia-db.
  const hostBanco = comEvolution ? 'sintonia-db' : 'db';
  /* sem-pagamento: WhatsApp de vendas e e-mail de suporte (páginas públicas: vendas, login, suporte, privacidade, termos).
     Vazios por padrão: sem número, os botões levam para o e-mail ou para a página /suporte. Exemplo:
       SINTONIA_WHATSAPP_VENDAS=5571999998888 SINTONIA_EMAIL_SUPORTE=contato@empresa.com node scripts/gerar-deploy.mjs */
  const whatsappVendas = (process.env.SINTONIA_WHATSAPP_VENDAS ?? '').replace(/\D/g, '');
  if (whatsappVendas && !/^\d{10,15}$/.test(whatsappVendas)) throw new Error('SINTONIA_WHATSAPP_VENDAS: use só números, com DDD (ex.: 5571999998888)');
  const emailSuporte = (process.env.SINTONIA_EMAIL_SUPORTE ?? '').trim();
  if (emailSuporte && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(emailSuporte)) throw new Error('SINTONIA_EMAIL_SUPORTE inválido');

  const receita = (`# Gerado por scripts/gerar-deploy.mjs (pacote sha256 ${soma}). Não edite à mão: gere de novo.
services:
${comEvolution ? `  chave-evolution:
    image: alpine:3.20
    restart: "no"
    user: root
    volumes:
      - rainha_app:/rainha:ro
      - chave:/chave
    command: ["sh", "-c", "if [ -f /rainha/evolution/api.key ]; then cp /rainha/evolution/api.key /chave/evolution.key && chown 1000:1000 /chave/evolution.key && chmod 400 /chave/evolution.key; else echo sem chave da Evolution no volume; rm -f /chave/evolution.key; fi"]

` : ''}  app:
    image: node:22-alpine
    restart: unless-stopped
    user: node
    # robustez: teto de memória (o servidor é dividido com n8n, Evolution, Traefik e Espaço Rainha; sem teto, um pico
    # do app podia levar o sistema a matar processos dos outros). Medido: ~150 MB parado, 350-600 MB em uso normal,
    # ~900 MB no pior pico antigo (histórico de 40 MB, agora em lotes). 1 GB de teto com o Node limitado a 640 MB de
    # objetos: ele recolhe a memória antes de chegar no teto em vez de ser morto. Se passar, o Docker reinicia só o app.
    mem_limit: 1g
    memswap_limit: 1g
    # Desligamento limpo: termina o que a IA está pensando (até 15 s) antes de sair.
    stop_grace_period: 30s
    depends_on:
      db:
        condition: service_healthy
${comEvolution ? `      chave-evolution:
        condition: service_completed_successfully
` : ''}    command: ["sh", "-c", "${iniciar}"]
    environment:
      NODE_ENV: production
      PORT: "3333"
      NODE_OPTIONS: --max-old-space-size=640
      # robustez: mensagens que chegam com o banco fora ficam aqui (volume sintonia_app) até o banco voltar.
      SINTONIA_RESERVA_DIR: /home/node/reserva
      # robustez: só o Traefik (rede interna do Docker) pode informar o endereço real do visitante.
      SINTONIA_PROXY_CONFIAVEL: "loopback,uniquelocal"
      DATABASE_URL: postgres://sintonia:${senha}@${hostBanco}:5432/sintonia
      SINTONIA_SEGREDO: postgres://sintonia:${senha}@db:5432/sintonia
${comEvolution ? `      EVOLUTION_URL: http://evolution:8080
      EVOLUTION_API_KEY_ARQUIVO: /chave/evolution.key
` : ''}${comWhisper ? `      WHISPER_URL: http://whisper:9000
` : ''}      COOKIE_SEGURO: "1"
      TZ: America/Bahia
      SINTONIA_EMPRESA_ID: imperio
      SINTONIA_URL_PUBLICA: https://${DOMINIO}
      SINTONIA_WHATSAPP_VENDAS: "${whatsappVendas}"
      SINTONIA_EMAIL_SUPORTE: "${emailSuporte}"
${process.env.ADMIN_EMAIL ? `      ADMIN_NOME: ${process.env.ADMIN_NOME ?? 'Administrador'}\n      ADMIN_EMAIL: ${process.env.ADMIN_EMAIL}\n      ADMIN_SENHA_HASH: '${String(process.env.ADMIN_SENHA_HASH).replaceAll('$', '$$$$')}'\n` : ''}${PACOTE_URL ? '' : pedacos.map((p, i) => `      PACOTE_${i + 1}: ${p}`).join('\n')}
    volumes:
      - app:/home/node
${comEvolution ? '      - chave:/chave:ro\n' : ''}    networks:
      - interna
${comEvolution ? '      - evolution\n' : ''}    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3333/saude || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=sintonia_interna"
      - "traefik.http.routers.sintonia.rule=Host(\`${DOMINIO}\`)"
      - "traefik.http.routers.sintonia.entrypoints=websecure"
      - "traefik.http.routers.sintonia.tls.certresolver=letsencrypt"
      - "traefik.http.services.sintonia.loadbalancer.server.port=3333"

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    # robustez: teto de memória do banco da Sintonia (os outros sistemas têm bancos próprios). 768 MB cobre o cache
    # (shared_buffers 128 MB, o padrão) + até 100 conexões com work_mem de 8 MB (ordenações da lista sem ir ao disco).
    mem_limit: 768m
    memswap_limit: 768m
    shm_size: 128m
    command: ["postgres", "-c", "max_connections=100", "-c", "shared_buffers=128MB", "-c", "work_mem=8MB", "-c", "maintenance_work_mem=64MB", "-c", "effective_cache_size=512MB"]
    environment:
      POSTGRES_USER: sintonia
      POSTGRES_DB: sintonia
      POSTGRES_PASSWORD: ${senha}
    volumes:
      - banco:/var/lib/postgresql/data
    networks:
      interna:
        aliases:
          - sintonia-db
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sintonia -d sintonia"]
      interval: 5s
      timeout: 3s
      retries: 20
${comPresenca ? `
  presenca:
    image: node:22-alpine
    restart: unless-stopped
    mem_limit: 128m
    depends_on:
      app:
        condition: service_healthy
    environment:
      APP_URL: http://app:3333
      ORIGEM: https://${DOMINIO}
    command: ["node", "/home/node/app/deploy/presenca/presenca.mjs"]
    volumes:
      - app:/home/node:ro
      - presenca:/dados
    networks:
      - interna
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=sintonia_interna"
      - "traefik.http.routers.sintonia-presenca.rule=Host(\`${DOMINIO}\`) && Path(\`/api/presenca\`)"
      - "traefik.http.routers.sintonia-presenca.entrypoints=websecure"
      - "traefik.http.routers.sintonia-presenca.tls.certresolver=letsencrypt"
      - "traefik.http.routers.sintonia-presenca.priority=1000"
      - "traefik.http.services.sintonia-presenca.loadbalancer.server.port=3400"
` : ''}${comWhisper ? `
  whisper:
    image: onerahmet/openai-whisper-asr-webservice:v1.10.0
    restart: unless-stopped
    mem_limit: 2g
    cpus: 1.5
    environment:
      ASR_ENGINE: faster_whisper
      ASR_MODEL: small
      ASR_DEVICE: cpu
      ASR_QUANTIZATION: int8
      ASR_MODEL_PATH: /modelos
    volumes:
      - whisper:/modelos
    networks:
      - interna
` : ''}${comCopia ? `
  copia:
    image: postgres:16-alpine
    restart: unless-stopped
    mem_limit: 256m
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGPASSWORD: ${senha}
    # banco-seguranca: a cópia só substitui a anterior se abrir (pg_restore -l confere que o arquivo abre); além das 7
    # diárias, guarda uma por semana do mês (aos domingos: semana-0 a semana-4), ou seja, cerca de 1 mês para trás.
    command: ["sh", "-c", "while true; do d=$$(date +%u-%a); if pg_dump -h db -U sintonia -d sintonia -Fc -f /copias/tmp.dump && pg_restore -l /copias/tmp.dump > /dev/null; then mv /copias/tmp.dump /copias/sintonia-$$d.dump && echo copia ok $$d; if [ $$(date +%u) = 7 ]; then cp /copias/sintonia-$$d.dump /copias/semana-$$(( ($$(date +%e) - 1) / 7 )).dump; fi; else echo COPIA FALHOU; fi; sleep 86400; done"]
    volumes:
      - copias:/copias
    networks:
      - interna
` : ''}${comExtras ? `
  umami-banco:
    image: postgres:16-alpine
    restart: "no"
    depends_on:
      db:
        condition: service_healthy
    environment:
      PGPASSWORD: ${senha}
    command: ["sh", "-c", "psql -h db -U sintonia -d sintonia -tc \\"select 1 from pg_database where datname='umami'\\" | grep -q 1 || psql -h db -U sintonia -d sintonia -c 'create database umami'"]
    networks:
      - interna

  umami:
    image: umamisoftware/umami:3.4.1
    restart: unless-stopped
    mem_limit: 512m
    depends_on:
      umami-banco:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: postgresql://sintonia:${senha}@db:5432/umami
      APP_SECRET: ${segredoUmami}
    networks:
      - interna
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=sintonia_interna"
      - "traefik.http.routers.sintonia-umami.rule=Host(\`estatisticas.${RAIZ}\`)"
      - "traefik.http.routers.sintonia-umami.entrypoints=websecure"
      - "traefik.http.routers.sintonia-umami.tls.certresolver=letsencrypt"
      - "traefik.http.services.sintonia-umami.loadbalancer.server.port=3000"

  status:
    image: louislam/uptime-kuma:2.2.0-slim
    restart: unless-stopped
    mem_limit: 384m
    volumes:
      - status:/app/data
    networks:
      - interna
      - evolution
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=sintonia_interna"
      - "traefik.http.routers.sintonia-status.rule=Host(\`status.${RAIZ}\`)"
      - "traefik.http.routers.sintonia-status.entrypoints=websecure"
      - "traefik.http.routers.sintonia-status.tls.certresolver=letsencrypt"
      - "traefik.http.services.sintonia-status.loadbalancer.server.port=3001"
` : ''}
volumes:
  banco:
    name: sintonia_banco
  app:
    name: sintonia_app
${comEvolution ? `  chave:
    name: sintonia_chave_evolution
  rainha_app:
    external: true
    name: ${VOLUME_CHAVE}
` : ''}${comPresenca ? `  presenca:
    name: sintonia_presenca
` : ''}${comWhisper ? `  whisper:
    name: sintonia_whisper
` : ''}${comCopia ? `  copias:
    name: sintonia_copias
` : ''}${comExtras ? `  status:
    name: sintonia_status
` : ''}
networks:
  interna:
    name: sintonia_interna
${comEvolution ? `  evolution:
    external: true
    name: ${REDE_EVOLUTION}
` : ''}`);
  conferirReceita(receita);
  // A Hostinger recusa receitas com mais de 8192 letras: os comentários ficam só aqui no gerador (a 1ª linha, com o
  // sha256 do pacote, continua). Sem comentários dentro de textos de várias linhas (comandos) que precisem do "#".
  const enxuta = receita.split('\n').filter((l, i) => i === 0 || !/^\s*#/.test(l)).join('\n');
  if (enxuta.length > 8192) throw new Error(`Receita com ${enxuta.length} letras: a Hostinger aceita até 8192. Encurte o gerador.`);
  process.stdout.write(enxuta);
} finally {
  rmSync(pasta, { recursive: true, force: true });
}

/**
 * banco-seguranca: trava de segurança da receita. Nenhum serviço da Sintonia publica porta no servidor (o banco
 * nunca fica aberto para a internet; o app só é alcançado pelo Traefik, pela rede interna). Se alguém acrescentar
 * "ports:" ou a rede do servidor aqui, a receita não é gerada.
 */
function conferirReceita(texto) {
  if (/^\s+ports\s*:/m.test(texto)) throw new Error('A receita não pode publicar portas (ports:). Use o Traefik pela rede interna.');
  if (/network_mode\s*:\s*["']?host/m.test(texto)) throw new Error('A receita não pode usar a rede do servidor (network_mode: host).');
  if (/5432\s*:\s*5432|0\.0\.0\.0:5432/.test(texto)) throw new Error('O banco não pode ficar aberto fora da rede interna.');
}
