<h1 align="center">claude-recall</h1>

<p align="center">
  <em>병렬 Claude Code 세션을 위한 statusline — 각 세션이 뭘 하려고 시작했는지 한눈에.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.2.1-blue?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-blueviolet?style=flat-square" alt="Claude Code Plugin">
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

Claude Code를 터미널 여러 개에서 동시에 돌리다 보면, 탭을 전환할 때마다 **"여기서 뭐 하고 있었지?"** 하는 순간이 옵니다.

claude-recall은 모든 세션에 대해 두 가지 질문을 한눈에 답합니다:

1. **이 세션이 뭘 하려고 시작했는지?** — AI가 백그라운드에서 자율 관리하는 focus 라벨
2. **어디까지 왔는지?** — 턴 수, 경과 시간, 컨텍스트 사용량, git 상태, rate-limit 바

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall 여러 터미널 탭에 렌더된 statusline" width="720">
</p>

<details>
<summary><strong>분할 패널(split-pane) 레이아웃에서 보기</strong></summary>

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall 4개 tmux 패널에서 렌더된 statusline" width="800">
</p>

</details>

## 왜 claude-recall인가?

- **Focus 자율 관리** — 실행할 커맨드 없음. Haiku 서브프로세스가 백그라운드에서 각 세션의 focus를 대화 언어 그대로 갱신.
- **세션별 accent color** — 프로젝트 디렉토리 + 브랜치 기반 결정적 색상 바. 텍스트 읽기 전에 색상으로 세션 구분.
- **단계별 컨텍스트 힌트** — 60%에 흐린 `(/compact soon)`, 70%에 흐린 `(run /compact)`, 90%에 빨간 `⚠ ctx 90%+`. Anthropic 공식 가이드(요약 품질이 가장 좋은 ~60% 시점에 `/compact` 실행)에 맞춤.

추가로: git 상태 (dirty + `origin/<default>` 대비 앞섬/뒤처짐), rate-limit 바 (5h / 7d), Claude Code의 context / cost / model — 최대 3줄 안에서 전부.

## 설치

> [!IMPORTANT]
> **백그라운드 LLM 호출 안내.** claude-recall은 각 세션의 focus를 Claude Haiku로 백그라운드에서 자동 갱신합니다 (긴 세션 기준 약 $0.01). 이것이 플러그인의 핵심 기능이며 비활성화 토글은 없습니다. 백그라운드 LLM 호출을 원하지 않으시면 **설치하지 마세요**.

```bash
# 1. 마켓플레이스 등록
/plugin marketplace add dkstm95/claude-recall

# 2. 플러그인 설치
/plugin install claude-recall@claude-recall

# 3. statusline 설정
/setup
```

> [!IMPORTANT]
> `/setup` 후 **Claude Code를 재시작**해야 statusline과 새 훅이 활성화됩니다.

## 사용법

설치 후에는 **자동으로 동작**합니다. focus 관리 관련 커맨드는 없습니다.

| 명령어 | 설명 |
|--------|------|
| `/setup` | statusline 재설정 / 설치 상태 확인 |

컨텍스트 관리는 Claude Code 네이티브 커맨드를 사용하세요: `/compact` (수동 압축, ~60% 시점 권장), `/clear` (무관한 작업으로 전환), `/resume` (이전 세션 재개).

## 커스터마이징

`~/.claude/claude-recall/config.json`:

```json
{
  "line1": ["focus", "branch", "model"],
  "line2": ["turn", "prompt", "elapsed"],
  "line3": ["context", "rate_limits", "seven_day", "cost"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true
  },
  "theme": "default"
}
```

