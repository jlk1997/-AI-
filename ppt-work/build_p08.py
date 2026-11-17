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
        <p>Moat 2 · Promises, not hallucinations</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>We compile intent into a contract, then verify the world honors it.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>08 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Generative systems either hallucinate or quietly collapse into the same default town. We prevent both. A natural-language prompt is first compiled into a typed intent, then into a promise contract: the genre, the place, the jobs, and the population the author commits to. The world is generated against that contract, and a gate checks every promise before release. If a promise is missing, the system regenerates instead of shipping a template. What the author promises is what the world demonstrably contains. That makes output both creative and guaranteed.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 300)

steps = [
    ("Natural prompt", "One sentence"),
    ("Intent IR", "Typed intent"),
    ("Promise contract", "Genre, place, jobs…"),
    ("Generate world", "Synthesis"),
    ("Commitment gate", "All promises met"),
]
xs = [90, 270, 450, 630, 810]
y = 150
for (t, sub), x in zip(steps, xs):
    core = t == "Commitment gate"
    d.rect_at((x, y), 132, 52, rx=10, fill="#111827",
              stroke="#22D3EE" if core else "#94A3B8", stroke_width=1.8 if core else 1,
              stroke_opacity=1 if core else 0.5)
    d.text_at((x, y - 9), t, font_size=11, font_weight="bold",
              fill="#22D3EE" if core else "#F1F5F9")
    d.text_at((x, y + 11), sub, font_size=9.5, fill="#94A3B8")

# forward arrows with gap
for i in range(4):
    x1 = xs[i] + 70
    x2 = xs[i + 1] - 70
    d.arrow((x1, y), (x2, y), stroke="#22D3EE", stroke_width=1.6, route="straight")

# retry loop: from below the gate, across under the boxes, arrow up toward the generate node (gapped)
d.path_at("M 810 186 L 810 250 L 630 250",
          stroke="#818CF8", stroke_width=1.5, fill="none",
          stroke_dasharray="5 4", stroke_linecap="round")
d.arrow((630, 250), (630, 186), stroke="#818CF8", stroke_width=1.5, route="straight")
d.text_at((720, 280), "retry until every promise is honored", font_size=10,
          fill="#818CF8", font_style="italic")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=8, save_as="page08_full.xml")
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
