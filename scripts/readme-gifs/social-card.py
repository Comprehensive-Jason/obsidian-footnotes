"""Build the repo's GitHub social preview card (the 1280x640 image GitHub
shows when someone links the repo), made 2026-10-02.

The left side carries the plugin's name, a tagline, and feature chips. The
right side holds a cutout of the real footnote popup above a drawn diagram
of copy and paste. The diagram follows the README: definitions travel with
the copied text, and a number the destination note already uses moves to the
next free number.

Three steps rebuild it, run from the repo root:

  1. Take the popup screenshot. scene-social.js zooms Obsidian to 2x for it
     and puts everything back afterwards:
       node scripts/readme-gifs/record.mjs social --out <tmp>/social-capture.png
  2. Save where the popup sat in that screenshot (the scene leaves it in the
     app; the file may keep the CLI's leading "=> "):
       Obsidian.com vault=Obsidian-Plugin-Sandbox eval "code=JSON.stringify(window.__scene.meta)" > <tmp>/social-capture.json
  3. Compose the card. uv fetches Pillow (an image library) for this one run
     and installs nothing:
       uv run --no-project --with pillow python scripts/readme-gifs/social-card.py
         --capture <tmp>/social-capture.png --meta <tmp>/social-capture.json --out <tmp>/social-preview.png

Step 3 also writes a copy 480 pixels wide next to the card, roughly the size
Discord and forum link previews show it at, for checking what stays legible.
Upload the full-size card in the repo's Settings, General, Social preview.

Windows only: the fonts are Segoe UI and Consolas from C:/Windows/Fonts.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---- the words on the card; edit these to change it --------------------
EYEBROW = "OBSIDIAN PLUGIN"
TITLE_LINES = ["Footnote", "Shortcut"]
# Matches the repo description and the manifests' description (2026-10-02).
TAGLINE = "Create, edit, move, and tidy footnotes from the keyboard."
# Laid out two to a row.
CHIPS = ["Popup editor", "Copy and paste", "Rename", "Linter"]
# The copy and paste diagram. Each row is (text, style): "plain" is ordinary
# text, "dim" is what the destination note already held, "new" is what the
# paste added (highlighted), and "gap" is a blank line.
COPIED_FROM = [
    ("...last season.[^1]", "plain"),
    ("", "gap"),
    ("[^1]: Transect B...", "plain"),
]
PASTED_INTO = [
    ("Earlier point.[^1]", "dim"),
    ("...last season.[^2]", "new"),
    ("", "gap"),
    ("[^1]: Smith 2024", "dim"),
    ("[^2]: Transect B...", "new"),
]
DIAGRAM_CAPTION = "Definitions come along, and clashing numbers are renumbered."

# ---- sizes and colours ----------------------------------------------------
W, H = 1280, 640
FONTS = "C:/Windows/Fonts/"
WHITE = (244, 244, 245)
TEXT = (200, 200, 210)
MUTED = (120, 120, 132)
PURPLE = (167, 139, 250)
BORDER = (58, 56, 72)
HILITE = (58, 45, 105)


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


BLACK = font("seguibl.ttf", 96)
SEMI = font("seguisb.ttf", 23)
SEMI_SM = font("seguisb.ttf", 20)
REG = font("segoeui.ttf", 31)
MONO = font("consola.ttf", 19)
MONO_B = font("consolab.ttf", 19)


def read_meta(path):
    """The popup's position, saved by step 2. The Obsidian CLI starts its
    answer with "=> ", so that is dropped if present."""
    text = Path(path).read_text(encoding="utf-8").strip()
    if text.startswith("=>"):
        text = text[2:].strip()
    return json.loads(text)


def background():
    """Dark on the left, warming to violet on the right where the pictures
    sit, with a soft glow behind them."""
    bg = Image.new("RGB", (W, H))
    px = bg.load()
    for x in range(W):
        t = x / (W - 1)
        for y in range(H):
            u = y / (H - 1)
            px[x, y] = (int(18 + 22 * t + 4 * u), int(18 + 10 * t), int(22 + 44 * t + 6 * u))
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([700, 60, 1300, 620], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    return Image.composite(Image.new("RGB", (W, H), (88, 60, 170)), bg, glow).convert("RGBA")


def shadowed_card(img, box, fill, radius=18):
    """A soft shadow, then a rounded card with a thin border on top of it."""
    x0, y0, x1, y1 = box
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x0 + 6, y0 + 12, x1 + 6, y1 + 16], radius, fill=(0, 0, 0, 150))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    ImageDraw.Draw(img).rounded_rectangle(box, radius, fill=fill, outline=BORDER, width=2)


def spaced(draw, xy, text, fnt, fill, spacing):
    """Text with extra room between the letters, for the small heading."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + spacing


def wrap(draw, text, fnt, width):
    """Split text into lines that each fit within `width` pixels."""
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


