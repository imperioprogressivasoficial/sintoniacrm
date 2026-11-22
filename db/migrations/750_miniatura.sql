-- velocidade: miniatura que o próprio WhatsApp manda junto da foto/vídeo (jpegThumbnail, JPEG de 1–9 KB em base64),
-- mostrada desfocada no balão enquanto a foto de verdade baixa; e largura/altura, para a caixa nascer do tamanho certo.
-- Aditiva: só colunas novas, que podem ficar vazias (mídias antigas e da API oficial seguem como antes).
set local search_path to sintonia;

alter table midias add column if not exists miniatura text;
alter table midias add column if not exists largura integer;
alter table midias add column if not exists altura integer;
