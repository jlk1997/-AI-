import json, re

data = json.load(open('deck3.txt', encoding='utf-8-sig'))
content = data['data']['xml_presentation']['content']
# split slides
slides = re.findall(r'<slide id="([A-Za-z0-9]+)">(.*?)</slide>', content, re.S)
print('total slides:', len(slides))
for i, (sid, body) in enumerate(slides):
    # find first title-ish text
    texts = re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)
    texts = [re.sub(r'<[^>]+>', '', t).strip() for t in texts]
    texts = [t for t in texts if t]
    title = texts[0] if texts else ''
    print(i + 1, sid, '|', title[:60])