- **line1** — 선택: `focus`, `branch`, `model`, `worktree`
- **line2** — 선택: `turn`, `prompt`, `elapsed`
- **line3** — 선택: `context`, `rate_limits`, `seven_day`, `cost`. `line3: []`로 설정하면 2줄로 고정됩니다.
- **gitStatus** — dirty 플래그와 앞섬/뒤처짐을 독립 토글.
- **theme** — `default` (시안/볼드, 다크 터미널), `light` (블루/다크오렌지, 밝은 터미널), `minimal` (차분한 단색 — 위험도는 reverse-video로 구분), `vivid` (밝은/고대비)
  - `theme`을 생략하면 `COLORFGBG` 환경변수를 읽어 밝은 배경(`bg=7` 또는 `bg=15`)일 때 자동으로 `light`를, 그 외에는 `default`를 선택합니다. 명시적으로 지정한 `theme` 값은 항상 우선합니다.
  - `NO_COLOR` 환경변수가 설정되어 있으면([no-color.org](https://no-color.org) 스펙) 값에 상관없이 모든 ANSI 색이 제거됩니다.

## Statusline 레퍼런스

<details>
<summary><strong>각 요소 설명 (전체 표)</strong></summary>

| 요소 | 위치 | 설명 | 출처 |
|------|------|------|------|
| **accent bar** | 모든 줄, 왼쪽 | 세션 고유 색상 바 (`▍`) — 프로젝트 디렉토리 + 브랜치 기반 결정적 색상 | claude-recall |
| **focus** | 1줄, 왼쪽 | AI가 자율 관리하는 세션 요약 — 사용자 입력 불필요 | claude-recall |
| **branch + status** | 1줄, 오른쪽 | `branch*↑N↓N` — dirty 플래그 + `origin/<default>` 대비 앞섬/뒤처짐 | claude-recall |
| **model** | 1줄, 오른쪽 | 사용 중인 Claude 모델 (예: Opus) | Claude Code 빌트인 |
| **turn** | 2줄, 왼쪽 | 현재 프롬프트 번호 (`#12`) | claude-recall |
| **last prompt** | 2줄, 왼쪽 | 마지막 입력한 프롬프트 | claude-recall |
| **elapsed** | 2줄, 오른쪽 | 세션 시작 / 마지막 활동 후 경과 시간 | claude-recall |
| **ctx 바** | 3줄 | 컨텍스트 사용량 — `ctx ████░░░░░░ 45%` — 초록(<70%), 노랑(70-89%), 빨강(≥90%) | Claude Code 빌트인 |
| **5h rate limit 바** | 3줄 | 5시간 사용량 + 리셋 시각 — `5h ████░░░░░░ 45% (~16:59)` | Claude Code 빌트인 |
| **7d rate limit 바** | 3줄 | 7일 사용량 + 리셋 날짜/시각 — `7d ██░░░░░░░░ 20% (~4/25 13:59)` | Claude Code 빌트인 |
| **cost** | 3줄, 오른쪽 | 누적 세션 비용 | Claude Code 빌트인 |
| **컨텍스트 힌트** | 1줄, 오른쪽 | 60-69%일 때 흐린 `(/compact soon)`, 70-89%일 때 흐린 `(run /compact)`, 90%↑일 때 빨간 `⚠ ctx 90%+` — 3줄을 꺼도 보장 | claude-recall |
| **worktree** *(옵션)* | 1줄, 오른쪽 | 링크드 git worktree 안에서 `⎇ <이름>` | Claude Code 빌트인 |
| **refinement error** | 1줄, 왼쪽 | 백그라운드 갱신 실패 시 빨간 `⚠ AI <원인>`이 focus를 대체 | claude-recall |

참고:
- 3번째 줄은 `ctx` / `rate_limits` / `seven_day` / `cost` 중 아무 데이터라도 있으면 렌더링됩니다. API 키만 쓰는 사용자라도 컨텍스트가 차기 시작하면 `ctx` 바가 보입니다.
- **`5h` / `7d` 바는 Claude.ai Pro/Max 구독자 전용입니다.** Claude Code가 Claude API 키 사용자에겐 `rate_limits` stdin 필드를 아예 보내지 않아, API 키 환경에서는 두 바가 채워지지 않습니다 (에러는 없고 그냥 표시 안 됨). `ctx`와 `$cost` 세그먼트는 평소대로 표시됩니다.
- **첫 진입 캐시.** Claude Code는 첫 API 호출 전에는 `rate_limits`와 `context_window`를 stdin에 싣지 않기 때문에, claude-recall은 마지막에 본 값을 `~/.claude/claude-recall/` 아래에 캐싱해두고 첫 렌더링에서 복원합니다 — 첫 프롬프트를 기다릴 필요 없이 바가 바로 나타납니다. 자세한 동작은 CHANGELOG v6.1.4 / v6.1.5 참고.
- 좁은 터미널에서는 3번째 줄의 `cost` → `7d` → `5h` 순으로 생략되어 `ctx` 바가 마지막까지 남습니다 — 컨텍스트 고갈이 가장 시급한 신호이기 때문입니다.
- Line 1 컨텍스트 힌트 단계: **60-69%** 흐린 `(/compact soon)` — Anthropic 공식 권고 시점(요약 품질이 가장 좋은 구간)에 미리 알리는 신호. **70-89%** 흐린 `(run /compact)` — `/compact focus on <주제>`로 사용자가 보존 우선순위를 직접 지시할 수 있는 구간. **≥90%** 빨간 `⚠ ctx 90%+` — auto-compact가 임박하거나 이미 돌고 있어, 경고만 띄우고 조치는 제시하지 않음. 모든 단계가 Line 1에 있어 `line3: []`로 3줄을 꺼도 신호는 항상 보입니다.
- 앞섬/뒤처짐 카운트는 마지막 `git fetch` 시점 기준입니다. `↓N` 표시를 정확히 유지하려면 주기적으로 `git fetch` 실행 권장.

</details>

<details>
<summary><strong>Focus 갱신 동작 방식</strong></summary>

트리거 (OR):
- **Power-of-2 턴** — 1, 2, 4, 8, 16, 32, 64, ... 초반엔 빠르게 수렴, 후반엔 가벼운 드리프트 체크
- **PreCompact** — Claude Code가 컨텍스트 압축 직전에 현재 상태를 포착
- **SessionEnd** — 세션 종료 직전의 최종 스냅샷

각 트리거는 `claude -p --model=haiku` 서브프로세스를 spawn, 마지막 12KB transcript와 함께:
- Tool 비활성 (`--tools ""`), 슬래시 커맨드 비활성, 세션 저장 비활성
- 환경변수 `CLAUDE_RECALL_REFINING=1`으로 자식 프로세스에서 claude-recall 훅이 재귀하지 않도록 가드
- 대화 언어로만 focus 텍스트를 반환
- 45초 타임아웃, 5초 디바운스

실패 시 Line 1의 focus가 빨간 라벨로 대체됩니다 (`⚠ AI timeout`, `⚠ AI rate limited`, `⚠ AI auth failed`, `⚠ AI refinement failed`). 다음 성공 시 자동 해소.

</details>

## 제거

```bash
# 1. 플러그인 제거
/plugin uninstall claude-recall@claude-recall

# 2. ~/.claude/settings.json 에서 "statusLine" 키 삭제 후 Claude Code 재시작

# 3. (선택) 세션 데이터 삭제
rm -rf ~/.claude/claude-recall/
```

<details>
<summary><strong>개발</strong></summary>

```bash
git clone https://github.com/dkstm95/claude-recall.git
cd claude-recall
npm install
npm run build
```

로컬 테스트:

```bash
claude --plugin-dir /path/to/claude-recall
```

</details>

## 라이선스

[MIT](LICENSE)
