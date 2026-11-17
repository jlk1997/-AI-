import { config } from 'dotenv';
import {
  collectSocietyApiKeys,
  collectSocietyEmergencyApiKeys,
  createSocietyLlmFn,
  resolveSocietyEmergencyEnv,
} from '../packages/world-planner/dist/chat.js';

config();

console.log('floor keys', collectSocietyApiKeys().map((k) => k.slice(-4)));
console.log(
  'emergency keys',
  collectSocietyEmergencyApiKeys().map((k) => k.slice(-4)),
);
const emergency = resolveSocietyEmergencyEnv();
console.log(
  'emergency env',
  emergency
    ? { baseUrl: emergency.baseUrl, model: emergency.model, provider: emergency.provider }
    : null,
);

for (const lane of ['floor', 'lit']) {
  const llm = createSocietyLlmFn({ timeoutMs: 20_000, lane });
  if (!llm) {
    console.log(lane, 'No LLM configured');
    continue;
  }
  const out = await llm('只返回 JSON：[{"speaker":"A","text":"你好"}]');
  console.log(lane, 'replyLen', out.length);
  console.log(lane, 'replyPreview', out.slice(0, 200));
}
