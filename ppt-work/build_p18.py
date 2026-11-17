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
        <p>11  ·  ROADMAP</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Roadmap: from worlds to a market</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>The hard technical layer is built; the next phases turn it into a marketplace and an ecosystem.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>18 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>The roadmap is sequenced so the hardest science comes first and the marketplace follows. Today, world generation and the forecasting core are working. Next, we expand the historical case library that calibrates our probabilities and launch the prediction market. Then we open the author ecosystem and turn on both revenue tracks, so authors create the worlds we monetize. In year two, we extend the engine from the current community and civic scenarios into broader domains such as cities, crises, and public events. Each phase compounds the last: more worlds improve calibration, better calibration drives betting, and betting funds more authors. We are raising now to move from the technical foundation, which is proven, to the marketplace and the supply side.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 310)

# baseline
base_y = 170
d.line((70, base_y), (850, base_y), stroke="#94A3B8", stroke_width=1.4, opacity=0.4)

phases = [
    ("NOW", "World generation, forecasting core", True),
    ("Q1–Q2", "Calibration library, market launch", False),
    ("Q3–Q4", "Author ecosystem, dual-track revenue", True),
    ("YEAR 2", "City, crisis, civic", False),
]
xs = [120, 360, 600, 820]
for (when, deliver, up), x in zip(phases, xs):
    # diamond marker
    d.svg_at((x, base_y),
             '<path d="M0 -9 L9 0 L0 9 L-9 0 Z" fill="#0A0E14" stroke="#22D3EE" stroke-width="2"/>',
             size=(18, 18))
    if up:
        d.text_at((x, base_y - 34), when, font_size=11, font_weight="bold", fill="#22D3EE")
        d.text_at((x, base_y - 58), deliver, font_size=10, fill="#94A3B8")
        d.line((x, base_y - 9), (x, base_y - 22), stroke="#22D3EE", stroke_width=1, opacity=0.5)
    else:
        d.text_at((x, base_y + 34), when, font_size=11, font_weight="bold", fill="#22D3EE")
        d.text_at((x, base_y + 58), deliver, font_size=10, fill="#94A3B8")
        d.line((x, base_y + 9), (x, base_y + 22), stroke="#22D3EE", stroke_width=1, opacity=0.5)

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=18)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
