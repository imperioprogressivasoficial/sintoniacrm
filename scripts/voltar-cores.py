#!/usr/bin/env python3
"""Volta para a paleta original da Sintonia (azul #106EBE, menta #0FFCBE, azul-noite) qualquer cor das paletas de teste
(Sky Blue/Hot Pink ou Navy/Soft Blue/Coral). Uso: python3 scripts/voltar-cores.py [arquivos...] (sem argumentos: public/)."""
import re, sys, pathlib
T = [
  ('#FD6E6E', '#0FFCBE'), ('#D83995', '#0FFCBE'), ('#FFD6D6', '#b8ffeb'), ('#F7C6E0', '#b8ffeb'), ('#FFEDED', '#effff9'), ('#FDEEF6', '#effff9'),
  ('#C94545', '#087a5c'), ('#B02A78', '#087a5c'), ('#3A1F2A', '#0b3a3f'), ('#3A1430', '#0b3a3f'),
  ('#0593C6', '#106ebe'), ('#23ABDD', '#1a8be0'), ('#04709A', '#0a4c86'), ('#0583B0', '#0e63ab'),
  ('#002941', '#106ebe'), ('#0A4A6E', '#1a8be0'), ('#3D8DB3', '#1a8be0'), ('#001A2B', '#071d33'), ('#00253B', '#0b2a47'), ('#00121F', '#04121f'),
  ('#00324F', '#0d3050'), ('#0A3D5C', '#143a5e'), ('#B6DFED', '#7cc4ff'), ('#F3F9FC', '#eef4fb'), ('#FBFDFE', '#ffffff'), ('#FCFFFF', '#ffffff'),
  ('#D3E6EE', '#dbe6f1'), ('#4F6B7D', '#5a6b7d'), ('#F2F9FC', '#f4f8fc'), ('#EAF4F8', '#eef3f8'), ('#E8F4F9', '#edf4fb'), ('#D9EEF6', '#e3effa'), ('#D3EBF4', '#d9ecfb'),
]
R = [
  (r'rgba\(\s*253,\s*110,\s*110,', 'rgba(15, 252, 190,'), (r'rgba\(\s*216,\s*57,\s*149,', 'rgba(15, 252, 190,'),
  (r'rgba\(\s*0,\s*41,\s*65,', 'rgba(16, 110, 190,'), (r'rgba\(\s*5,\s*147,\s*198,', 'rgba(16, 110, 190,'),
  (r'rgba\(\s*182,\s*223,\s*237,', 'rgba(124, 196, 255,'), (r'rgba\(\s*35,\s*171,\s*221,', 'rgba(26, 139, 224,'),
  (r'rgba\(\s*0,\s*50,\s*79,', 'rgba(10, 76, 134,'), (r'rgba\(\s*4,\s*112,\s*154,', 'rgba(10, 76, 134,'),
  (r'rgba\(\s*0,\s*26,\s*43,', 'rgba(7, 29, 51,'), (r'rgba\(\s*0,\s*18,\s*31,', 'rgba(4, 18, 31,'),
]
alvos = sys.argv[1:] or [str(p) for p in pathlib.Path('public').rglob('*') if p.suffix in ('.html', '.css', '.js', '.webmanifest', '.svg')]
for f in alvos:
  p = pathlib.Path(f); t = p.read_text(); n = t
  for a, b in T: n = re.sub(re.escape(a) + r'\b', b, n, flags=re.I)
  for a, b in R: n = re.sub(a, b, n)
  if n != t: p.write_text(n); print('voltou:', f)
