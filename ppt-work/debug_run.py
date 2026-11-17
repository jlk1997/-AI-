import subprocess, json, os

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
args = ["lark-cli", "slides", "+add-slide", "--as", "user",
        "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb",
        "--slide", "@page04_full.xml"]
proc = subprocess.run(args, capture_output=True, text=True, cwd=cwd, timeout=180)
print("RC:", proc.returncode)
print("STDOUT len:", len(proc.stdout or ""))
print("STDERR len:", len(proc.stderr or ""))
for label, text in (("OUT", proc.stdout), ("ERR", proc.stderr)):
    if not text:
        continue
    try:
        obj = json.loads(text.strip())
    except Exception as e:
        print(label, "top-level json fail:", e)
        # try nested
        idx = text.find('"message"')
        print(label, "has message at", idx)
        continue
    print(label, "parsed ok:", obj.get("ok"))
    msg = obj.get("error", {}).get("message", "")
    print(label, "inner message len:", len(msg))
    try:
        report = json.loads(msg)
        print("inner parsed, errors:", report.get("summary", {}).get("error_count"))
    except Exception as e:
        print("inner parse fail:", e)
