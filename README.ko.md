<h1 align="center">claude-recall</h1>

<p align="center">
  <em>병렬 Claude Code 세션을 위한 statusline — 각 세션이 뭘 하려고 시작했는지 한눈에.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.0.8-blue?style=flat-square" alt="version">
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
- **`/handoff` 비상구** — 컨텍스트가 고갈 직전일 때, 구조화된 마크다운 요약을 디스크에 저장. 새 세션에서 `@<경로>`로 참조해 이어서 작업.

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
| `/handoff` | 핸드오프 요약을 `~/.claude/claude-recall/handoffs/`에 저장. 새 세션에서 `@<경로>`로 참조 |
| `/setup` | statusline 재설정 / 설치 상태 확인 |

## 커스터마이징

`~/.claude/claude-recall/config.json`:

```json
{
  "line1": ["focus", "branch", "model"],
  "line2": ["turn", "prompt", "elapsed", "context"],
  "line3": ["rate_limits", "seven_day", "cost"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true
  },
  "theme": "default"
}
```

- **line1** — 선택: `focus`, `branch`, `model`, `worktree`
- **line2** — 선택: `turn`, `prompt`, `elapsed`, `context`
- **line3** — 선택: `rate_limits`, `seven_day`, `cost`. `line3: []`로 설정하면 2줄로 고정됩니다.
- **gitStatus** — dirty 플래그와 앞섬/뒤처짐을 독립 토글.
- **theme** — `default` (시안/볼드, 다크 터미널), `light` (블루/다크오렌지, 밝은 터미널), `minimal` (차분한 단색 — 위험도는 reverse-video로 구분), `vivid` (밝은/고대비)
  - `theme`을 생략하면 `COLORFGBG` 환경변수를 읽어 밝은 배경(`bg=7` 또는 `bg=15`)일 때 자동으로 `light`를, 그 외에는 `default`를 선택합니다. 명시적으로 지정한 `theme` 값은 항상 우선합니다.
  - `NO_COLOR` 환경변수가 설정되어 있으면([no-color.org](https://no-color.org) 스펙) 값에 상관없이 모든 ANSI 색이 제거됩니다.

레거시 config의 `"line1": ["purpose", ...]`은 투명하게 `"focus"`로 매핑됩니다.

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
| **last prompt** | 2줄, 왼쪽 | 마지막 입력한 프롬프트 (v5 대비 약 3배 넓어짐) | claude-recall |
| **elapsed** | 2줄, 오른쪽 | 세션 시작 / 마지막 활동 후 경과 시간 | claude-recall |
| **context%** | 2줄, 오른쪽 | 컨텍스트 사용량 — 초록(<70%), 노랑(70-89%), 빨강(≥90%) | Claude Code 빌트인 |
| **5h rate limit 바** | 3줄 | 5시간 사용량 + 리셋 시각 — `5h ████░░░░░░ 45% (~16:59)` | Claude Code 빌트인 |
| **7d rate limit 바** | 3줄 | 7일 사용량 + 리셋 날짜/시각 — `7d ██░░░░░░░░ 20% (~4/25 13:59)` | Claude Code 빌트인 |
| **cost** | 3줄, 오른쪽 | 누적 세션 비용 | Claude Code 빌트인 |
| **worktree** *(옵션)* | 1줄, 오른쪽 | 링크드 git worktree 안에서 `⎇ <이름>` | Claude Code 빌트인 |
| **refinement error** | 1줄, 왼쪽 | 백그라운드 갱신 실패 시 빨간 `⚠ AI <원인>`이 focus를 대체 | claude-recall |

참고:
- 3번째 줄은 rate-limits 데이터가 있을 때만 렌더링됩니다 (Claude 구독 사용자). API 키만 쓰는 사용자에겐 자연스럽게 2줄로 표시됩니다.
- **첫 진입 캐시.** 세션 진입 직후에는 Claude Code가 아직 API 호출을 하지 않아 stdin에 `rate_limits`가 비어 있습니다. claude-recall은 마지막에 본 값을 `~/.claude/claude-recall/rate-limits.json`에 저장해두고 첫 렌더링에서 이 캐시로 5h / 7d 바를 즉시 표시합니다. `resets_at`이 지난 창은 캐시에서 제외됩니다 (새 창 사용량을 과대 표시하지 않도록).
- 좁은 터미널에서는 3번째 줄의 `cost`가 먼저, 그 다음 `7d` 세그먼트가 생략되어 `5h` 바 + 리셋 시각이 항상 보이도록 합니다.
- 컨텍스트 **90% 이상**이 되면 Line 2의 `cost` 자리가 빨간색 `⚠ try /handoff` 경고로 대체됩니다.
- 앞섬/뒤처짐 카운트는 마지막 `git fetch` 시점 기준입니다. `↓N` 표시를 정확히 유지하려면 주기적으로 `git fetch` 실행 권장.

</details>

<details>
<summary><strong>Focus 갱신 동작 방식</strong></summary>

트리거 (OR):
- **Power-of-2 턴** — 1, 2, 4, 8, 16, 32, 64, ... 초반엔 빠르게 수렴, 후반엔 가벼운 드리프트 체크
- **PreCompact** — Claude Code가 컨텍스트 압축 직전에 현재 상태를 포착
- **SessionEnd** — 핸드오프 연속성을 위한 최종 스냅샷

각 트리거는 `claude -p --model=haiku` 서브프로세스를 spawn, 마지막 20KB transcript와 함께:
- Tool 비활성 (`--tools ""`), 슬래시 커맨드 비활성, 세션 저장 비활성
- 환경변수 `CLAUDE_RECALL_REFINING=1`으로 자식 프로세스에서 claude-recall 훅이 재귀하지 않도록 가드
- 대화 언어로만 focus 텍스트를 반환
- 30초 타임아웃, 5초 디바운스

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
