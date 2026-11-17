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
        <p>05  ·  MOAT</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Moat 1 · A checkable world</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>Every world is a typed, versioned specification — reproducible and auditable.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>07 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Video world models give you pixels you cannot verify. Our world is a typed specification, validated by schema, with one source of truth. The simulator is deterministic: the same inputs always produce the same world, so a result can be reproduced. Every change is a typed WorldOp that records its parent, forming a revision lineage. You can inspect why a resident did something and roll back to any earlier state. A world that can be checked and replayed is trustworthy in a way that a generated video never is. That is the first layer of the moat.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 330)

# left: three properties
props = [
    ("Typed World Spec", "Schema-validated; one single source of truth"),
    ("Deterministic simulation", "Same inputs, same outcomes — fully reproducible"),
    ("Versioned WorldOps", "Typed mutations with a revision lineage; roll back any step"),
]
y = 168
for i, (t, sub) in enumerate(props):
    d.text_at((60, y), f"0{i+1}", font_size=15, font_weight="bold", fill="#22D3EE", anchor="start")
    d.text_at((100, y - 2), t, font_size=14, font_weight="bold", fill="#F1F5F9", anchor="start")
    d.text_at((100, y + 18), sub, font_size=10.5, fill="#94A3B8", anchor="start")
    if i < 2:
        d.line((60, y + 46), (380, y + 46), stroke="#94A3B8", stroke_width=1, opacity=0.2)
    y += 68

# right: revision lineage diagram
d.text_at((640, 150), "Revision lineage", font_size=13, font_weight="bold",
          fill="#F1F5F9", anchor="start")

# main chain v1..v4
chain = [("v1", 470), ("v2", 570), ("v3", 670), ("v4", 770)]
for (name, x), i in zip(chain, range(len(chain))):
    if i < len(chain) - 1:
        d.line((x + 14, 210), (chain[i+1][1] - 14, 210), stroke="#22D3EE", stroke_width=1.6)
    d.ellipse_at((x, 210), 13, 13, fill="#111827", stroke="#22D3EE", stroke_width=1.8)
    d.text_at((x, 238), name, font_size=10.5, fill="#94A3B8")
# branch from v2, drawn below the main chain
d.line((570, 223), (570, 268), stroke="#818CF8", stroke_width=1.6)
d.line((570, 268), (620, 268), stroke="#818CF8", stroke_width=1.6)
d.ellipse_at((632, 268), 12, 12, fill="#111827", stroke="#818CF8", stroke_width=1.8)
d.text_at((632, 294), "v2b", font_size=10.5, fill="#818CF8")

d.text_at((640, 330), "Audit why, then roll back", font_size=11,
          fill="#22D3EE", font_style="italic", anchor="start")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=7)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
