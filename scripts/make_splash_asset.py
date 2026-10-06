#!/usr/bin/env python3
"""Derives the runtime splash asset from the canonical master WITHOUT touching the master.
Lossless WebP (alpha kept): every visible pixel is identical to the master, the file is ~40% smaller.
Run: python3 scripts/make_splash_asset.py && python3 scripts/verify_splash_asset.py"""
from PIL import Image
import os
root = os.path.join(os.path.dirname(__file__), '..')
src = os.path.join(root, 'Hot_Attic_Games_Master_Logo_ALPHA_FINAL.png')
dst = os.path.join(root, 'src', 'assets', 'hag-splash.webp')
Image.open(src).convert('RGBA').save(dst, 'WEBP', lossless=True, method=6, quality=100)
print('wrote', dst, os.path.getsize(dst), 'bytes (master', os.path.getsize(src), 'bytes)')
