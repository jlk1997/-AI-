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
        <p>The forecasting engine</p>
      </content>
    </shape>
    <shape type="text" topLeftX="56" topLeftY="118" width="848" height="24">
      <content textType="body" fontSize="14" fontFamily="Inter" color="rgba(148,163,184,1)" wrap="false">
        <p>An ensemble of simulated futures, turned into calibrated probability bands.</p>
      </content>
    </shape>
    <line startX="56" startY="496" endX="904" endY="496"><border color="rgba(148,163,184,0.15)" width="1"/></line>
    <shape type="text" topLeftX="56" topLeftY="504" width="500" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" wrap="false"><p>OpenGame  ·  Investor Briefing</p></content>
    </shape>
    <shape type="text" topLeftX="820" topLeftY="504" width="84" height="18">
      <content textType="caption" fontSize="10" fontFamily="Inter" color="rgba(100,116,139,1)" textAlign="right" wrap="false"><p>10 / 20</p></content>
    </shape>
  </data>
  <note>
    <content textType="body" fontSize="14" fontFamily="Inter">
      <p>We do not output a single guess. The engine runs a Monte Carlo ensemble of futures, seeded from two presets: a contested decision and an exercise near a residential area. Each run is a complete simulation, and the ensemble becomes a probability distribution: P10, P50, and P90 bands for turnout, casualties, hotspots, and the escalation timeline, together with the causal chain, alternatives, and a sensitivity analysis. Crucially, those probabilities are calibrated against a library of historical cases, using a Brier score, case distance, and interval coverage. That means the number we call 80 percent actually happens about 80 percent of the time. This is a forecast you can trust and audit, not a confident hallucination.</p>
    </content>
  </note>
</slide>"""

d = Drawing(900, 320)

# left: Monte Carlo ensemble fanning out
d.text_at((60, 150), "Monte Carlo ensemble", font_size=13, font_weight="bold",
          fill="#F1F5F9", anchor="start")
d.ellipse_at((90, 220), 7, 7, fill="#22D3EE")
d.text_at((90, 245), "one decision", font_size=9.5, fill="#94A3B8")
ends = [120, 160, 200, 240, 280]
for i, ey in enumerate(ends):
    d.path_at(f"M 97 220 C 200 220, 280 {ey}, 380 {ey}",
              stroke="#22D3EE", stroke_width=1.2, fill="none", opacity=0.45)
    d.ellipse_at((380, ey), 4, 4, fill="#22D3EE", opacity=0.7)
d.text_at((60, 300), "Presets: contested decision · nearby exercise",
          font_size=9.5, fill="#94A3B8", anchor="start")

# divider
d.line((430, 140), (430, 310), stroke="#94A3B8", stroke_width=1, opacity=0.2)

# right: calibrated probability bands
d.text_at((460, 150), "Calibrated probability bands", font_size=13,
          font_weight="bold", fill="#F1F5F9", anchor="start")

# illustrative P10/P50/P90 band
axis_y = 210
p10, p50, p90 = 560, 700, 840
d.text_at((460, axis_y - 22), "Turnout / escalation level (illustrative)",
          font_size=9.5, fill="#94A3B8", anchor="start")
d.line((480, axis_y), (860, axis_y), stroke="#94A3B8", stroke_width=1, opacity=0.4)
d.rect_at(((p10 + p90) / 2, axis_y), p90 - p10, 12, rx=6, fill="#22D3EE", opacity=0.25)
d.rect_at((p10, axis_y - 4), 4, 20, fill="#22D3EE")
d.rect_at((p90, axis_y - 4), 4, 20, fill="#22D3EE")
d.rect_at((p50, axis_y - 6), 4, 24, fill="#22D3EE")
d.text_at((p10, axis_y + 24), "P10", font_size=10, fill="#94A3B8")
d.text_at((p50, axis_y + 24), "P50", font_size=10, font_weight="bold", fill="#22D3EE")
d.text_at((p90, axis_y + 24), "P90", font_size=10, fill="#94A3B8")

# outputs
outputs = "Turnout · casualties · hotspots · level timeline"
d.text_at((460, 272), outputs, font_size=10, fill="#94A3B8", anchor="start")
d.text_at((460, 292), "Calibrated on historical cases: Brier score,",
          font_size=10, fill="#94A3B8", anchor="start")
d.text_at((460, 310), "case distance, interval coverage",
          font_size=10, fill="#94A3B8", anchor="start")

if __name__ == "__main__":
    r = publish_slide(page_xml, d.to_slide(x=30, y=140, width=900), presentation=DECK, page=10)
    print("OK:", r.get("ok"), "SID:", r.get("slide_id"))
    print("\n".join(r.get("summary", [])))
    for e in r.get("errors", []):
        print("ERR:", e.get("code"), e.get("fix"))
