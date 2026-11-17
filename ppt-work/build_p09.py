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
        <p>Moat 3 · A living society</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>Residents are not scripted NPCs — they remember, plan, need, form opinions, and wonder.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>09 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>Each resident is a living agent: they hold memory, keep a daily plan, have four needs that can interrupt that plan, and run opinion dynamics that become grievance, legitimacy, and rumors. The key addition is an inner world model running inside every heartbeat. A resident predicts where the crowd will be next, then compares that with what actually happens. The gap is surprise, which raises curiosity and drives the resident to walk over and look. Because attention is earned by surprise rather than scripted, behavior is genuinely emergent; a gate guards the emergence and a template is the fallback. This is a society that lives on its own.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 350)

# top: a resident with four mind modules
human = (
    '<circle cx="0" cy="-13" r="12" fill="#111827" stroke="#22D3EE" stroke-width="2"/>'
    '<path d="M-22 24 Q-22 -2 0 -2 Q22 -2 22 24 Z" fill="#111827" stroke="#22D3EE" stroke-width="2"/>'
)
d.svg_at((80, 78), human, size=(64, 74))
d.text_at((80, 122), "A resident", font_size=10, font_weight="bold", fill="#22D3EE")
# single short connector from the resident to the first mind module (sits in the gap)
d.line((112, 78), (150, 78), stroke="#22D3EE", stroke_width=1.2, opacity=0.5)

mind = [("MEMORY", "remembers"), ("PLAN", "daily schedule"),
        ("NEEDS", "interruptible"), ("OPINION", "grievance & rumors")]
xs = [220, 370, 520, 670]
for (t, sub), x in zip(mind, xs):
    d.rect_at((x, 78), 128, 46, rx=10, fill="#111827", stroke="#94A3B8",
              stroke_width=1, stroke_opacity=0.5)
    d.text_at((x, 72), t, font_size=11, font_weight="bold", fill="#F1F5F9")
    d.text_at((x, 92), sub, font_size=9.5, fill="#94A3B8")

# divider
d.line((60, 145), (840, 145), stroke="#94A3B8", stroke_width=1, opacity=0.2)

# bottom: inner world model horizontal flow
d.text_at((60, 175), "Inside every heartbeat: an inner world model", font_size=13,
          font_weight="bold", fill="#F1F5F9", anchor="start")

flow = [
    ("PREDICT", "next crowd"),
    ("COMPARE", "with actual"),
    ("GAP", "= surprise"),
    ("CURIOSITY", "rises"),
    ("GO LOOK", "walk over"),
]
fxs = [90, 270, 450, 630, 810]
fy = 250
for (t, sub), x in zip(flow, fxs):
    core = t == "GAP"
    d.rect_at((x, fy), 130, 48, rx=10, fill="#111827",
              stroke="#818CF8" if core else "#94A3B8",
              stroke_width=1.8 if core else 1, stroke_opacity=1 if core else 0.5)
    d.text_at((x, fy - 6), t, font_size=11.5, font_weight="bold",
              fill="#818CF8" if core else "#F1F5F9")
    d.text_at((x, fy + 12), sub, font_size=9.5, fill="#94A3B8")
for i in range(4):
    d.arrow((fxs[i] + 75, fy), (fxs[i + 1] - 75, fy),
            stroke="#818CF8", stroke_width=1.5, route="straight")

d.text_at((60, 330), "Attention is earned, not scripted.", font_size=11,
          fill="#22D3EE", font_style="italic", anchor="start")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=135, width=900), presentation=DECK, page=9, save_as="page09_full.xml")
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
