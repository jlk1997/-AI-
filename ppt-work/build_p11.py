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
        <p>06  ·  FORECASTING</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="70" width="848" height="48">
      <content textType="title" fontSize="34" fontFamily="Montserrat" color="rgba(241,245,249,1)" bold="true" wrap="false">
        <p>Decision support: run the what-ifs first</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>Compare interventions, see their outcomes, and know which assumptions drive them.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>11 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Before acting in the real world, a decision-maker can run every option: hold, de-escalate, or deter. Each intervention is simulated as a full ensemble, so the decision-maker sees not just a predicted outcome but the probability band around it, the casualties and turnout implied, and the risk of a sudden spike. In this illustrative comparison, opening dialogue lowers the median escalation while holding leaves it high; deterrence can work but carries a tail risk. A sensitivity analysis then shows which assumptions, such as crowd size or rumor speed, move the result most. The system does not make the decision, but it makes the trade-offs visible and comparable before anyone commits.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 350)

# column headers
d.text_at((60, 150), "INTERVENTION", font_size=10, font_weight="bold",
          fill="#64748B", anchor="start")
d.text_at((250, 150), "P50 ESCALATION (ILLUSTRATIVE)", font_size=10,
          font_weight="bold", fill="#64748B", anchor="start")
d.text_at((640, 150), "OUTCOME", font_size=10, font_weight="bold",
          fill="#64748B", anchor="start")
d.line((60, 170), (840, 170), stroke="#94A3B8", stroke_width=1, opacity=0.25)

options = [
    ("A · Hold", "No intervention", 300, "High, drift upward", False),
    ("B · De-escalate", "Open dialogue", 110, "Lowest, stable", True),
    ("C · Deter", "Show of force", 200, "Medium, tail risk", False),
]
y = 200
for name, action, barw, outcome, rec in options:
    d.text_at((60, y - 8), name, font_size=12, font_weight="bold",
              fill="#22D3EE" if rec else "#F1F5F9", anchor="start")
    d.text_at((60, y + 12), action, font_size=9.5, fill="#94A3B8", anchor="start")
    # bar track
    d.rect_at((250 + 160, y), 320, 10, rx=5, fill="#94A3B8", opacity=0.12)
    d.rect_at((250 + barw / 2, y), barw, 10, rx=5,
              fill="#22D3EE" if rec else "#818CF8", opacity=0.85)
    d.text_at((640, y), outcome, font_size=10.5, fill="#94A3B8", anchor="start")
    if rec:
        d.text_at((820, y), "RECOMMENDED", font_size=10, font_weight="bold",
                  fill="#22D3EE", anchor="start")
    y += 50

d.line((60, 322), (840, 322), stroke="#94A3B8", stroke_width=1, opacity=0.2)
d.text_at((60, 342), "Sensitivity: which assumptions move the result most — crowd size, rumor speed, force posture.",
          font_size=9.5, fill="#94A3B8", anchor="start")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=132, width=900), presentation=DECK, page=11)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
