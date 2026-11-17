import sys

SKILL = r"C:\Users\10552\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.skills\ppt"
sys.path.insert(0, SKILL)
from scripts.svg_lib.svg_drawing import Drawing
from scripts.svg_lib.atomize_svg_to_slide import publish_slide

DECK = "CzdAsa5FhlonhsdqTVVciALPnPb"

page_xml = """<slide xmlns="https://www.larkoffice.com/sml/2.0">
  <style><fill><fillColor color="rgba(10,14,20,1)"/></fill></style>
  <data>
    <shape type="text" topLeftX="56" topLeftY="42" width="500" height="20">
      <content textType="caption" fontSize="12" fontFamily="Inter" color="rgba(34,211,238,1)" letterSpacing="3" bold="true" wrap="false">
        <p>04  ·  TECHNOLOGY</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>A hybrid world model</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>Symbolic truth at the core, neural dynamics as advisor, rendering as a skin.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>06 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Pure neural world models hallucinate and cannot be checked; pure symbolic engines are rigid. We combine them. At the bottom is L1, symbolic truth: a typed World Spec, a deterministic simulator, and versioned WorldOps that can be rolled back. Above it sits the living society of residents. L2 is a small neural layer that imagines consequences and can only advise, never overwrite L1. L3 is the render layer, a playable skin. If the video breaks, the 2D game still runs because L1 keeps the world consistent. This is why our worlds are both generative and checkable.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 330)

layers = [
    ("L3", "RENDER LAYER", "Phaser / Three / LingBot / Marble — a playable skin; if the video breaks, the 2D game still runs",
     "#818CF8", False),
    ("L2", "NEURAL DYNAMICS", "Small networks imagine action consequences — advise only, never rewrite L1",
     "#22D3EE", False),
    ("", "LIVING SOCIETY", "Residents with memory, plans, needs, and opinion & rumor dynamics",
     "#22D3EE", False),
    ("L1", "SYMBOLIC TRUTH", "World Spec (single source of truth) · deterministic simulator · WorldOp version lineage",
     "#22D3EE", True),
]

band_h, gap = 62, 10
y = 30
for tag, title, desc, accent, core in layers:
    # band
    d.rect_at((450, y + band_h / 2), 840, band_h, rx=10,
              fill="#111827", stroke=accent if core else "#94A3B8",
              stroke_width=1.6 if core else 1, stroke_opacity=1 if core else 0.35)
    # tag
    if tag:
        d.text_at((90, y + band_h / 2), tag, font_size=22, font_weight="bold", fill=accent)
    # title
    d.text_at((150, y + band_h / 2 - 10), title, font_size=14, font_weight="bold",
              fill="#F1F5F9", anchor="start")
    d.text_at((150, y + band_h / 2 + 12), desc, font_size=10.5, fill="#94A3B8", anchor="start")
    if core:
        d.text_at((790, y + band_h / 2), "single source of truth", font_size=10,
                  fill=accent, font_style="italic")
    y += band_h + gap

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=6, save_as="page06_full.xml")
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
