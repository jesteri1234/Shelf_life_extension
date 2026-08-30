from PIL import Image, ImageDraw
import math

ACCENT = (43, 110, 99, 255)   # teal
ACCENT2 = (85, 179, 163, 255) # lighter teal
RISK = (176, 80, 46, 255)     # rust
PAPER = (243, 245, 247, 255)

def make(size, path):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx, cy = S / 2, S / 2
    r_outer = S * 0.46

    # rounded square backdrop
    pad = S * 0.03
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.22, fill=ACCENT)

    # radar rings (paper-colored, decreasing alpha)
    for i, frac in enumerate([0.80, 0.58, 0.36]):
        rr = r_outer * frac
        width = max(2, int(S * 0.018))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(*PAPER[:3], 200), width=width)

    # crosshair
    lw = max(2, int(S * 0.016))
    d.line([cx - r_outer * 0.9, cy, cx + r_outer * 0.9, cy], fill=(*PAPER[:3], 120), width=lw)
    d.line([cx, cy - r_outer * 0.9, cx, cy + r_outer * 0.9], fill=(*PAPER[:3], 120), width=lw)

    # sweep wedge (radar scan) from 12 o'clock clockwise ~70deg, lighter teal
    wedge_r = r_outer * 0.8
    start = -90
    end = -20
    d.pieslice([cx - wedge_r, cy - wedge_r, cx + wedge_r, cy + wedge_r], start, end, fill=(*ACCENT2[:3], 130))

    # risk blip dot
    blip_ang = math.radians(-35)
    blip_r = r_outer * 0.55
    bx = cx + blip_r * math.cos(blip_ang)
    by = cy + blip_r * math.sin(blip_ang)
    br = S * 0.055
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=RISK)

    # center dot
    cr = S * 0.035
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=PAPER)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)

make(16, "icons/icon16.png")
make(48, "icons/icon48.png")
make(128, "icons/icon128.png")
print("done")
