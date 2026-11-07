#!/usr/bin/env python3
"""Troca a paleta antiga (azul #106EBE + menta #0FFCBE) pela nova (Sky Blue #0593C6, Hot Pink #D83995, Polar White #FCFFFF).
Uso: python3 scripts/trocar-cores.py [arquivos...]  (sem argumentos: public/, docs/ESTILO-VIDRO.md). Pode rodar de novo sem estragar."""
import re, sys, pathlib
TROCAS = [
  # azul da marca -> Sky Blue
  (r'#106ebe\b', '#0593C6'), (r'#1a8be0\b', '#23ABDD'), (r'#0a4c86\b', '#04709A'), (r'#0e63ab\b', '#0583B0'),
  (r'rgba\(\s*16,\s*110,\s*190,', 'rgba(5, 147, 198,'), (r'rgba\(\s*26,\s*139,\s*224,', 'rgba(35, 171, 221,'), (r'rgba\(\s*10,\s*76,\s*134,', 'rgba(4, 112, 154,'),
  # menta -> Hot Pink
  (r'#0ffcbe\b', '#D83995'), (r'#b8ffeb\b', '#F7C6E0'), (r'rgba\(\s*15,\s*252,\s*190,', 'rgba(216, 57, 149,'),
  (r'#effff9\b', '#FDEEF6'), (r'#dffcf4\b', '#FDEEF6'), (r'#087a5c\b', '#B02A78'), (r'#078a6a\b', '#B02A78'), (r'#0a8f7a\b', '#B02A78'), (r'#0b3a3f\b', '#3A1430'),
  # nomes nos textos do guia
  (r'menta #0FFCBE', 'rosa #D83995'),
]
def trocar(txt):
  for a, b in TROCAS: txt = re.sub(a, b, txt, flags=re.I)
  return txt
alvos = sys.argv[1:] or [str(p) for p in pathlib.Path('public').rglob('*') if p.suffix in ('.html', '.css', '.js', '.webmanifest', '.svg')] + ['docs/ESTILO-VIDRO.md']
for f in alvos:
  p = pathlib.Path(f); t = p.read_text(); n = trocar(t)
  if n != t: p.write_text(n); print('trocado:', f)
