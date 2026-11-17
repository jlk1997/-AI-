import fs from 'node:fs';
import { execSync } from 'node:child_process';

const path = 'apps/platform-worker/src/processJob.ts';
let s = fs.readFileSync(path, 'utf8');

// Mid-string broken quotes that should be dashes/spaces
s = s.replace(/通过 '/g, '通过 — ');
s = s.replace(/未通过 '/g, '未通过 — ');
s = s.replace(/完成：deployment \$\{deploymentId\} 'production/g, '完成：deployment ${deploymentId} → production');
s = s.replace(/database 'BullMQ/g, 'database — BullMQ');
s = s.replace(/not found in database 'BullMQ will retry`/g, 'not found in database — BullMQ will retry`');
s = s.replace(/已确@opengame/g, '已确认 @opengame');
s = s.replace(/已写@opengame/g, '已写入 @opengame');
s = s.replace(/overlay 'call/g, 'overlay — call');
s = s.replace(/seed 'does not/g, 'seed — does not');
s = s.replace(/live 'later/g, 'live — later');
s = s.replace(/s\)'已终止/g, "s）— 已终止");
s = s.replace(/收敛 '—保留/g, '收敛 — 保留');
s = s.replace(/收敛'—保留/g, '收敛 — 保留');
s = s.replace(/收'—保留/g, '收敛 — 保留');
s = s.replace(/预览 '可能/g, '预览 — 可能');
s = s.replace(/部'\?/g, "部署'");
s = s.replace(/已部'/g, "已部署'");
s = s.replace(/ALLOW_ASSET_FIX'/g, "ALLOW_ASSET_FIX)'");
s = s.replace(/治愈后'/g, "治愈后）'");
s = s.replace(/门禁通过'\(/g, '门禁通过（');
s = s.replace(/门禁通过'\$\{/g, '门禁通过（${');
s = s.replace(/失败（非致命'/g, "失败（非致命）'");
s = s.replace(/登记失败（非致命'/g, "登记失败（非致命）'");

fs.writeFileSync(path, s);

try {
  const out = execSync('npx --yes tsc -p apps/platform-worker/tsconfig.json --noEmit', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('tsc ok', out.slice(0, 200));
} catch (e) {
  const err = /** @type {{ stdout?: string, stderr?: string }} */ (e);
  const text = (err.stdout || '') + (err.stderr || '');
  const lines = text.split('\n').filter((l) => l.includes('processJob.ts(')).slice(0, 25);
  console.log(lines.join('\n'));
  console.log('total', text.split('\n').filter((l) => l.includes('processJob.ts(')).length);
}
