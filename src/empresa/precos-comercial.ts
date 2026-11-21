import { normalizar, type ConfigComercial } from '../comercial/calculo.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { ErroDuplicado, type ArmazemCadastro } from './cadastro.js';

/**
 * O Comercial (e quem usa a tabela de preços dele: Desempenho, Análises, Plano, Central de criativos)
 * passa a ler os preços de Empresa › Produtos e serviços. Produto ativo com preço vale; um preço antigo
 * que ainda não virou produto continua valendo (nada se perde). Quando a tela do Comercial salva,
 * preço novo vira serviço no cadastro e preço mudado muda o produto; só o que não é produto fica na
 * configuração antiga.
 */
export function precosDoCadastro(base: ArmazemComercial, cadastro: ArmazemCadastro): ArmazemComercial {
  const doCadastro = async (empresaId: string) =>
    (await cadastro.produtos(empresaId).catch(() => [])).filter((p) => p.ativo && p.preco !== null).map((p) => ({ servico: p.nome, valor: p.preco! }));

  return {
    async ler(empresaId) {
      const r = await base.ler(empresaId);
      const novos = await doCadastro(empresaId);
      const nomes = new Set(novos.map((p) => normalizar(p.servico)));
      return { ...r, cfg: { ...r.cfg, precos: [...novos, ...r.cfg.precos.filter((p) => !nomes.has(normalizar(p.servico)))] } };
    },
    async salvar(empresaId, cfg: ConfigComercial, por) {
      const produtos = await cadastro.produtos(empresaId).catch(() => []);
      const porNome = new Map(produtos.map((p) => [normalizar(p.nome), p]));
      const resto: ConfigComercial['precos'] = [];
      for (const preco of cfg.precos) {
        const p = porNome.get(normalizar(preco.servico));
        if (p) {
          if (p.preco !== preco.valor) await cadastro.alterarProduto(empresaId, p.id, { preco: preco.valor }, por);
          continue;
        }
        const nome = preco.servico.trim().slice(0, 80);
        if (nome.length < 2) {
          resto.push(preco);
          continue;
        }
        await cadastro
          .criarProduto(empresaId, { nome, tipo: 'servico', categoria: null, preco: preco.valor, duracaoMin: null, descricao: '', codigo: '', ativo: true, origem: 'comercial' }, por)
          .catch((e) => {
            if (e instanceof ErroDuplicado) return;
            resto.push(preco);
          });
      }
      await base.salvar(empresaId, { ...cfg, precos: resto }, por);
    },
    definirToken: (empresaId, token, em) => base.definirToken(empresaId, token, em),
    empresaDoToken: (token) => base.empresaDoToken(token),
  };
}
