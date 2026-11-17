import os, sys, json, tempfile

SKILL = r"C:\Users\10552\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.skills\ppt"
sys.path.insert(0, SKILL)
from scripts.svg_lib.svg_drawing import Drawing
from scripts.svg_lib.atomize_svg_to_slide import publish_slide
from scripts.svg_lib.atomize_svg_to_slide._publish import _run

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
DECK = "CzdAsa5FhlonhsdqTVVciALPnPb"

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

# compose without writing
r0 = publish_slide(page_xml, d.to_slide(x=30, y=132, width=900), presentation=None)
composed = r0["page_xml"]
fd, tmp = tempfile.mkstemp(suffix=".xml", dir=cwd)
os.close(fd)
rel = os.path.relpath(tmp, cwd)
open(tmp, "w", encoding="utf-8").write(composed)

args = ["slides", "+add-slide", "--as", "user", "--presentation", DECK, "--slide", f"@{rel}"]
res = _run(args, cwd)
print("res type:", type(res))
print("res keys:", list(res.keys()))
err = res.get("error")
print("error type:", type(err))
if isinstance(err, dict):
    print("error keys:", list(err.keys()))
    print("error code:", err.get("code"))
    msg = err.get("message")
    print("message type:", type(msg))
    if isinstance(msg, str):
        try:
            report = json.loads(msg)
            print("inner parsed ok, errors:", report.get("summary", {}).get("error_count"))
        except Exception as e:
            print("inner parse fail:", repr(e))
os.unlink(tmp)
