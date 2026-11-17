import fs from 'node:fs';

const path = 'apps/platform-worker/src/processJob.ts';
let s = fs.readFileSync(path, 'utf8');
const before = (s.match(/\uFFFD/g) || []).length;

s = s.replace(/\uFFFD\?\{/g, '${');
s = s.replace(/\uFFFD\?,/g, "',");
s = s.replace(/\uFFFD\?'/g, "'");
s = s.replace(/\uFFFD\?([)\]}])/g, "'$1");
s = s.replace(/\uFFFD\?/g, "'");
s = s.replace(/\uFFFD/g, '');

const replacements = [
  [/构建 Agent 上下'/g, "构建 Agent 上下文'"],
  [/可玩预览已部'/g, "可玩预览已部署'"],
  [/叙事门禁未完全收'—保留/g, '叙事门禁未完全收敛 — 保留'],
  [/叙事门禁未完全收'/g, "叙事门禁未完全收敛'"],
  [/ALLOW_ASSET_FIX'/g, "ALLOW_ASSET_FIX)'"],
  [/确定性治愈后'/g, "确定性治愈后）'"],
  [/门禁通过'\(\$\{/g, '门禁通过（${'],
  [/门禁通过'/g, "门禁通过（'"],
  [/禁止占位图'/g, "禁止占位图）'"],
  [/自动抠图'/g, "自动抠图）'"],
  [/真资产策略'/g, "真资产策略）'"],
  [/环境变量回退'/g, "环境变量回退）'"],
  [/package\.json'/g, "package.json）'"],
  [/骨架重'/g, "骨架重建'"],
  [/正在初始化'/g, "正在初始化…'"],
  [/用户已中止任'/g, "用户已中止任务'"],
  [/新需'/g, "新需求'"],
  [/engine 脚手'/g, "engine 脚手架'"],
  [/skeleton 脚手'/g, "skeleton 脚手架'"],
  [/legacy 脚手'/g, "legacy 脚手架'"],
  [/补全脚手'/g, "补全脚手架'"],
  [/工作区快'/g, "工作区快照'"],
  [/重验'/g, "重验）'"],
  [/Agent'/g, "Agent 轮）'"],
  [/仍失'/g, "仍失败'"],
  [/接线失'/g, "接线失败'"],
  [/dist 未变'/g, "dist 未变）'"],
  [/软继续（不撤销预览'/g, "软继续（不撤销预览）'"],
  [/可能不可'/g, "可能不可玩'"],
  [/非致命'/g, "非致命）'"],
  [/应用新需'/g, "应用新需求'"],
];
for (const [re, to] of replacements) s = s.replace(re, to);

fs.writeFileSync(path, s);
console.log('fffd before', before, 'after', (s.match(/\uFFFD/g) || []).length);

const lines = s.split('\n');
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes("'")) continue;
  if ((l.match(/'/g) || []).length % 2 === 0) continue;
  if (l.trim().startsWith('*') || l.trim().startsWith('//')) continue;
  bad++;
  if (bad <= 25) console.log(i + 1 + ':' + l.trim().slice(0, 140));
}
console.log('odd quote lines', bad);
