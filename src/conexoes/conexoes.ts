import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { UnidadeId } from '../domain.js';
import { Cofre } from './cofre.js';

/** O que pode ser configurado pela tela de Conexões. */
export const CAMPOS = {
  anthropicApiKey: { segredo: true },
  trinksApiKey: { segredo: true },
  /** ID do estabelecimento no Trinks (header estabelecimentoId), por unidade. Vazio = o padrão de src/unidades.ts. */
  trinksEstabelecimentoNorte: { segredo: false },
  trinksEstabelecimentoSumare: { segredo: false },

  // ---------- Agenda: qual sistema cada unidade usa ("trinks", "avec", "appbarber" ou "nenhum"; vazio = trinks) ----------
  agendaSistemaNorte: { segredo: false },
  agendaSistemaSumare: { segredo: false },
  /** Avec: URL base da API (a documentação pública mostra só um endereço de exemplo). */
  avecUrl: { segredo: false },
  avecTokenNorte: { segredo: true },
  avecTokenSumare: { segredo: true },
  /** ID da unidade na Avec (opcional enquanto só os relatórios estão documentados). */
  avecUnidadeNorte: { segredo: false },
  avecUnidadeSumare: { segredo: false },
  /** AppBarber: URL base, token e ID da loja, quando o AppBarber liberar a integração. */
  appbarberUrl: { segredo: false },
  appbarberTokenNorte: { segredo: true },
  appbarberTokenSumare: { segredo: true },
  appbarberLojaNorte: { segredo: false },
  appbarberLojaSumare: { segredo: false },
  /** OpenAI (Whisper): transcrição dos áudios na conversa. */
  openaiApiKey: { segredo: true },
  evolutionUrl: { segredo: false },
  evolutionApiKey: { segredo: true },
  /** Gerado pela Sintonia; vai no cabeçalho do webhook das instâncias que ela cria. */
  webhookToken: { segredo: true },
  /** JSON: [{ "canalId": "sintonia-norte", "unidade": "norte" }] */
  numeros: { segredo: false },
  /** Telefones (só dígitos, separados por vírgula) que recebem o relatório do dia. */
  relatorioDestinos: { segredo: false },

  // ---------- WhatsApp: qual API cada unidade usa ("evolution" = não oficial, QR Code; "meta" = oficial) ----------
  canalNorte: { segredo: false },
  canalSumare: { segredo: false },

  // ---------- WhatsApp oficial (Cloud API da Meta), por unidade ----------
  metaPhoneNumberIdNorte: { segredo: false },
  metaWabaIdNorte: { segredo: false },
  metaTokenNorte: { segredo: true },
  metaAppSecretNorte: { segredo: true },
  /** Gerado pela Sintonia; é colado no painel da Meta junto com a URL do webhook. */
  metaVerifyTokenNorte: { segredo: false },
  metaPhoneNumberIdSumare: { segredo: false },
  metaWabaIdSumare: { segredo: false },
  metaTokenSumare: { segredo: true },
  metaAppSecretSumare: { segredo: true },
  metaVerifyTokenSumare: { segredo: false },

  // ---------- Meta Ads: API de Conversões (CAPI) e nomes dos anúncios ----------
  /** "1" = envia os eventos. */
  capiLigado: { segredo: false },
  /** Dataset ID (o antigo Pixel ID) do Gerenciador de Eventos. */
  capiDatasetId: { segredo: false },
  capiToken: { segredo: true },
  /** Código de evento de teste (Gerenciador de Eventos › Eventos de teste). Opcional. */
  capiTesteCodigo: { segredo: false },
  /** Versão da Graph API, ex.: v27.0. */
  capiVersao: { segredo: false },
  /** WABA usada nos eventos de anúncio de clique para WhatsApp (vazio = a da unidade na API oficial). */
  capiWabaId: { segredo: false },
  capiPageId: { segredo: false },
  /** Valor (R$) do Purchase quando a ficha não tem o valor do serviço. */
  capiValorPadrao: { segredo: false },
  /** JSON com o mapeamento de eventos (ver src/rastreio/capi.ts). */
  capiEventos: { segredo: false },
  /** Token com ads_read para ler os nomes de campanha/conjunto/anúncio (vazio = o token da CAPI). */
  metaAdsToken: { segredo: true },
} as const;
export type Campo = keyof typeof CAMPOS;
export type ValoresConexao = Partial<Record<Campo, string>>;

