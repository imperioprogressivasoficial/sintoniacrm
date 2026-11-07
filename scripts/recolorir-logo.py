#!/usr/bin/env python3
"""Recolore a logo da Sintonia (degradê azul -> menta) para a paleta final:
Midnight Navy #002941 -> Coral #FD6E6E (versão clara) e Soft Blue #B6DFED -> Coral (versão para fundo escuro).
Uso: python3 scripts/recolorir-logo.py ORIGEM DESTINO [claro|escuro]"""
import sys, colorsys
from PIL import Image
def hx(c): return tuple(int(c[i:i+2], 16) for i in (1, 3, 5))
RAMPAS = {
  'claro': [(0.0, hx('#002941')), (0.45, hx('#0A4A6E')), (1.0, hx('#FD6E6E'))],
  'escuro': [(0.0, hx('#6FA9C2')), (0.45, hx('#B6DFED')), (1.0, hx('#FD6E6E'))],
}
def rampa(r, p):
  for (a, ca), (b, cb) in zip(r, r[1:]):
    if p <= b:
      k = (p - a) / (b - a) if b > a else 0
      return tuple(round(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
  return r[-1][1]
def cor(px, r):
  R, G, B, A = px
  if A == 0: return px
  h, s, v = colorsys.rgb_to_hsv(R / 255, G / 255, B / 255)
  if s < 0.18: return px  # branco/cinza (o "S", textos claros) fica como está
  hd = h * 360
  t = 0 if hd >= 197 else 1 if hd <= 175 else (197 - hd) / 22  # 0 = azul, 1 = menta
  claro = min(1, max(0, (v - 0.3) / 0.5))
  p = t * 0.55 + 0.45 + (0 if t else 0) if t > 0 else claro * 0.45
  if 0 < t < 1: p = 0.45 + t * 0.55
  return (*rampa(r, min(1, p)), A)
o, d, modo = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else 'claro')
im = Image.open(o).convert('RGBA'); r = RAMPAS[modo]
im.putdata([cor(px, r) for px in im.getdata()]); im.save(d)