def left_column(d):
    """Small heading, plugin name, tagline, then the feature chips."""
    lx = 72
    spaced(d, (lx, 86), EYEBROW, SEMI, PURPLE, 3)
    d.text((lx, 112), TITLE_LINES[0], font=BLACK, fill=WHITE)
    d.text((lx, 210), TITLE_LINES[1], font=BLACK, fill=WHITE)
    y = 352
    for line in wrap(d, TAGLINE, REG, 470):
        d.text((lx, y), line, font=REG, fill=TEXT)
        y += 42
    cx, cy = lx, y + 34
    for i, chip in enumerate(CHIPS):
        if i > 0 and i % 2 == 0:
            cx, cy = lx, cy + 54
        w = d.textlength(chip, font=SEMI_SM) + 36
        d.rounded_rectangle([cx, cy, cx + w, cy + 40], 20, fill=(36, 30, 56), outline=(86, 70, 140), width=2)
        d.text((cx + 18, cy + 7), chip, font=SEMI_SM, fill=(228, 228, 235))
        cx += w + 12


def popup_cutout(capture, meta, width):
    """Cut the sentence and its popup out of the screenshot, scaled to
    `width`. Returns the cutout and the editor's background colour, which the
    cards reuse so the cutout sits on them without a visible edge."""
    k = capture.width / meta["innerWidth"]  # screenshot pixels per page pixel
    pop, ref = meta["popup"], meta["refLine"]
    box = (
        round(pop["x"] * k) - 12,
        round(ref["y"] * k) - 16,
        round((pop["x"] + pop["width"]) * k) + 12,
        round((pop["y"] + pop["height"]) * k) + 12,
    )
    crop = capture.crop(box)
    # the blank line above the sentence shows the editor's own background
    editor_bg = capture.getpixel((round((pop["x"] + 200) * k), round((ref["y"] - 20) * k)))
    crop = crop.resize((width, round(crop.height * width / crop.width)), Image.LANCZOS)
    # The cutout starts mid-sentence, so its left edge fades into the card.
    fade = Image.new("L", crop.size, 255)
    fd = ImageDraw.Draw(fade)
    for i in range(90):
        fd.line([(i, 0), (i, crop.height)], fill=int(255 * i / 90))
    return Image.composite(crop, Image.new("RGB", crop.size, editor_bg), fade), editor_bg


def mini_note(d, x, top, title, rows):
    """One small note in the diagram: a label above a box of text rows."""
    note_w = 238
    d.text((x + 4, top), title, font=SEMI_SM, fill=MUTED)
    box = (x, top + 32, x + note_w, top + 32 + 148)
    d.rounded_rectangle(box, 12, fill=(22, 22, 26), outline=(48, 48, 58), width=1)
    ry = box[1] + 16
    for text, style in rows:
        if style == "gap":
            ry += 14
            continue
        if style == "new":
            d.rounded_rectangle([x + 8, ry - 3, x + note_w - 8, ry + 25], 6, fill=HILITE)
        colour = {"dim": MUTED, "new": (226, 216, 255), "plain": TEXT}[style]
        d.text((x + 16, ry), text, font=MONO_B if style == "new" else MONO, fill=colour)
        ry += 30


def build(capture_path, meta_path):
    img = background()
    left_column(ImageDraw.Draw(img))

    # Right column: the popup card on top, the diagram card below, the pair
    # centred top to bottom.
    rx0, rx1 = 612, 1212
    cutout, card_fill = popup_cutout(
        Image.open(capture_path).convert("RGB"), read_meta(meta_path), rx1 - rx0 - 36
    )
    diagram_h = 268
    hero_h = cutout.height + 36
    top0 = (H - (hero_h + 26 + diagram_h)) // 2
    hero = (rx0, top0, rx1, top0 + hero_h)
    shadowed_card(img, hero, card_fill)
    img.paste(cutout, (rx0 + 18, top0 + 18))

    dy0 = hero[3] + 26
    shadowed_card(img, (rx0, dy0, rx1, dy0 + diagram_h), card_fill)
    d = ImageDraw.Draw(img)
    note_w = 238
    ax, bx, top = rx0 + 18, rx1 - 18 - note_w, dy0 + 20
    mini_note(d, ax, top, "Copied from", COPIED_FROM)
    mini_note(d, bx, top, "Pasted into", PASTED_INTO)
    # the arrow between the two notes
    mx0, mx1, my = ax + note_w + 14, bx - 14, top + 32 + 74
    d.line([(mx0, my), (mx1 - 10, my)], fill=PURPLE, width=4)
    d.polygon([(mx1, my), (mx1 - 16, my - 10), (mx1 - 16, my + 10)], fill=PURPLE)
    cw = d.textlength(DIAGRAM_CAPTION, font=SEMI_SM)
    d.text(((rx0 + rx1 - cw) / 2, top + 32 + 148 + 18), DIAGRAM_CAPTION, font=SEMI_SM, fill=TEXT)
    return img.convert("RGB")


def main():
    ap = argparse.ArgumentParser(description="Build the GitHub social preview card.")
    ap.add_argument("--capture", required=True, help="the screenshot from step 1")
    ap.add_argument("--meta", required=True, help="the popup position file from step 2")
    ap.add_argument("--out", required=True, help="where to write the 1280x640 card")
    args = ap.parse_args()
    card = build(args.capture, args.meta)
    out = Path(args.out)
    card.save(out)
    check = out.with_name(out.stem + "-480px" + out.suffix)
    card.resize((480, 240), Image.LANCZOS).save(check)
    print(f"wrote {out} and {check}")


if __name__ == "__main__":
    main()
