# -*- coding: utf-8 -*-
import json
from pathlib import Path

import numpy as np
from matplotlib import font_manager as fm
from matplotlib import pyplot as plt
from matplotlib.patches import FancyBboxPatch

plt.rcParams["axes.unicode_minus"] = False

root = Path(__file__).resolve().parent
fonts = [
    p
    for p in fm.findSystemFonts()
    if any(x in p.lower() for x in ["msyh", "simhei", "simsun"])
]
font_path = next((p for p in fonts if "msyh" in p.lower() and "bd" not in p.lower()), None)
if not font_path and fonts:
    font_path = fonts[0]
prop = fm.FontProperties(fname=font_path) if font_path else None

data = json.loads((root / "replay-summary.json").read_text(encoding="utf-8"))
keys = ["village", "crew", "cloister"]
spread = [data[k]["spread"].get("rate", 0) * 100 for k in keys]
div = [data[k]["div"].get("rate", 0) * 100 for k in keys]
nov = [data[k]["nov"].get("rate", 0) * 100 for k in keys]
gather = [data[k]["coord"].get("peakGatheringRate", 0) * 100 for k in keys]
aware = [
    f"{data[k]['spread'].get('awareCount')}/{data[k]['spread'].get('totalAgents')}"
    for k in keys
]

fig, ax = plt.subplots(figsize=(8.4, 4.7), dpi=160)
x = np.arange(len(keys))
w = 0.2
ax.bar(x - 1.5 * w, spread, w, label="信息扩散率", color="#2563eb")
ax.bar(x - 0.5 * w, div, w, label="日程多样性", color="#059669")
ax.bar(x + 0.5 * w, nov, w, label="对白新颖度", color="#d97706")
ax.bar(x + 1.5 * w, gather, w, label="峰值共址率", color="#dc2626")
ax.set_ylabel("百分比（%）", fontproperties=prop)
ax.set_xticks(x)
ax.set_xticklabels(
    ["渔村 society.town", "空间站 society.crew", "修道院 society.cloister"],
    fontproperties=prop,
)
ax.set_ylim(0, 118)
ax.legend(prop=prop, loc="upper right", fontsize=9)
ax.set_title(
    "三份已保存社会回放的涌现评测卡（系统运行记录，非对照实验）",
    fontproperties=prop,
    fontsize=11,
)
for i, s in enumerate(aware):
    ax.text(i - 1.5 * w, spread[i] + 1.8, s, ha="center", fontsize=8)
ax.axhline(70, color="#94a3b8", ls="--", lw=0.8)
ax.text(2.05, 72, "小镇门禁 70%", fontproperties=prop, fontsize=8, color="#64748b")
fig.tight_layout()
fig.savefig(root / "fig9-1-emergence-card.png")
plt.close()

kind_order = [
    "move",
    "action",
    "dialogue",
    "plan",
    "reflection",
    "use-object",
    "observe",
    "intervene",
]
kind_cn = {
    "move": "移动",
    "action": "动作",
    "dialogue": "对话",
    "plan": "计划",
    "reflection": "反思",
    "use-object": "用物",
    "observe": "观察",
    "intervene": "干预",
}
titles = {
    "village": "渔村（397 事件）",
    "crew": "空间站（308 事件）",
    "cloister": "修道院（355 事件）",
}
fig, axes = plt.subplots(1, 3, figsize=(10.6, 3.9), dpi=160, sharey=True)
for axi, k in zip(axes, keys):
    kinds = data[k]["kinds"]
    ys = [kinds.get(kk, 0) for kk in kind_order]
    axi.barh([kind_cn[kk] for kk in kind_order], ys, color="#1d4ed8")
    axi.set_title(titles[k], fontproperties=prop, fontsize=10)
    for lab in axi.get_yticklabels():
        lab.set_fontproperties(prop)
    axi.set_xlabel("次数", fontproperties=prop)
fig.suptitle("社会回放事件类型构成", fontproperties=prop, fontsize=12)
fig.tight_layout()
fig.savefig(root / "fig9-2-event-kinds.png")
plt.close()


def box(ax, x, y, w, h, text, fc):
    p = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.04,rounding_size=0.12",
        facecolor=fc,
        edgecolor="#0f172a",
        lw=1.1,
    )
    ax.add_patch(p)
    ax.text(
        x + w / 2,
        y + h / 2,
        text,
        ha="center",
        va="center",
        fontproperties=prop,
        fontsize=8.4,
    )


