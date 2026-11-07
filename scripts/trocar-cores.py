#!/usr/bin/env python3
"""Leva qualquer paleta antiga (azul #106EBE + menta, ou Sky Blue + Hot Pink) para a final: Midnight Navy #002941, Soft Blue #B6DFED, Coral Orange #FD6E6E.
Uso: python3 scripts/trocar-cores.py [arquivos...]  (sem argumentos: public/, docs/ESTILO-VIDRO.md). Pode rodar de novo sem estragar."""
import re, sys, pathlib
TROCAS = [
  # azul da marca -> Sky Blue
  (r'#106ebe\b', '#0593C6'), (r'#1a8be0\b', '#23ABDD'), (r'#0a4c86\b', '#04709A'), (r'#0e63ab\b', '#0583B0'),
  (r'rgba\(\s*16,\s*110,\s*190,', 'rgba(5, 147, 198,'), (r'rgba\(\s*26,\s*139,\s*224,', 'rgba(35, 171, 221,'), (r'rgba\(\s*10,\s*76,\s*134,', 'rgba(4, 112, 154,'),
  # menta -> Hot Pink
  (r'#0ffcbe\b', '#D83995'), (r'#b8ffeb\b', '#F7C6E0'), (r'rgba\(\s*15,\s*252,\s*190,', 'rgba(216, 57, 149,'),
  (r'#effff9\b', '#FDEEF6'), (r'#dffcf4\b', '#FDEEF6'), (r'#087a5c\b', '#B02A78'), (r'#078a6a\b', '#B02A78'), (r'#0a8f7a\b', '#B02A78'), (r'#0b3a3f\b', '#3A1430'),
  # paleta final (Midnight Navy #002941, Soft Blue #B6DFED, Coral Orange #FD6E6E)
  (r'#0593C6\b', '#002941'), (r'#23ABDD\b', '#0A4A6E'), (r'#04709A\b', '#001A2B'), (r'#0583B0\b', '#00324F'),
  (r'rgba\(\s*5,\s*147,\s*198,', 'rgba(0, 41, 65,'), (r'rgba\(\s*35,\s*171,\s*221,', 'rgba(182, 223, 237,'), (r'rgba\(\s*4,\s*112,\s*154,', 'rgba(0, 50, 79,'),
  (r'#D83995\b', '#FD6E6E'), (r'#F7C6E0\b', '#FFD6D6'), (r'rgba\(\s*216,\s*57,\s*149,', 'rgba(253, 110, 110,'),
  (r'#FDEEF6\b', '#FFEDED'), (r'#B02A78\b', '#C94545'), (r'#3A1430\b', '#3A1F2A'), (r'#FCFFFF\b', '#FBFDFE'),
  # azuis-noite antigos -> família do Midnight Navy
  (r'#071d33\b', '#001A2B'), (r'#08243f\b', '#002941'), (r'#0b2a47\b', '#00253B'), (r'#04121f\b', '#00121F'), (r'#04172b\b', '#00121F'), (r'#05172a\b', '#00121F'),
  (r'#0d3050\b', '#00324F'), (r'#0b1f33\b', '#001A2B'), (r'#eef4fb\b', '#F3F9FC'), (r'#06263f\b', '#002941'),
  (r'rgba\(\s*8,\s*36,\s*63,', 'rgba(0, 41, 65,'), (r'rgba\(\s*7,\s*29,\s*51,', 'rgba(0, 26, 43,'), (r'rgba\(\s*4,\s*22,\s*44,', 'rgba(0, 18, 31,'), (r'rgba\(\s*4,\s*18,\s*31,', 'rgba(0, 18, 31,'),
  # nomes nos textos do guia
  (r'menta #0FFCBE', 'coral #FD6E6E'), (r'rosa #D83995', 'coral #FD6E6E'),
]
def trocar(txt):
  for a, b in TROCAS: txt = re.sub(a, b, txt, flags=re.I)
  return txt
alvos = sys.argv[1:] or [str(p) for p in pathlib.Path('public').rglob('*') if p.suffix in ('.html', '.css', '.js', '.webmanifest', '.svg')] + ['docs/ESTILO-VIDRO.md']
for f in alvos:
  p = pathlib.Path(f); t = p.read_text(); n = trocar(t)
  if n != t: p.write_text(n); print('trocado:', f)
