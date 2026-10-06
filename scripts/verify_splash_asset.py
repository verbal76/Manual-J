#!/usr/bin/env python3
"""Fails unless the runtime splash asset is pixel-identical to the canonical master (alpha identical; RGB identical wherever alpha > 0)."""
from PIL import Image, ImageChops
import os, sys
root = os.path.join(os.path.dirname(__file__), '..')
a = Image.open(os.path.join(root, 'Hot_Attic_Games_Master_Logo_ALPHA_FINAL.png')).convert('RGBA')
b = Image.open(os.path.join(root, 'src', 'assets', 'hag-splash.webp')).convert('RGBA')
if a.size != b.size: sys.exit(f'FAIL size {a.size} != {b.size}')
if ImageChops.difference(a.split()[3], b.split()[3]).getbbox(): sys.exit('FAIL alpha channel differs')
# compare RGB only where visible (alpha>0): premultiply both by alpha-mask
mask = a.split()[3].point(lambda v: 255 if v > 0 else 0)
ra, rb = Image.new('RGB', a.size), Image.new('RGB', a.size)
ra.paste(a.convert('RGB'), (0, 0), mask); rb.paste(b.convert('RGB'), (0, 0), mask)
if ImageChops.difference(ra, rb).getbbox(): sys.exit('FAIL visible pixels differ')
print(f'OK: {b.size[0]}x{b.size[1]} runtime asset is pixel-identical to the canonical master')
