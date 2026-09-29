#!/usr/bin/env python3
# usage: python3 tools/contact_sheet.py out.png cols cellW file1 file2 ...   (labels every cell with its file name)
import sys
from PIL import Image, ImageDraw
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
ch = int(cw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * ch), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = (i % cols) * cw, (i // cols) * ch
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    name = f.split('/')[-1].replace('.png', '')
    d.rectangle([x, y, x + 8 * len(name) + 8, y + 16], fill=(0, 0, 0)); d.text((x + 4, y + 3), name, fill=(255, 255, 0))
sheet.save(out)
