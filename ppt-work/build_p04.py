import math, sys

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
        <p>The forecasting loop</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>We don't predict once — we run a closed loop, and every run sharpens the forecast.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>04 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>This is the heart of the product. We do not produce a single forecast and walk away. We run a closed loop: the living world simulates forward, we intervene with a decision or a rumor, we observe how the crowd reacts, we turn that into a probability forecast, and the decision-maker acts. Acting changes the world, which feeds the next simulation. Because every run is compared against what actually happened, the engine gets more calibrated over time.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 350)

nodes = [
    ("SIMULATE", "World runs forward", (450, 55)),
    ("INTERVENE", "Decisions & rumors", (654, 141)),
    ("OBSERVE", "Read crowd behavior", (576, 281)),
    ("FORECAST", "Probability bands", (324, 281)),
    ("DECIDE", "Choose & act", (246, 141)),
]
made = []
for title, sub, center in nodes:
    n = d.rect_at(center, 150, 56, rx=28, fill="#111827", stroke="#22D3EE", stroke_width=1.6)
    d.text_at((center[0], center[1] - 9), title, font_size=13, font_weight="bold", fill="#22D3EE")
    d.text_at((center[0], center[1] + 11), sub, font_size=10, fill="#94A3B8")
    made.append(n)

def _edge(center, hw, hh, dx, dy, gap=10):
    if dx == 0 and dy == 0:
        return center
    tx = (hw + gap) / abs(dx) if dx else float("inf")
    ty = (hh + gap) / abs(dy) if dy else float("inf")
    t = min(tx, ty)
    return (center[0] + dx * t, center[1] + dy * t)

centers = [c for _, _, c in nodes]
for i in range(len(centers)):
    a = centers[i]
    b = centers[(i + 1) % len(centers)]
    vx, vy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(vx, vy)
    ux, uy = vx / L, vy / L
    p1 = _edge(a, 75, 28, ux, uy)
    p2 = _edge(b, 75, 28, -ux, -uy)
    d.arrow(p1, p2, stroke="#22D3EE", stroke_width=1.8, route="straight")

d.text_at((450, 172), "A closed loop", font_size=16, font_weight="bold", fill="#F1F5F9")
d.text_at((450, 196), "sharper with every run", font_size=12, fill="#94A3B8")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=132, width=900), presentation=DECK, page=4, save_as="page04_full.xml")
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("no_lint:", r.get("no_lint"), "ignored:", r.get("ignored"))
    print("\n".join(r.get("summary", [])))
    if r.get("errors"):
        for e in r["errors"]:
            print("ERR:", e.get("code"), e.get("fix"))
