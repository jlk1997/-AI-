import subprocess, json

cwd = r"E:\OpenGame-main\OpenGame-main\ppt-work"
proc = subprocess.run(["lark-cli", "slides", "+add-slide",
                       "--presentation", "CzdAsa5FhlonhsdqTVVciALPnPb",
                       "--slide", "@page04_full.xml"],
                      capture_output=True, text=True, cwd=cwd, timeout=120)
text = proc.stderr or proc.stdout
obj = json.loads(text.strip())
report = json.loads(obj["error"]["message"])
for e in report["slides"][0]["errors"]:
    print(e["code"], e["elements"], "meas:", e.get("measurement"))
    for o in e.get("related_objects", []):
        print("   ", o["type"], o["bbox"])
