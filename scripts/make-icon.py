"""Generates build/icon.ico (multi-size) for Weby Browser. Run: python3 scripts/make-icon.py"""
from PIL import Image, ImageDraw, ImageFont
import os

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# vertical gradient inside a rounded square
grad = Image.new("RGBA", (S, S))
gp = grad.load()
top, bot = (79, 140, 255), (38, 70, 170)
for y in range(S):
    t = y / (S - 1)
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    for x in range(S):
        gp[x, y] = c
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=220, fill=255)
img.paste(grad, (0, 0), mask)

font = None
for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
    if os.path.exists(p):
        font = ImageFont.truetype(p, 640)
        break
font = font or ImageFont.load_default()
d = ImageDraw.Draw(img)
bbox = d.textbbox((0, 0), "W", font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((S - w) / 2 - bbox[0], (S - h) / 2 - bbox[1] - 20), "W", font=font, fill=(255, 255, 255, 255))

os.makedirs("build", exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save("build/icon.png")
img.save("build/icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
print("wrote build/icon.ico and build/icon.png")
