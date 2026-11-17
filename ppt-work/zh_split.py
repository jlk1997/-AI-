import json, re, os

data = json.load(open('zh-base.txt', encoding='utf-8-sig'))
content = data['data']['xml_presentation']['content']
# save full content
open('zh-full.xml', 'w', encoding='utf-8').write(content)

# split slides
slides = re.findall(r'<slide id="([A-Za-z0-9]+)">(.*?)</slide>', content, re.S)
print('total slides:', len(slides))
os.makedirs('zh-pages', exist_ok=True)
for i, (sid, body) in enumerate(slides):
    full = f'<slide xmlns="https://www.larkoffice.com/sml/2.0" id="{sid}">{body}</slide>'
    open(f'zh-pages/p{i+1:02d}_{sid}.xml', 'w', encoding='utf-8').write(full)
    print(i + 1, sid)
