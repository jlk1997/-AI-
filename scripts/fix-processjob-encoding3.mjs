import fs from 'node:fs';

const path = 'apps/platform-worker/src/processJob.ts';
let s = fs.readFileSync(path, 'utf8');

// Empty string literals corrupted: ?? ',  -> ?? '',
s = s.replace(/\?\?\s*',/g, "?? '',");
s = s.replace(/\?\?\s*'\n/g, "?? '',\n");
s = s.replace(/stdout:\s*',/g, "stdout: '',");
s = s.replace(/stderr:\s*',/g, "stderr: '',");
s = s.replace(/:\s*';\s*$/gm, ": '';");
s = s.replace(/:\s*';\s*,/g, ": '',");

// super(`用户已中止任务'(${jobId})`) -> super(`用户已中止任务 (${jobId})`)
s = s.replace(/任务'\(\$\{/g, '任务（${');
s = s.replace(/logJobStep\(jobId, `'\$\{/g, 'logJobStep(jobId, `${');

// Restore empty ternary arms `: ';` -> `: '';`
s = s.replace(/:\s*';\s*$/gm, ": '';");

// Fix common broken FIX contract lines by replacing the whole block if needed
s = s.replace(
  /\? '8\. 若出TS2531[\s\S]*?：';\s*/m,
  `? '8. 若出现 TS2531/TS2532「可能为 null/undefined」：在使用前写 if (!x) return; 或非空断言；Phaser Arcade body 在 add.existing 后通常存在',\n    : '';\n`,
);

fs.writeFileSync(path, s);
console.log('patched empty-string patterns');
