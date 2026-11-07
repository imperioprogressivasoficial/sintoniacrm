-- Fotos, áudios, vídeos, documentos e figurinhas das conversas.
-- Uma linha por mensagem com mídia: os dados (tipo, nome, duração...) e o arquivo, guardado aqui mesmo.
-- A própria tabela é a fila de download: "pendente" com próxima tentativa; o texto da mensagem nunca espera por ela.
set local search_path to sintonia;

create table midias (
  mensagem_id        uuid primary key references mensagens(id) on delete cascade,
  tipo               text not null check (tipo in ('imagem', 'audio', 'video', 'documento', 'figurinha')),
  mimetype           text,
  nome_arquivo       text,
  duracao_seg        integer,
  legenda            text,
  tamanho            bigint,
  voz                boolean not null default false,
  situacao           text not null default 'pendente' check (situacao in ('pendente', 'pronta', 'grande', 'falhou')),
  conteudo           bytea,                       -- até 16 MB; acima disso fica nulo e a situação é "grande"
  tentativas         integer not null default 0,
  proxima_tentativa  timestamptz not null default '-infinity', -- nova: baixa já
  erro               text,
  criada_em          timestamptz not null default now()
);
create index midias_pendentes on midias (proxima_tentativa) where situacao = 'pendente';
