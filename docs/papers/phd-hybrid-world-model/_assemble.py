# -*- coding: utf-8 -*-
"""Assemble chapter markdown files into one thesis draft.

DO NOT re-run against 全文-审稿修订版.md if that file has already been
reviewer-polished. The assembled file is the canonical thesis; this script
would overwrite numbering and wording fixes. Keep it only as a historical
rebuilder for the split chapter sources.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "全文-审稿修订版.md"

FRONT = r'''# 面向可玩交互的混合世界模型：符号世界规约、在线社会动力学与涌现门禁

**副标题：** 先把世界写成可核对的说明书，再让居民过日子，最后才给它穿上游戏皮肤

**学科：** 计算机科学与技术 / 人工智能 / 数字游戏

**论文类型：** 博士学位论文（中文稿，审稿修订汇聚版）

**对应系统：** OpenGame 平台世界栈（World Spec / Society Kernel / Hybrid L1–L3）

---

## 审稿视角修订说明（阅读后可删）

本汇聚版相对此前的分章草稿，按审稿人常见意见做了五件事。

1. **把贡献写成可证伪的句子，而不是模块清单。** 每条创新对应一种失败：暗改不可回放、脚手架塌缩、预测不在场、视频改账本。
2. **把设计常量与测量结果分开。** 0.7/24h 等是代码阈值，不是本文测得的平均传播率。第 9 章维持这一分界。
3. **把继承与增量分开。** Park 的记忆检索公式、A\*、普通 MLP、LingBot 权重不申报为本文发明。
4. **从摘要中移走投稿策略。** Nature 不是目标期刊——这句话留在第 10 章，避免摘要像自我辩护。
5. **合并补页、统一编号、去掉重复的位置句与元评论**（如「本小节不是给评委看的」）。答辩口述稿改入附录。

尚未补上的，审稿人仍会问：对照实验表、人类观察者评分、冻结提示集上的承诺通过率。第 9 章已列为待补，本版不编造数字。

---

## 中文摘要

从一句自然语言生成「会过日子的世界」，现有路径往往互相拆台。代码生成把空间、任务与对话挤进脚本，难以核验生成物是否仍是用户要的那个世界，也难以在不推倒重来的前提下修订一间船舱。交互视频看起来像世界，却默认不拥有背包、任务状态机与确定性回放。生成式智能体（Park 等，2023）让居民有记忆、计划与八卦传播，但其舞台通常由作者手摆，并不能从用户那句话编译出新的地理与制度，也很难把同一份世界编译成可玩的游戏。

本文研究如何从单条提示词同时得到三件必须互相约束的产物：（1）可校验、可回放、可差分的符号世界规约；（2）在该规约上推进的、可门禁的社会生活轨迹；（3）由规约确定性编译、玩法权威仍在规约一侧的可运行呈现。

方法上，世界规约（World Spec）作为单一真相源（L1）：空间、实体、关系、规则与叙事用类型系统约束，用确定性模拟器求值，用世界算子（WorldOp）修订并保留谱系。自然语言先编译为意图中间表示（体裁、地点承诺、职业承诺、人口、禁名），再经大模型起草或启发式合成；非经典提示禁止塌回斯坦福小镇脚手架标识。社会内核与体裁包解耦，在 Park 式认知循环之上增加需求打断、预算化对话（额度耗尽时模板仍扩散重要记忆）以及**心跳内的占用世界模型**：指数滑动平均预测人群分布，残差（惊讶）抬高好奇心并导致可观察的调查行为。信息扩散、身体共址、日程多样性与对话新颖度写成回归门禁而非插图。神经动力学（L2）与空间/视频后端（L3）只负责想象与观感，不得改写任务、战斗与背包。

本文贡献有四。第一，给出规约数据模型、条件—效果代数、确定性模拟与 WorldOp 修订语义，使游戏成为编译皮肤而非真相源。第二，给出承诺约束合成，使人话中的地点、职业、人口与体裁成为对生成器可行使的否决权。第三，把在线占用预测耦合进生成式社会心跳，使世界模型的误差改变「今天下午」，并以涌现评测卡作为可失败检查。第四，给出 L1/L2/L3 硬边界与从规约到可玩游戏的质量流水线。证据来自开源实现、确定性编译测试与回归用例；消融对照与人类评测列为未来工作。

**关键词：** 混合世界模型；世界规约；生成式智能体；程序内容生成；神经符号系统；涌现评测；游戏人工智能

---

## Abstract

Generating a “world that lives its own days” from a single prompt currently splits into conflicting routes: game-code agents emit scripts that are hard to verify or revise; interactive video looks like a world but does not own inventory, quests, or deterministic replay; generative agents (Park et al., 2023) socialize on a stage that was typically authored, not compiled from the user’s sentence. This dissertation asks how to obtain, from one prompt, a world that is simultaneously **checkable, playable, and socially alive**.

A typed **World Spec** is the single source of truth (L1). Space, entities, relations, rules, and narrative are validated, simulated deterministically, and revised by a **WorldOp** algebra with lineage. A game engine compiles the spec; it does not author it. Natural language is compiled into an **Intent IR** (genre, promised places, occupations, population, forbidden identifiers); custom prompts are forbidden from collapsing onto a Stanford-town scaffold. A pack-agnostic **society kernel** steps the spec with memory, planning, needs that interrupt schedules, budgeted dialogue that degrades to templates without stopping rumor, and—an increment over classical generative agents—an **in-tick occupancy world model** whose prediction residual (surprise) raises curiosity and produces observable investigation. Emergence metrics are regression gates. Neural dynamics (L2) and spatial/video backends (L3) imagine and look; they never rewrite quests, combat, or inventory.

Four systems contributions follow: spec-as-SSOT with WorldOp lineage; promise-constrained synthesis; occupancy-coupled living society with emergence gates; and a hybrid L1/L2/L3 pipeline that compiles a world into a playable game. Evidence is the open implementation, deterministic compilation tests, and regression cases. Ablations and human-subject scores are future work.

**Keywords:** hybrid world models; world specification; generative agents; procedural content generation; neuro-symbolic systems; emergence evaluation; game AI

---

## 创新点对照（给审稿人的一页）

| 编号 | 贡献 | 挡住的失败 | 不是本文发明 | 目前证据 | 待补 |
|------|------|------------|--------------|----------|------|
| C1 | 规约 SSOT + WorldOp 谱系 | 暗改、不可回放、场景私藏胜负 | Zod、一般 JSON | 校验测试；编译字节级一致 | 更大 RPG 可玩探针 |
| C2 | 承诺约束合成（Intent IR） | 脚手架塌缩、人数灌水、制度串味 | 正则抽出本身 | 渔村/空间站/否定广场等用例 | 冻结题集通过率、人类「是不是我要的地方」 |
| C3 | 心跳内占用惊讶 + 涌现闸门 | 预测不在场、没钱假死、关键词晚会 | Park 检索公式 | 预算耗尽仍交谈；2 日/30% 短测；闸门函数 | 关掉惊讶的消融；与 Smallville 对照 |
| C4 | L1 不可替换 + 编译门禁 | 视频改账本、占位图冒充可播 | LingBot 权重、MLP 本身 | L3 探测；难度旋钮可缺席 | 关闭边车的形式化实验 |

---

## 目录

- 中英文摘要
- 第1章 绪论
- 第2章 相关工作与理论基础
- 第3章 问题形式化与总体架构
- 第4章 世界规约与世界算子
- 第5章 意图中间表示与承诺约束合成
- 第6章 社会内核与在线世界模型
- 第7章 混合神经动力学与空间呈现
- 第8章 编译流水线与质量门禁
- 第9章 验证、案例与待补实验
- 第10章 结论与展望
- 参考文献
- 附录 A–N

---

'''

def read(name: str) -> str:
    p = ROOT / name
    return p.read_text(encoding="utf-8")

def strip_title(md: str) -> str:
    lines = md.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    while lines and not lines[0].strip():
        lines = lines[1:]
    return "\n".join(lines).rstrip() + "\n\n"

def drop_sections(md: str, titles: list[str]) -> str:
    """Remove markdown sections whose heading text is in titles."""
    lines = md.splitlines(keepends=True)
    out = []
    skip = False
    skip_level = 0
    for line in lines:
        if line.startswith("#"):
            hashes = len(line) - len(line.lstrip("#"))
            title = line.lstrip("#").strip()
            if skip and hashes <= skip_level:
                skip = False
            if not skip and any(title.startswith(t) or t in title for t in titles):
                skip = True
                skip_level = hashes
                continue
        if not skip:
            out.append(line)
    return "".join(out)

parts: list[str] = [FRONT]

# Chapter 1
ch1 = strip_title(read("01-绪论.md"))
ch1 = drop_sections(ch1, ["1.12 阅读建议"])  # keep but we'll append applications
parts.append("# 第1章 绪论\n\n")
parts.append(ch1)
parts.append("## 1.13 应用场景与可证伪问题\n\n")
s22 = strip_title(read("22-第1章补页-问题与场景.md"))
s22 = s22.replace("## 1.A ", "## 1.13.1 ").replace("## 1.B ", "## 1.13.2 ")
s22 = s22.replace("## 1.C ", "## 1.13.3 ").replace("## 1.D ", "## 1.13.4 ")
s22 = s22.replace("本补页是删除指南。", "没有对应失败的创新不应写入贡献列表。")
parts.append(s22)

# Chapter 2
ch2 = strip_title(read("02-相关工作.md"))
ch2 = ch2.replace("## 2.13 ", "## 2.12 ")
ch2 = ch2.replace("## 2.14 ", "## 2.13 ")
ch2 = ch2.replace("## 2.16 ", "## 2.14 ")
ch2 = ch2.replace("## 2.15 本文位置：不是新名词，是新接法", "## 2.16 本文位置：不是新名词，是新接法")
parts.append("# 第2章 相关工作与理论基础\n\n")
parts.append(ch2)
parts.append("## 2.17 关键文献的「少发明 / 必须多发明」\n\n")
s21 = strip_title(read("21-第2章补页-文献细读.md"))
s21 = s21.replace("## 2.A ", "### 2.17.1 ").replace("## 2.B ", "### 2.17.2 ")
s21 = s21.replace("## 2.C ", "### 2.17.3 ").replace("## 2.D ", "### 2.17.4 ")
s21 = s21.replace("## 2.E ", "### 2.17.5 ").replace("## 2.F ", "### 2.17.6 ")
s21 = s21.replace("## 2.G ", "### 2.17.7 ").replace("## 2.H ", "### 2.17.8 ")
s21 = s21.replace("## 2.I ", "### 2.17.9 ")
s21 = drop_sections(s21, ["2.J 细读之后的位置句"])
parts.append(s21)

# Chapter 3
ch3 = strip_title(read("03-问题形式化与总体架构.md"))
ch3 = ch3.replace(
    "```mermaid\nflowchart TB",
    "**图 3-1 合成管道与 L1/L2/L3。** 实线表示权威，虚线表示建议。\n\n```mermaid\nflowchart TB",
)
parts.append("# 第3章 问题形式化与总体架构\n\n")
parts.append(ch3)
parts.append("## 3.12 符号的用法与误用\n\n")
parts.append(strip_title(read("29-第3章补页-符号用法.md")))

# Chapter 4
parts.append("# 第4章 世界规约与世界算子\n\n")
parts.append(strip_title(read("04-世界规约与世界算子.md")))
parts.append("## 4.17 规约演进与改法\n\n")
parts.append(strip_title(read("23-第4章补页-版本与改法.md")))

# Chapter 5
parts.append("# 第5章 意图中间表示与承诺约束合成\n\n")
parts.append(strip_title(read("05-意图中间表示与承诺约束合成.md")))
s18 = strip_title(read("18-第5章补页-合同边界.md"))
s18 = s18.replace("## 5.A ", "## 5.14 ").replace("## 5.B ", "## 5.15 ")
s18 = s18.replace("## 5.C ", "## 5.16 ").replace("## 5.D ", "## 5.17 ")
s18 = s18.replace("## 5.E ", "## 5.18 ").replace("## 5.F ", "## 5.19 ")
s18 = s18.replace("## 5.G ", "## 5.20 ")
parts.append(s18)

# Chapter 6
parts.append("# 第6章 社会内核与在线世界模型\n\n")
parts.append(strip_title(read("06-社会内核与在线世界模型.md")))
s20 = strip_title(read("20-第6章补页-与Park对照.md"))
s20 = s20.replace("## 6.A ", "## 6.18 ").replace("## 6.B ", "## 6.19 ")
s20 = s20.replace("## 6.C ", "## 6.20 ").replace("## 6.D ", "## 6.21 ")
s20 = s20.replace("## 6.E ", "## 6.22 ").replace("## 6.F ", "## 6.23 ")
s20 = s20.replace("## 6.G ", "## 6.24 ").replace("## 6.H ", "## 6.25 ")
s20 = s20.replace("## 6.I ", "## 6.26 ")
parts.append("## 6.18 与生成式智能体的逐步对照\n\n")
# 6.18 already in first replace of 6.A - avoid duplicate heading
s20 = s20.replace("## 6.18 记忆流", "### 6.18.1 记忆流", 1) if False else s20
parts.append(s20)

# Chapter 7
parts.append("# 第7章 混合神经动力学与空间呈现\n\n")
parts.append(strip_title(read("07-混合神经动力学与空间呈现.md")))
parts.append("## 7.14 自我欺骗检测清单\n\n")
parts.append(strip_title(read("28-第7章补页-检测清单.md")))

# Chapter 8
parts.append("# 第8章 编译流水线与质量门禁\n\n")
parts.append(strip_title(read("08-编译流水线与质量门禁.md")))
parts.append("## 8.14 工序责任\n\n")
parts.append(strip_title(read("24-第8章补页-工序责任.md")))
parts.append("## 8.15 方法细讲：把第4–8章再走一遍\n\n")
parts.append(strip_title(read("15-中卷-方法细讲.md")))

# Chapter 9
ch9 = strip_title(read("09-验证与案例.md"))
parts.append("# 第9章 验证、案例与待补实验\n\n")
parts.append(ch9)
s19 = strip_title(read("19-第9章补页-答辩证据.md"))
s19 = s19.replace("## 9.A ", "## 9.10 ").replace("## 9.B ", "## 9.11 ")
s19 = s19.replace("## 9.C ", "## 9.12 ").replace("## 9.D ", "## 9.13 ")
s19 = s19.replace("## 9.E ", "## 9.14 ").replace("## 9.F ", "## 9.15 ")
parts.append(s19)

# Chapter 10
ch10 = strip_title(read("10-结论与展望.md"))
ch10 = drop_sections(ch10, ["10.8 给自己人看的写作说明"])
ch10 = ch10.replace("## 10.7 结束的一句", "## 10.8 结束的一句")
parts.append("# 第10章 结论与展望\n\n")
parts.append(ch10)
parts.append("## 10.7 拆稿后的句子级贡献\n\n")
parts.append(strip_title(read("25-第10章补页-拆稿句子.md")))
parts.append("## 10.9 讨论展开：威胁组合、可复现与伦理\n\n")
parts.append(strip_title(read("27-下卷-讨论展开.md")))

# References + appendices from 11
parts.append(strip_title(read("11-参考文献与附录.md")).replace(
    "# 第11章 参考文献与附录\n\n", "", 1
) if False else "")
ch11 = read("11-参考文献与附录.md")
if ch11.startswith("# "):
    ch11 = strip_title(ch11)
ch11 = ch11.replace("## 11.1 ", "## ")
# keep appendix numbering from original 11.2 onward as 附录
parts.append("# 参考文献与附录\n\n")
parts.append(ch11)

parts.append("\n---\n\n# 附录 J 按模块走读\n\n")
parts.append(strip_title(read("12-附录J-模块走读.md")))
parts.append("# 附录 K 提示词合同案例集\n\n")
parts.append(strip_title(read("13-附录K-提示词合同案例集.md")))
parts.append("# 附录 L 社会心跳的数值玩具\n\n")
parts.append(strip_title(read("14-附录L-心跳数值玩具.md")))
parts.append("# 附录 M 观察笔记：二十四小时推演\n\n")
parts.append(strip_title(read("16-附录M-二十四小时推演.md")))
parts.append("# 附录 N 失败模式百科\n\n")
parts.append(strip_title(read("17-附录N-失败模式百科.md")))
parts.append("# 附录 O 答辩口述稿\n\n")
parts.append(strip_title(read("26-全书总复习-答辩口述.md")))

text = "".join(parts)
# Light cleanup
text = text.replace("（本文件在阅读顺序上并入第 5 章，置于 5.13 小结之前亦可。）\n\n", "")
text = text.replace("细读不是读书报告比赛。每一篇只回答：它让本文可以少发明什么，它逼本文必须多发明什么。\n\n",
                    "下列细读只回答两问：该工作让本文可以少发明什么，以及它逼本文必须多发明什么。\n\n")
text = text.replace("本附录不引入新贡献。", "")
text = text.replace("本附录仍不增加新贡献。", "")
text = text.replace("\n\n\n\n", "\n\n")
OUT.write_text(text, encoding="utf-8")
han = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
print(f"Wrote {OUT.name}: {len(text)} chars, {han} hanzi, {text.count(chr(10))+1} lines")
