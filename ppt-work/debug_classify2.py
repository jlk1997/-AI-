import os, sys, json, traceback

SKILL = r"C:\Users\10552\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.skills\ppt"
sys.path.insert(0, SKILL)
from scripts.svg_lib.atomize_svg_to_slide._publish import _run, _classify, _describe

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
xml = open(os.path.join(cwd, "page04_full.xml"), encoding="utf-8").read()

# generated ids = all children of the composed page that came from the fragment; compute via compose like publish does
sys.path.insert(0, SKILL)
from scripts.svg_lib.atomize_svg_to_slide._compose import compose_slide
frag = None
# regenerate fragment by importing the drawing build quickly
import importlib.util
spec = importlib.util.spec_from_file_location("bp04", os.path.join(cwd, "build_p04.py"))
# Instead of re-running, rebuild fragment inline:
from scripts.svg_lib.svg_drawing import Drawing
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
for i in range(len(made)):
    d.arrow(made[i], made[(i + 1) % len(made)], stroke="#22D3EE", stroke_width=1.8, curve=14)
d.text_at((450, 172), "A closed loop", font_size=16, font_weight="bold", fill="#F1F5F9")
d.text_at((450, 196), "sharper with every run", font_size=12, fill="#94A3B8")
frag = d.to_slide(x=30, y=132, width=900)

composed = compose_slide(open(os.path.join(cwd, "page04_base.xml"), encoding="utf-8").read(), frag)
children = [c for c in composed if c is not None]
# count children before fragment
import xml.etree.ElementTree as ET
SML = "https://www.larkoffice.com/sml/2.0"
root = ET.fromstring(composed)
data = root.find(f"{{{SML}}}data")
base_kids = [c for c in data if isinstance(c.tag, str)]
n_before = len(base_kids)
generated = set(range(n_before, len(base_kids) + len([c for c in compose_slide(composed, frag) if c is not None]) - n_before))

args = ["slides", "+add-slide", "--as", "user",
        "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb",
        "--slide", "@page04_full.xml"]
res = _run(args, cwd)
report = json.loads(res["error"]["message"])
errors = [e for s in report.get("slides", []) for e in s.get("errors", [])]
errors += list((report.get("document") or {}).get("errors", []))
ignorable, report_errs = _classify(composed, generated, errors)
print("ignorable:", len(ignorable), "report_errs:", len(report_errs))
for e in report_errs:
    try:
        desc = _describe(composed, e, generated, {})
        print("DESC code:", desc.get("code"), "| key:", desc.get("key"))
        print("  fix:", desc.get("fix"))
    except Exception:
        traceback.print_exc()
