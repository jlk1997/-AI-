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
        <p>07  ·  PRODUCT</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Two surfaces, one world</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>The same living world is both a forecasting object and a game you can play.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>12 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>There is one world, but it presents two surfaces. To an observer or a forecaster it is an object to watch, simulate, and place predictions on. To a player, that same world is a game to enter and alter. Both sit on the identical checkable, living core, so a player's action and a forecaster's prediction are about the same evolving reality. This is why the product is not a game and not a forecasting tool: it is a world that supports both. The architecture also degrades gracefully: if the 3D or video layer fails, the 2D game stays playable, and the world itself keeps running. One world, two ways in, no single point of failure.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 320)

# central world core (dark fill so text stays high contrast)
d.ellipse_at((450, 178), 82, 82, fill="#0A0E14", stroke="#22D3EE", stroke_width=2.2)
d.text_at((450, 164), "ONE WORLD", font_size=13, font_weight="bold", fill="#22D3EE")
d.text_at((450, 186), "checkable,", font_size=10, fill="#94A3B8")
d.text_at((450, 202), "living", font_size=10, fill="#94A3B8")

# left surface: world / observers
d.rect_at((180, 178), 220, 140, rx=14, fill="#111827", stroke="#818CF8",
          stroke_width=1.5, stroke_opacity=0.8)
d.text_at((180, 132), "WORLD SURFACE", font_size=12, font_weight="bold", fill="#818CF8")
d.text_at((180, 154), "For observers & forecasters", font_size=10, fill="#94A3B8")
d.text_at((180, 190), "Watch · simulate", font_size=10.5, fill="#F1F5F9")
d.text_at((180, 212), "Forecast · place predictions", font_size=10.5, fill="#F1F5F9")
d.text_at((180, 234), "The world as an object", font_size=9.5, fill="#64748B", font_style="italic")

# right surface: game / players
d.rect_at((720, 178), 220, 140, rx=14, fill="#111827", stroke="#22D3EE",
          stroke_width=1.5, stroke_opacity=0.8)
d.text_at((720, 132), "GAME SURFACE", font_size=12, font_weight="bold", fill="#22D3EE")
d.text_at((720, 154), "For players", font_size=10, fill="#94A3B8")
d.text_at((720, 190), "Play · enter the world", font_size=10.5, fill="#F1F5F9")
d.text_at((720, 212), "Add drama · alter the run", font_size=10.5, fill="#F1F5F9")
d.text_at((720, 234), "The world as a playground", font_size=9.5, fill="#64748B", font_style="italic")

# connectors core -> surfaces (gapped, straight, heads stop outside the cards)
d.arrow((362, 178), (298, 178), stroke="#818CF8", stroke_width=1.5, route="straight")
d.arrow((538, 178), (602, 178), stroke="#22D3EE", stroke_width=1.5, route="straight")

d.text_at((450, 300), "If the video layer fails, the 2D world keeps running and stays playable.",
          font_size=10, fill="#94A3B8", font_style="italic")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=12)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
