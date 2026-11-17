import os, sys, json, traceback

SKILL = r"C:\Users\10552\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.skills\ppt"
sys.path.insert(0, SKILL)
from scripts.svg_lib.svg_drawing import Drawing
from scripts.svg_lib.atomize_svg_to_slide._publish import (
    _lift_pasted_fragments, _with_sml_namespace, _prepare, _drop_degenerate,
    _children, _classify, _describe,
)
from scripts.svg_lib.atomize_svg_to_slide._compose import compose_slide

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
page_xml = open(os.path.join(cwd, "page04_base.xml"), encoding="utf-8").read()

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
fragments = [d.to_slide(x=30, y=132, width=900)]

# replicate publish_slide internals
px, _ = _lift_pasted_fragments(_with_sml_namespace(page_xml))
px, _ = _prepare(px)
cleaned = []
for frag in fragments:
    frag, _ = _drop_degenerate(frag)
    cleaned.append(frag)
origins, xml = {}, px
for k, frag in enumerate(cleaned):
    before = len(_children(xml))
    xml = compose_slide(xml, frag)
    after = len(_children(xml))
    for i in range(before, after):
        origins[i] = f"fragment[{k}]"
generated = set(origins)
print("total children:", len(_children(xml)), "generated:", sorted(generated))

# use the actual lint response (from page04_full earlier, same errors)
res_msg = None
# re-run add to get fresh message
import tempfile
from scripts.svg_lib.atomize_svg_to_slide._publish import _run
fd, tmp = tempfile.mkstemp(suffix=".xml", dir=cwd); os.close(fd)
open(tmp, "w", encoding="utf-8").write(xml)
rel = os.path.relpath(tmp, cwd)
res = _run(["slides", "+add-slide", "--as", "user", "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb", "--slide", f"@{rel}"], cwd)
os.unlink(tmp)
report = json.loads(res["error"]["message"])
errors = [e for s in report.get("slides", []) for e in s.get("errors", [])]
errors += list((report.get("document") or {}).get("errors", []))
try:
    ignorable, report_errs = _classify(xml, generated, errors)
    print("classify OK; ignorable:", len(ignorable), "report_errs:", len(report_errs))
except Exception:
    traceback.print_exc()
