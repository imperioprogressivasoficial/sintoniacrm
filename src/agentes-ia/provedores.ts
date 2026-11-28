import type Anthropic from '@anthropic-ai/sdk';
import type { ClienteClaude } from '../ai/agente.js';

/**
 * Provedores dos agentes. O laço do agente fala no formato da API da Anthropic; a OpenAI entra por um
 * adaptador que traduz o pedido (Chat Completions com funções) e devolve a resposta no mesmo formato.
 */

type Pedido = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Bloco = Anthropic.Beta.Messages.BetaContentBlockParam;

export class SemChave extends Error {
  readonly statusCode = 412;
  readonly codigo = 'sem_chave';
  constructor(provedor: string) {
    super(provedor === 'openai' ? 'Configure a chave da OpenAI (no agente ou em Conexões) para usar este agente.' : 'Configure a chave da IA (no agente ou em Conexões) para usar este agente.');
  }
}

export function clienteOpenAI(chave: string, f: typeof fetch = fetch): ClienteClaude {
  const create = async (p: Pedido) => {
    const system = Array.isArray(p.system) ? p.system.map((s) => s.text).join('\n\n') : (p.system ?? '');
    const msgs: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
    for (const m of p.messages) {
      if (typeof m.content === 'string') {
        msgs.push({ role: m.role, content: m.content });
        continue;
      }
      const blocos = m.content as Bloco[];
      if (m.role === 'assistant') {
        const texto = blocos.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
        const chamadas = blocos
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const u = b as { id: string; name: string; input: unknown };
            return { id: u.id, type: 'function', function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) } };
          });
        msgs.push({ role: 'assistant', content: texto || null, ...(chamadas.length ? { tool_calls: chamadas } : {}) });
      } else {
        for (const b of blocos) {
          if (b.type === 'tool_result') {
            const r = b as { tool_use_id: string; content?: unknown };
            msgs.push({ role: 'tool', tool_call_id: r.tool_use_id, content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '') });
          } else if (b.type === 'text') msgs.push({ role: 'user', content: (b as { text: string }).text });
        }
      }
    }
    const tools = (p.tools ?? []).map((t) => {
      const x = t as { name: string; description?: string; input_schema: unknown };
      return { type: 'function', function: { name: x.name, description: x.description ?? '', parameters: x.input_schema } };
    });
    const corpo: Record<string, unknown> = { model: p.model, messages: msgs, ...(tools.length ? { tools } : {}) };
    const temp = (p as { temperature?: number }).temperature;
    if (typeof temp === 'number') corpo.temperature = temp;
    const r = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'Chave recusada pela OpenAI' : `OpenAI respondeu ${r.status}`);
    const j = (await r.json()) as { choices: Array<{ finish_reason: string; message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const esc = j.choices[0]!;
    const content: unknown[] = [];
    if (esc.message.content) content.push({ type: 'text', text: esc.message.content });
    for (const c of esc.message.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(c.function.arguments || '{}');
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    return { stop_reason: esc.message.tool_calls?.length ? 'tool_use' : 'end_turn', content };
  };
  return { beta: { messages: { create: create as never } } };
}
