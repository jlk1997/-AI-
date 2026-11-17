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
        <p>03  ·  HOW IT WORKS</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Four analytical capabilities</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>One engine, four ways to read the world before it moves.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>05 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>The same engine produces four distinct outputs. First, opinion and sentiment: we track grievance, legitimacy and mood for every resident. Second, scenario simulation: we replay a decision or a rumor inside a living world that can be checked. Third, probabilistic forecasting: we return P10 to P90 outcomes calibrated against historical cases. Fourth, decision support: we compare options, test sensitivity, and let the decision-maker act. These are not four separate products; they are four reads of one simulated world.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 320)

# horizontal spine, segmented between nodes (no line through a node)
for xa, xb in [(162, 324), (388, 544), (608, 758)]:
    d.line((xa, 120), (xb, 120), stroke="#22D3EE", stroke_width=1.4, opacity=0.5)

caps = [
    ("01", "OPINION & SENTIMENT", "Grievance, legitimacy\nand mood per resident",
     '<rect x="-13" y="-2" width="6.5" height="15" rx="2" fill="#22D3EE"/>'
     '<rect x="-3.2" y="-11" width="6.5" height="24" rx="2" fill="#22D3EE"/>'
     '<rect x="6.6" y="4" width="6.5" height="10" rx="2" fill="#22D3EE"/>'),
    ("02", "SCENARIO SIMULATION", "Replay decisions &\nrumors in a checkable world",
     '<circle cx="0" cy="0" r="13" fill="none" stroke="#22D3EE" stroke-width="2"/>'
     '<path d="M-13 0 H13 M0 -13 V13" stroke="#22D3EE" stroke-width="2"/>'
     '<ellipse cx="0" cy="0" rx="13" ry="5.5" fill="none" stroke="#22D3EE" stroke-width="1.6"/>'),
    ("03", "PROBABILISTIC FORECAST", "P10–P90 outcomes\ncalibrated to history",
     '<path d="M-16 11 Q-9 11 -4.5 -5 Q0 -13 4.5 -5 Q9 11 16 11" fill="none" '
     'stroke="#22D3EE" stroke-width="2.2" stroke-linecap="round"/>'),
    ("04", "DECISION SUPPORT", "Compare options, test\nsensitivity, then act",
     '<path d="M0 13 V-3 M0 -3 L-10 -12 M0 -3 L10 -12" stroke="#22D3EE" '
     'stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
]

xs = [130, 356, 576, 790]
for (num, title, desc, icon), x in zip(caps, xs):
    # number above
    d.text_at((x, 64), num, font_size=13, font_weight="bold", fill="#818CF8")
    # node circle
    d.ellipse_at((x, 120), 32, 32, fill="#111827", stroke="#22D3EE", stroke_width=1.6)
    d.svg_at((x, 120), icon, size=(44, 44))
    # title below
    d.text_at((x, 180), title, font_size=12.5, font_weight="bold", fill="#F1F5F9")
    d.text_at((x, 214), desc, font_size=10.5, fill="#94A3B8", line_height=1.35)

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=5, save_as="page05_full.xml")
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
