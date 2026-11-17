import json, re

data = json.load(open('deck2.txt', encoding='utf-8-sig'))
content = data['data']['xml_presentation']['content']
ids = re.findall(r'<slide id="([A-Za-z0-9]+)"', content)
print('total slides:', len(ids))
for i, s in enumerate(ids):
    print(i + 1, s)