/** Unidades com WhatsApp (Feira está em obras). */
export const UNIDADES_WHATSAPP = ['norte', 'sumare'] as const;
export type UnidadeWhatsApp = (typeof UNIDADES_WHATSAPP)[number];
export type TipoCanalUnidade = 'evolution' | 'meta';

const SUFIXO: Record<UnidadeWhatsApp, 'Norte' | 'Sumare'> = { norte: 'Norte', sumare: 'Sumare' };
type ParteMeta = 'PhoneNumberId' | 'WabaId' | 'Token' | 'AppSecret' | 'VerifyToken';
/** Nome do campo da API oficial de uma unidade, ex.: campoMeta('Token', 'norte') = "metaTokenNorte". */
export const campoMeta = (parte: ParteMeta, u: UnidadeWhatsApp) => `meta${parte}${SUFIXO[u]}` as Campo;
export const campoCanal = (u: UnidadeWhatsApp) => `canal${SUFIXO[u]}` as Campo;
const ehUnidadeWhatsApp = (u: string): u is UnidadeWhatsApp => (UNIDADES_WHATSAPP as readonly string[]).includes(u);

/** Configuração da API oficial de uma unidade (só com Phone Number ID e token, o mínimo para enviar). */
export interface ContaMeta {
  unidade: UnidadeWhatsApp;
  phoneNumberId: string;
  wabaId?: string;
  token: string;
  appSecret?: string;
  verifyToken?: string;
}

export const novoVerifyToken = () => `sintonia-${randomBytes(16).toString('hex')}`;

export const NumeroConectadoCfg = z.object({ canalId: z.string().min(1), unidade: z.enum(['norte', 'sumare', 'feira']) });
export type NumeroCfg = { canalId: string; unidade: UnidadeId };

export interface ArmazemConexoes {
  lerTudo(): Promise<Record<string, string>>;
  gravar(chave: string, valor: string | null, quem: string): Promise<void>;
}

export class ArmazemMemoria implements ArmazemConexoes {
  readonly dados = new Map<string, string>();
  async lerTudo() {
    return Object.fromEntries(this.dados);
  }
  async gravar(chave: string, valor: string | null) {
    if (valor === null) this.dados.delete(chave);
    else this.dados.set(chave, valor);
  }
}

