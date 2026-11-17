import sys, json, traceback

SKILL = r"C:\Users\10552\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.skills\ppt"
sys.path.insert(0, SKILL)
from scripts.svg_lib.atomize_svg_to_slide._publish import _run, _classify, _describe
import os

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
args = ["slides", "+add-slide", "--as", "user",
        "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb",
        "--slide", "@page04_full.xml"]
res = _run(args, cwd)
print("res ok:", res.get("ok"))
try:
    report = json.loads(res["error"]["message"])
    errors = [e for s in report.get("slides", []) for e in s.get("errors", [])]
    errors += list((report.get("document") or {}).get("errors", []))
    print("errors extracted:", len(errors))
    codes = {}
    for e in errors:
        codes[e.get("code")] = codes.get(e.get("code"), 0) + 1
    print("codes:", codes)
except Exception:
    traceback.print_exc()
