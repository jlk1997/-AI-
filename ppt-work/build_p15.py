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
        <p>Why users come back on day two</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>The world keeps running while you are away, and it leaves open reasons to return.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>15 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Most generated content is consumed once and never revisited. A living world is different because it does not pause when the user leaves. Residents keep living, opinions keep moving, and the clock on any open prediction keeps running. That gives three concrete reasons to return: a prediction that is still open and waiting to settle, a world that has visibly changed overnight, and a personal story that is still in motion. We reinforce the habit on the game track with a multiplier for same-day returning players. Retention here is not a notification strategy; it is a structural consequence of a world that genuinely continues. The product has a tomorrow, which is the first thing a recurring-revenue business needs.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 320)

# left: the world runs across the gap
d.text_at((60, 150), "The world never pauses", font_size=13, font_weight="bold",
          fill="#F1F5F9", anchor="start")
d.ellipse_at((90, 210), 10, 10, fill="#22D3EE")
d.text_at((90, 238), "You leave", font_size=10, fill="#94A3B8")
d.ellipse_at((360, 210), 10, 10, fill="#22D3EE")
d.text_at((360, 238), "You return", font_size=10, fill="#94A3B8")
# running world in between
d.line((105, 210), (345, 210), stroke="#22D3EE", stroke_width=1.4, opacity=0.5,
       stroke_dasharray="3 4")
for i, x in enumerate([160, 220, 280]):
    d.ellipse_at((x, 210), 4, 4, fill="#818CF8", opacity=0.8)
d.text_at((60, 290), "While you are away, residents keep living",
          font_size=10, fill="#94A3B8", anchor="start")
d.text_at((60, 308), "and the world keeps evolving.",
          font_size=10, fill="#94A3B8", anchor="start")

# divider
d.line((420, 140), (420, 310), stroke="#94A3B8", stroke_width=1, opacity=0.2)

# right: three return hooks
d.text_at((450, 150), "Three reasons to return", font_size=13, font_weight="bold",
          fill="#F1F5F9", anchor="start")
hooks = [
    ("01", "Your prediction is still open", "come back to see it settle"),
    ("02", "The world changed overnight", "come back to find what is new"),
    ("03", "Your story is still running", "come back to keep playing"),
]
y = 185
for num, title, sub in hooks:
    d.text_at((455, y), num, font_size=12, font_weight="bold", fill="#22D3EE")
    d.text_at((485, y), title, font_size=11, font_weight="bold", fill="#F1F5F9", anchor="start")
    d.text_at((485, y + 17), sub, font_size=9.5, fill="#94A3B8", anchor="start")
    y += 46
d.text_at((450, 314), "Same-day returning players earn a multiplier.",
          font_size=10, fill="#818CF8", font_style="italic", anchor="start")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=15)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