export class ArmazemPostgres implements ArmazemConexoes {
  constructor(private readonly pool: pg.Pool) {}
  async lerTudo() {
    const { rows } = await this.pool.query<{ chave: string; valor: string }>('select chave, valor from sintonia.conexoes');
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  }
  async gravar(chave: string, valor: string | null, quem: string) {
    if (valor === null) {
      await this.pool.query('delete from sintonia.conexoes where chave = $1', [chave]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.conexoes (chave, valor, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [chave, valor, quem],
    );
  }
}

/**
 * Conexões em vigor: o que foi salvo pela tela vale por cima das variáveis de ambiente.
 * Ao salvar, avisa quem precisa trocar de chave na hora (IA, Trinks, números do WhatsApp), sem reiniciar.
 */
export class Conexoes {
  private valores: ValoresConexao = {};
  private readonly ouvintes: Array<(v: ValoresConexao) => void> = [];

  constructor(
    private readonly armazem: ArmazemConexoes,
    private readonly cofre: Cofre,
    private readonly doAmbiente: ValoresConexao = {},
    private readonly log: (msg: string, extra?: unknown) => void = () => {},
  ) {}

  async carregar(): Promise<void> {
    const brutos = await this.armazem.lerTudo();
    const salvos: ValoresConexao = {};
    for (const [chave, valor] of Object.entries(brutos)) {
      if (!(chave in CAMPOS)) continue;
      try {
        salvos[chave as Campo] = this.cofre.decifrar(valor);
      } catch {
        this.log(`Conexão "${chave}" não pôde ser lida (segredo do servidor mudou?)`);
      }
    }
    this.valores = { ...limpar(this.doAmbiente), ...salvos };
    // Gerados pela Sintonia na primeira vez: token do webhook da Evolution e o Verify Token da Meta de cada unidade.
    const gerar: ValoresConexao = {};
    if (!this.valores.webhookToken) gerar.webhookToken = randomBytes(24).toString('hex');
    for (const u of UNIDADES_WHATSAPP) if (!this.valores[campoMeta('VerifyToken', u)]) gerar[campoMeta('VerifyToken', u)] = novoVerifyToken();
    if (Object.keys(gerar).length) await this.salvar(gerar, 'sistema');
    else this.avisar();
  }

  get(campo: Campo): string | undefined {
    return this.valores[campo] || undefined;
  }

  numeros(): NumeroCfg[] {
    try {
      return z.array(NumeroConectadoCfg).parse(JSON.parse(this.valores.numeros || '[]'));
    } catch {
      return [];
    }
  }

  /** Qual API a unidade usa. Sem escolha salva: a não oficial (Evolution), como antes. */
  canalDaUnidade(u: string): TipoCanalUnidade {
    if (!ehUnidadeWhatsApp(u)) return 'evolution';
    return this.valores[campoCanal(u)] === 'meta' ? 'meta' : 'evolution';
  }

  /** API oficial da unidade, se tem o mínimo para funcionar (Phone Number ID e token). */
  contaMeta(u: string): ContaMeta | undefined {
    if (!ehUnidadeWhatsApp(u)) return undefined;
    const phoneNumberId = this.get(campoMeta('PhoneNumberId', u));
    const token = this.get(campoMeta('Token', u));
    if (!phoneNumberId || !token) return undefined;
    const conta: ContaMeta = { unidade: u, phoneNumberId, token };
    const wabaId = this.get(campoMeta('WabaId', u));
    const appSecret = this.get(campoMeta('AppSecret', u));
    const verifyToken = this.get(campoMeta('VerifyToken', u));
    if (wabaId) conta.wabaId = wabaId;
    if (appSecret) conta.appSecret = appSecret;
    if (verifyToken) conta.verifyToken = verifyToken;
    return conta;
  }

  /** Verify Tokens de todas as unidades (a verificação do webhook aceita qualquer um deles). */
  verifyTokensMeta(): string[] {
    return UNIDADES_WHATSAPP.map((u) => this.get(campoMeta('VerifyToken', u))).filter((t): t is string => Boolean(t));
  }

  destinosRelatorio(): string[] {
    return (this.valores.relatorioDestinos ?? '').split(',').map((s) => s.replace(/\D/g, '')).filter((s) => s.length >= 10);
  }

  /** Grava (cifrado) e aplica. String vazia apaga o campo salvo e volta ao valor do ambiente, se houver. */
  async salvar(parcial: ValoresConexao, quem: string): Promise<void> {
    for (const [campo, valor] of Object.entries(parcial) as Array<[Campo, string | undefined]>) {
      if (!(campo in CAMPOS) || valor === undefined) continue;
      const v = valor.trim();
      await this.armazem.gravar(campo, v ? this.cofre.cifrar(v) : null, quem);
      if (v) this.valores[campo] = v;
      else if (this.doAmbiente[campo]) this.valores[campo] = this.doAmbiente[campo];
      else delete this.valores[campo];
    }
    this.avisar();
  }

  aoMudar(fn: (v: ValoresConexao) => void): void {
    this.ouvintes.push(fn);
  }

  /** Para a tela: nunca devolve o segredo, só se existe e o final dele. */
  resumo() {
    const campos = Object.fromEntries(
      (Object.keys(CAMPOS) as Campo[]).map((c) => {
        const v = this.valores[c];
        return [c, CAMPOS[c].segredo ? { definido: Boolean(v), final: v ? v.slice(-4) : null } : { definido: Boolean(v), valor: v ?? null }];
      }),
    );
    const canais = Object.fromEntries(UNIDADES_WHATSAPP.map((u) => [u, this.canalDaUnidade(u)])) as Record<UnidadeWhatsApp, TipoCanalUnidade>;
    return { campos, numeros: this.numeros(), destinosRelatorio: this.destinosRelatorio(), canais };
  }

  private avisar() {
    for (const fn of this.ouvintes) {
      try {
        fn(this.valores);
      } catch (e) {
        this.log('Falha ao aplicar conexões', String(e));
      }
    }
  }
}

function limpar(v: ValoresConexao): ValoresConexao {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' && x.trim())) as ValoresConexao;
}
