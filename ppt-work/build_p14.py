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
        <p>Prediction market mechanics</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>One world, one market — settled by the world's own evidence, never by the author.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>14 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Each world runs one market, seeded automatically. The lock point is set at 12, 24, or 48 hours. The market opens, closes four hours later, and then spends four hours gathering evidence. The verdict comes from the town's real dialogue and living evidence, not from the author, who cannot change the result and cannot bet on their own market. A market forms only when both sides have stakes. The platform takes 15 percent, 70 percent of that goes to the author, and winners split the rest, with an 8x cap per bet. If the market is one-sided, silent, the clock stops, or the result is tied, every stake is refunded. The rules are designed to be fair and self-policing, which is what makes strangers willing to bet.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 330)

# timeline
steps = [
    ("LOCK", "12 / 24 / 48 h"),
    ("OPEN", "both sides stake"),
    ("CLOSE", "after 4 h"),
    ("PROOF", "next 4 h"),
    ("SETTLE", "by the world"),
]
xs = [90, 270, 450, 630, 810]
y = 175
nodes = []
for (t, sub), x in zip(steps, xs):
    core = t == "SETTLE"
    n = d.ellipse_at((x, y), 30, 30, fill="#111827", stroke="#22D3EE" if core else "#94A3B8",
                     stroke_width=1.8 if core else 1.2, stroke_opacity=1 if core else 0.6)
    nodes.append(n)
    d.text_at((x, y), t, font_size=9.5, font_weight="bold",
              fill="#22D3EE" if core else "#F1F5F9")
    d.text_at((x, y + 42), sub, font_size=9.5, fill="#94A3B8")
for i in range(4):
    d.arrow(nodes[i], nodes[i + 1], stroke="#22D3EE", stroke_width=1.4, route="straight")

# rules below
d.line((60, 240), (840, 240), stroke="#94A3B8", stroke_width=1, opacity=0.2)

# left: integrity
d.text_at((60, 262), "INTEGRITY", font_size=10, font_weight="bold",
          fill="#818CF8", anchor="start")
left = [
    "Settled by real dialogue and living evidence",
    "The author cannot change the verdict",
    "The author cannot bet on their own market",
]
y = 284
for line in left:
    d.text_at((60, y), line, font_size=10, fill="#94A3B8", anchor="start")
    y += 18

# right: money
d.text_at((470, 262), "MONEY & SAFETY", font_size=10, font_weight="bold",
          fill="#22D3EE", anchor="start")
right = [
    "15% rake; 70% of it to the author",
    "Winners split the rest; 8x cap per bet",
    "One-sided, silent, stopped, or tied: full refund",
]
y = 284
for line in right:
    d.text_at((470, y), line, font_size=10, fill="#94A3B8", anchor="start")
    y += 18

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=135, width=900), presentation=DECK, page=14)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
