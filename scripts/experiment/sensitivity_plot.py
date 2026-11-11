"""민감도 분석 그래프 — docs/sensitivity/results.json → docs/sensitivity/*.png

실행 (저장소 루트):  python3 scripts/experiment/sensitivity_plot.py
필요: matplotlib, 한글 글꼴(Noto Sans CJK / 맑은 고딕 / Apple SD Gothic Neo 중 하나)
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs' / 'sensitivity'
data = json.loads((OUT / 'results.json').read_text(encoding='utf-8'))
conds = {c['id']: c for c in data['conditions']}

for name in ['Noto Sans CJK KR', 'Noto Sans CJK JP', 'Malgun Gothic', 'Apple SD Gothic Neo', 'NanumGothic']:
    if any(f.name == name for f in font_manager.fontManager.ttflist):
        plt.rcParams['font.family'] = name
        break
plt.rcParams['axes.unicode_minus'] = False

SURFACE, INK, MUTED, GRID = '#fcfcfb', '#0b0b0b', '#6b6a63', '#e4e3df'
LOW, HIGH, THIRD = '#2a78d6', '#eb6834', '#1baf7a'
PARAMS = [('pick', '찜 반영률 가중치'), ('must', '꼭 가기 가중치'), ('budget', '예산 가중치'),
          ('walk', '걸음 가중치'), ('veto', '제외 가중치'), ('stay', '체류 시간(stay_min)')]


def low_high(key):
    if key == 'stay':
        return conds['stay_0.8'], conds['stay_1.2']
    return conds[f'w_{key}_0.8'], conds[f'w_{key}_1.2']


def style(ax):
    ax.set_facecolor(SURFACE)
    for side in ['top', 'right', 'left']:
        ax.spines[side].set_visible(False)
    ax.spines['bottom'].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=9, length=0)
    ax.grid(axis='x', color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def tornado(metric, title, xlabel, filename):
    base = metric(conds['base'])
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=200, facecolor=SURFACE)
    style(ax)
    rows = sorted(PARAMS, key=lambda p: max(abs(metric(c) - base) for c in low_high(p[0])))
    for i, (key, label) in enumerate(rows):
        lo, hi = (metric(c) for c in low_high(key))
        for v, color, dy in [(lo, LOW, 0.17), (hi, HIGH, -0.17)]:
            ax.barh(i + dy, v - base, left=base, height=0.3, color=color, edgecolor=SURFACE, linewidth=2)
            ax.text(v + (0.0002 if v >= base else -0.0002), i + dy, f'{v:+.4f}', va='center',
                    ha='left' if v >= base else 'right', fontsize=7.5, color=INK)
    ax.axvline(base, color=INK, linewidth=1)
    ax.axvline(0, color=MUTED, linewidth=1, linestyle=(0, (3, 3)))
    ax.set_yticks(range(len(rows)), [r[1] for r in rows], color=INK, fontsize=9)
    ax.set_xlabel(xlabel, color=MUTED, fontsize=9)
    ax.set_title(title, loc='left', color=INK, fontsize=11, fontweight='bold', pad=12)
    lo_p = plt.Rectangle((0, 0), 1, 1, color=LOW)
    hi_p = plt.Rectangle((0, 0), 1, 1, color=HIGH)
    ax.legend([lo_p, hi_p], ['×0.8 (20% 낮춤)', '×1.2 (20% 높임)'], loc='lower right', frameon=False, fontsize=8)
    ax.text(base, len(rows) - 0.35, f' 기준 {base:+.4f}', color=INK, fontsize=8, va='bottom')
    xmin, xmax = ax.get_xlim()
    ax.set_xlim(min(xmin, -0.0005), xmax + 0.0008)
    fig.tight_layout()
    fig.savefig(OUT / filename, facecolor=SURFACE)
    plt.close(fig)


tornado(lambda c: c['h1']['least_misery']['diff'],
        'H1 효과 크기의 민감도: 최소 불만 − 평균 전략 (그룹 최저 만족도 차이)',
        '최저 만족도 차이 (0보다 크면 최소 불만 전략이 더 높음, 점선 = 0)', 'tornado_h1.png')
tornado(lambda c: c['h2']['least_misery']['diff'],
        'H2 효과 크기의 민감도: 평균 − 최소 불만 전략 (그룹 만족도 격차 차이)',
        '격차 감소량 (0보다 크면 최소 불만 전략의 격차가 더 작음, 점선 = 0)', 'tornado_h2.png')

# 조건별 세 전략의 그룹 최저 만족도 — 수준은 움직여도 순서가 유지되는지
order = ['base'] + [f'w_{k}_{f}' for k, _ in PARAMS[:5] for f in (0.8, 1.2)] + ['stay_0.8', 'stay_1.2']
names = {'pick': '찜', 'must': '꼭 가기', 'budget': '예산', 'walk': '걸음', 'veto': '제외'}
labels = ['기준'] + [f'{names[k]} ×{f}' for k, _ in PARAMS[:5] for f in (0.8, 1.2)] + ['체류 ×0.8', '체류 ×1.2']
fig, ax = plt.subplots(figsize=(8, 5.2), dpi=200, facecolor=SURFACE)
style(ax)
series = [('average', '평균', LOW, 'o'), ('least_misery', '최소 불만', HIGH, 's'), ('fairness', '공정성', THIRD, 'D')]
for j, (st, name, color, marker) in enumerate(series):
    ys = [len(order) - 1 - i + (j - 1) * 0.22 for i in range(len(order))]
    xs = [conds[o]['strategies'][st]['min'] for o in order]
    ax.scatter(xs, ys, s=42, color=color, marker=marker, edgecolors=SURFACE, linewidths=1.5, label=name, zorder=3)
ax.set_yticks([len(order) - 1 - i for i in range(len(order))], labels, color=INK, fontsize=8.5)
ax.set_xlabel('그룹 최저 만족도 평균 (0~1, 그룹 1,000개)', color=MUTED, fontsize=9)
ax.set_title('조건별 세 전략의 그룹 최저 만족도', loc='left', color=INK, fontsize=11, fontweight='bold', pad=26)
ax.legend(loc='lower left', bbox_to_anchor=(0, 1.0), ncol=3, frameon=False, fontsize=8.5, borderaxespad=0.2)
fig.tight_layout()
fig.savefig(OUT / 'min_by_condition.png', facecolor=SURFACE)
plt.close(fig)
print('저장:', ', '.join(f'docs/sensitivity/{n}' for n in ['tornado_h1.png', 'tornado_h2.png', 'min_by_condition.png']))
