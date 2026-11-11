"""Builds docs/hero.png (1200 x 630) for the README and the X post.
The same look as the nearswaps agent kit's hero and the site's OG images: ground #060708, the mint lockup from the logo
masters, the symbol faint on the right, JetBrains Mono for the one line, one hairline, no gradients. The one thing added
is the button checkout.js draws: a mint pill with the amount. Everything it reads is in docs/brand.

Needs Python 3 with Pillow:   pip install pillow
Run (from anywhere):          python docs/build-hero.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.join(HERE, "brand")
OUT = os.path.join(HERE, "hero.png")
W, H = 1200, 630
GROUND, INK, BODY, MUTED, MINT = (6, 7, 8), (242, 242, 240), (154, 159, 168), (110, 115, 124), (1, 250, 192)
LINE = (24, 25, 27)  # rgba(255,255,255,0.07) over the ground
SS = 4               # the pill is drawn 4x and scaled down, for smooth round ends

def font(name, size, weight):
    f = ImageFont.truetype(os.path.join(BRAND, name), size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

def trimmed(name):
    im = Image.open(os.path.join(BRAND, name)).convert("RGBA")
    return im.crop(im.getbbox())

lock = trimmed("Mint nearswaps logo lockup-2.png")
sym = trimmed("Mint nearswaps symbol with twin arrows-3.png")

im = Image.new("RGB", (W, H), GROUND)
d = ImageDraw.Draw(im)

# the symbol on the right edge, partly off the canvas, one flat alpha (as the kit's hero)
sh = 560
s = sym.resize((round(sym.width * sh / sym.height), sh), Image.LANCZOS)
s.putalpha(s.getchannel("A").point(lambda v: int(v * 0.16)))
im.paste(s, (W - s.width + 120, (H - sh) // 2 + 10), s)

# the lockup on the left, a little smaller than the kit's, then the one mono line
lh = 128
l = lock.resize((round(lock.width * lh / lock.height), lh), Image.LANCZOS)
ly = 150
im.paste(l, (72, ly), l)
fm = font("JetBrainsMono-VF.ttf", 36, b"Medium")
line_y = ly + lh + 52
d.text((72, line_y), "one script tag · any coin · any chain", font=fm, fill=MINT)
fb = font("Manrope-VF.ttf", 30, b"SemiBold")
d.text((72, line_y + 64), "The shop receives the exact invoice, settled by NEAR Intents.", font=fb, fill=BODY)

# the button checkout.js draws: a mint pill, Manrope, "Pay 25 USDC", over the symbol on the right
fp = font("Manrope-VF.ttf", 34 * SS, b"ExtraBold")
label = "Pay 25 USDC"
pw = int(d.textlength(label, font=ImageFont.truetype(os.path.join(BRAND, "Manrope-VF.ttf"), 34))) + 2 * 40
ph = 76
pill = Image.new("RGBA", (pw * SS, ph * SS), (0, 0, 0, 0))
pd = ImageDraw.Draw(pill)
pd.rounded_rectangle([0, 0, pw * SS - 1, ph * SS - 1], radius=ph * SS // 2, fill=MINT + (255,))
tb = pd.textbbox((0, 0), label, font=fp, anchor="lm")
pd.text(((pw * SS - (tb[2] - tb[0])) // 2, ph * SS // 2), label, font=fp, fill=GROUND, anchor="lm")
pill = pill.resize((pw, ph), Image.LANCZOS)
px, py = W - 72 - pw - 40, ly + (lh - ph) // 2
im.paste(pill, (px, py), pill)

# footer: one hairline, the demo shop and the tag
ff = font("JetBrainsMono-VF.ttf", 22, b"Regular")
d.line([(72, H - 86), (W - 72, H - 86)], fill=LINE, width=1)
d.text((72, H - 62), "nearswaps.com/demo-shop", font=ff, fill=INK)
foot = "<script src=\"https://nearswaps.com/checkout.js\">"
d.text((W - 72 - d.textlength(foot, font=ff), H - 62), foot, font=ff, fill=MUTED)

im.save(OUT, optimize=True)
print("wrote", OUT, im.size, os.path.getsize(OUT), "bytes")
