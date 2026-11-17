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
        <p>08  ·  BUSINESS</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Two revenue tracks, one world</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>Attention is free; we monetize the prediction and the drama, not the visit.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>13 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>The business model has two tracks over the same world. On the world track, watching is free and the product is the prediction: users place bets, and the platform takes a 15 percent rake, most of which goes to the author. On the game track, playing is free and the product is drama cards: small, reversible in-world enhancements, with 70 percent to the author and a half-price first card to pull new players in. On the cost side, authors pay to activate their world, lighting it for today or this week, while the platform never charges a visitor per visit. This aligns everyone: authors earn from both tracks, visitors pay only for the moments they choose, and the platform is paid for outcomes rather than access.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 320)

# left: world track
d.rect_at((240, 198), 380, 178, rx=14, fill="#111827", stroke="#818CF8", stroke_width=1.6)
d.text_at((240, 128), "WORLD TRACK", font_size=13, font_weight="bold", fill="#818CF8")
d.text_at((240, 150), "Watching is free", font_size=11, fill="#F1F5F9")
d.text_at((240, 178), "The product is the prediction", font_size=11, fill="#94A3B8")
d.text_at((240, 206), "15% platform rake", font_size=11, fill="#F1F5F9")
d.text_at((240, 234), "Most of the rake goes to the author", font_size=10, fill="#94A3B8")
d.text_at((240, 268), "Monetize foresight", font_size=10, fill="#64748B", font_style="italic")

# right: game track
d.rect_at((660, 198), 380, 178, rx=14, fill="#111827", stroke="#22D3EE", stroke_width=1.6)
d.text_at((660, 128), "GAME TRACK", font_size=13, font_weight="bold", fill="#22D3EE")
d.text_at((660, 150), "Playing is free", font_size=11, fill="#F1F5F9")
d.text_at((660, 178), "The product is the drama card", font_size=11, fill="#94A3B8")
d.text_at((660, 206), "70% to the author", font_size=11, fill="#F1F5F9")
d.text_at((660, 234), "First card half price to pull players in", font_size=10, fill="#94A3B8")
d.text_at((660, 268), "Monetize play", font_size=10, fill="#64748B", font_style="italic")

# bottom: cost side
d.line((60, 294), (840, 294), stroke="#94A3B8", stroke_width=1, opacity=0.2)
d.text_at((450, 310), "Authors pay to activate their world (light today / this week). Visitors are never charged per visit.",
          font_size=10.5, fill="#94A3B8")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=130, width=900), presentation=DECK, page=13)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
