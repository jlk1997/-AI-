import fs from 'node:fs';

const path = 'apps/platform-worker/src/processJob.ts';
let s = fs.readFileSync(path, 'utf8');

// Remove spurious quotes inserted between CJK and Latin/symbols
s = s.replace(/([\u4e00-\u9fff])'([A-Za-z@`$\d])/g, '$1$2');
s = s.replace(/([A-Za-z0-9])'([\u4e00-\u9fff])/g, '$1$2');
// Fix ''double opens
s = s.replace(/''+/g, "'");
// Fix broken patterns like summary: ''S3
s = s.replace(/:\s*''/g, ": '");
// Fix `（'` and similar
s = s.replace(/（'/g, '（');
s = s.replace(/'）/g, '）');
s = s.replace(/：'/g, '：');
s = s.replace(/，'/g, '，');

// Known phrase restorations
const map = [
  ["构建 Agent 上下'", "构建 Agent 上下文'"],
  ["可玩预览已部'", "可玩预览已部署'"],
  ["用户已中止任务'", "用户已中止任务'"],
  ["自愈循'/ Self-heal", '自愈循环 / Self-heal'],
  ["生成流水'classify", "生成流水线 classify"],
  ["已写'@opengame", "已写入 @opengame"],
  ["已确'@opengame", "已确认 @opengame"],
  ["街'juice", '街机 juice'],
  ["目'Scene", '目标 Scene'],
  ["当'${", '当前 ${'],
  ["提质'${", '提质第 ${'],
  ["自愈'${", '自愈第 ${'],
  ["升级'engine", '升级为 engine'],
  ["硬超时（${Math.round(cliElapsed / 1000)}s）'", "硬超时（${Math.round(cliElapsed / 1000)}s）—"],
];
for (const [a, b] of map) s = s.split(a).join(b);

fs.writeFileSync(path, s);

// Report remaining odd-quote non-comment lines
const lines = s.split('\n');
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.includes("'")) continue;
  // crude strip of template and strings is hard; count raw
  if ((l.match(/'/g) || []).length % 2 === 0) continue;
  if (/^\s*(\*|\/\/)/.test(l)) continue;
  bad++;
  if (bad <= 30) console.log(i + 1 + ':' + l.trim().slice(0, 130));
}
console.log('odd quote lines', bad);