fig, ax = plt.subplots(figsize=(10.4, 6.5), dpi=160)
ax.set_xlim(0, 10)
ax.set_ylim(0, 10)
ax.axis("off")
ax.set_title(
    "提示词到可玩世界的分层管道（实线为权威，虚线为建议）",
    fontproperties=prop,
    fontsize=12,
    pad=8,
)
box(ax, 0.3, 8.3, 2.2, 1.2, "提示词 p", "#e0f2fe")
box(ax, 2.8, 8.3, 2.4, 1.2, "意图中间表示\nI(p)", "#e0f2fe")
box(ax, 5.5, 8.3, 2.2, 1.2, "规划器\n模型或启发式", "#e0f2fe")
box(ax, 8.0, 8.3, 1.7, 1.2, "质量门禁", "#fee2e2")
box(ax, 0.3, 5.7, 4.4, 2.1, "L1 符号真相源\nWorld Spec  W\n模拟器 Sim · 算子 Apply", "#dcfce7")
box(ax, 5.1, 5.7, 4.6, 2.1, "社会过程 H\n占用世界模型 · Step\n涌现评测卡", "#fef9c3")
box(ax, 0.3, 3.3, 4.4, 1.8, "L2 神经动力学（可缺席）\n想象下一状态 / 难度建议", "#f3e8ff")
box(ax, 5.1, 3.3, 4.6, 1.8, "L3 空间与视频（可缺席）\nPhaser / Three / LingBot", "#ffe4e6")
box(ax, 3.0, 1.15, 4.0, 1.45, "游戏种子 G = Compile(W)\n玩法权威仍在 W", "#dbeafe")
ax.annotate("", xy=(2.8, 8.9), xytext=(2.5, 8.9), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.annotate("", xy=(5.5, 8.9), xytext=(5.2, 8.9), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.annotate("", xy=(8.0, 8.9), xytext=(7.7, 8.9), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.annotate("", xy=(2.5, 7.8), xytext=(8.85, 8.3), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.annotate("", xy=(7.4, 7.8), xytext=(8.85, 8.3), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.annotate(
    "",
    xy=(2.5, 5.1),
    xytext=(2.5, 5.7),
    arrowprops=dict(arrowstyle="->", ls="--", color="#7c3aed"),
)
ax.annotate(
    "",
    xy=(7.4, 5.1),
    xytext=(7.4, 5.7),
    arrowprops=dict(arrowstyle="->", ls="--", color="#be123c"),
)
ax.annotate("", xy=(5.0, 2.6), xytext=(5.0, 3.3), arrowprops=dict(arrowstyle="->", color="#0f172a"))
ax.text(
    0.3,
    0.28,
    "OpenGame 平台双轨：游戏代码轨与世界栈共享 Worker 与对象存储；本文增量止于世界对象、社会门禁与呈现边界。",
    fontproperties=prop,
    fontsize=8,
)
fig.tight_layout()
fig.savefig(root / "fig3-1-architecture.png")
plt.close()

fig, ax = plt.subplots(figsize=(10.4, 3.5), dpi=160)
ax.set_xlim(0, 12)
ax.set_ylim(0, 4)
ax.axis("off")
ax.set_title("世界生成任务的工序与门禁顺序", fontproperties=prop, fontsize=12)
steps = [
    (0.2, "意图抽出"),
    (2.1, "起草或合成"),
    (4.0, "结构校验"),
    (5.9, "承诺门禁"),
    (7.8, "资产与 L3"),
    (9.7, "构建预览"),
]
for i, (sx, t) in enumerate(steps):
    box(ax, sx, 1.55, 1.7, 1.15, t, "#dbeafe" if i < 4 else "#fce7f3")
    if i < len(steps) - 1:
        ax.annotate(
            "",
            xy=(steps[i + 1][0], 2.12),
            xytext=(sx + 1.7, 2.12),
            arrowprops=dict(arrowstyle="->", color="#0f172a"),
        )
ax.text(
    0.2,
    0.5,
    "早门禁：结构与承诺必须先于影像。社会心跳与世界编辑仅在合格规约上运行。",
    fontproperties=prop,
    fontsize=9,
)
fig.tight_layout()
fig.savefig(root / "fig8-1-pipeline.png")
plt.close()

# --- ASCII layout from saved village world.json ---
village = Path(
    r"e:/OpenGame-main/OpenGame-main/.platform-work/projects"
    r"/3c64f3fa-7d01-4dec-82c7-cae7eb0f0b7b/repo/public/world.json"
)
world = json.loads(village.read_text(encoding="utf-8"))
fig, axes = plt.subplots(1, 3, figsize=(11.2, 4.2), dpi=160)
for ax, region in zip(axes, world["space"]["regions"]):
    rows = region["layoutAscii"].splitlines()
    ax.set_title(f"{region['name']}（{region['id']}）", fontproperties=prop, fontsize=10)
    ax.set_xlim(-0.5, region["width"] - 0.5)
    ax.set_ylim(region["height"] - 0.5, -0.5)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            blocked = ch == "#"
            ax.add_patch(
                plt.Rectangle(
                    (x - 0.5, y - 0.5),
                    1,
                    1,
                    facecolor="#334155" if blocked else "#e2e8f0",
                    edgecolor="none",
                )
            )
    ax.set_xlabel(f"{region['width']}×{region['height']}", fontproperties=prop, fontsize=8)
fig.suptitle("渔村案例的 ASCII 可行走布局（# 为阻塞）", fontproperties=prop, fontsize=12)
fig.tight_layout()
fig.savefig(root / "fig4-1-village-ascii.png")
plt.close()

# --- WorldPanel schematic (from component structure, not a live capture) ---
fig, ax = plt.subplots(figsize=(10.6, 5.4), dpi=160)
ax.set_xlim(0, 12)
ax.set_ylim(0, 7)
ax.axis("off")
ax.set_title("WorldPanel 规约视图结构（据实现绘制）", fontproperties=prop, fontsize=12)
box(ax, 0.3, 5.5, 11.4, 1.2, "世界头：标题 · 修订号 · 区域/居民/任务计数 · 体裁包", "#e0f2fe")
box(ax, 0.3, 3.7, 5.5, 1.5, "规约栏目摘要\n空间 / 实体 / 规则 / 叙事", "#dcfce7")
box(ax, 6.1, 3.7, 5.6, 1.5, "修订谱系\n版本 · 算子摘要 · 脏资产 · 差分", "#fef9c3")
box(ax, 0.3, 1.7, 5.5, 1.6, "自然语言编辑 → planWorldOps → Apply", "#dbeafe")
box(ax, 6.1, 1.7, 5.6, 1.6, "L3 研究实验室（可缺席）\n边车健康 / 模拟帧", "#ffe4e6")
ax.text(
    0.3,
    0.45,
    "对应 apps/platform-web/src/components/World/WorldPanel.tsx；本图为结构示意，不是运行时截屏。",
    fontproperties=prop,
    fontsize=8,
)
fig.tight_layout()
fig.savefig(root / "fig9-6-world-panel.png")
plt.close()

# --- SocietyTownStage schematic ---
fig, ax = plt.subplots(figsize=(10.6, 5.4), dpi=160)
ax.set_xlim(0, 12)
ax.set_ylim(0, 7)
ax.axis("off")
ax.set_title("SocietyTownStage 观察界面结构（据实现绘制）", fontproperties=prop, fontsize=12)
box(ax, 0.3, 1.5, 7.0, 5.0, "回放舞台（iframe）\n居民走动 · 对话弧 · 时钟", "#dbeafe")
box(ax, 7.5, 5.0, 4.2, 1.5, "评测卡 / 时钟", "#fef9c3")
box(ax, 7.5, 3.3, 4.2, 1.5, "记忆与信念检查器", "#dcfce7")
box(ax, 7.5, 1.5, 4.2, 1.6, "耳语干预 / 快进 / 选人", "#fee2e2")
ax.text(
    0.3,
    0.45,
    "对应 SocietyTownStage.tsx；干预从回放光标重算，不从零时刻重放。",
    fontproperties=prop,
    fontsize=8,
)
fig.tight_layout()
fig.savefig(root / "fig9-7-society-stage.png")
plt.close()
print("ok")
for p in sorted(root.glob("*.png")):
    print(p.name, p.stat().st_size)
