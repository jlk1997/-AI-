import subprocess, json

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
proc = subprocess.run(["lark-cli", "slides", "+add-slide",
                       "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb",
                       "--slide", "@page05_full.xml"],
                      capture_output=True, text=True, cwd=cwd, timeout=120)
obj = json.loads((proc.stderr or proc.stdout).strip())
report = json.loads(obj["error"]["message"])
for e in report["slides"][0]["errors"]:
    print(e["code"], e["elements"], "meas:", e.get("measurement"))
    for o in e.get("related_objects", []):
        print("   ", o["type"], o["bbox"])
