<h1 align="center">claude-recall</h1>

<p align="center">
  <em>병렬 Claude Code 세션 파일럿의 HUD — 각 세션이 뭘 하려고 시작했는지, 어디까지 왔는지 한눈에</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.0.0-blue?style=flat-square" alt="version">
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
  <img src="assets/statusline-preview.svg" alt="claude-recall: 여러 터미널 탭" width="720">
</p>

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall: 화면 분할" width="800">
</p>

> [!IMPORTANT]
> **백그라운드 LLM 호출 안내.** claude-recall은 각 세션의 focus를 Claude Haiku로 백그라운드에서 자동 갱신합니다 (긴 세션 기준 약 $0.01). 이것이 플러그인의 핵심 기능이며 비활성화 토글은 없습니다. 백그라운드 LLM 호출을 원하지 않으시면 **설치하지 마세요**.

## HUD 구성 요소

프롬프트 입력창 위 최대 3줄:

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
| **5h rate limit 바** | 3줄 | 5시간 사용량 시각화 — `5h ████░░░░░░ 45%` | Claude Code 빌트인 |
| **7d rate limit 바** | 3줄 | 7일 사용량 시각화 (데이터 있을 때) | Claude Code 빌트인 |
| **cost** | 3줄, 오른쪽 | 누적 세션 비용 | Claude Code 빌트인 |
| **worktree** *(옵션)* | 1줄, 오른쪽 | 링크드 git worktree 안에서 `⎇ <이름>` | Claude Code 빌트인 |
| **refinement error** | 1줄, 왼쪽 | 백그라운드 갱신 실패 시 빨간 `⚠ AI <원인>`이 focus를 대체 | claude-recall |

> [!TIP]
> 3번째 줄은 rate-limits 데이터가 있을 때만 렌더링됩니다 (Claude 구독 사용자). API 키만 쓰는 사용자에겐 자연스럽게 2줄로 표시됩니다.

> [!WARNING]
> 컨텍스트 사용량이 **90% 이상**이 되면, Line 2의 `cost` 자리에 빨간색 `⚠ try /handoff` 경고가 나타납니다. `/handoff`를 실행하면 핸드오프 요약이 파일로 저장되며, 새 세션에서 `@<경로>`로 참조해 이어서 작업할 수 있습니다.

## 주요 기능

- **Focus 자율 관리** — 슬래시 커맨드 입력 없음. Haiku 서브프로세스가 턴 1, 2, 4, 8, 16, 32, ... 및 PreCompact, SessionEnd 시점에 백그라운드로 갱신. 대화 언어 그대로 작성됩니다 (한글 대화 → 한글 focus).
- **세션별 accent color** — 프로젝트 디렉토리 + 브랜치 해시 기반 결정적 색상. 텍스트 읽기 전에 색으로 세션 구분.
- **풍부한 git 상태** — branch 표시에 dirty 플래그 + `origin/<default>` 대비 앞섬/뒤처짐 카운트. main/master 자동 감지. `main` 브랜치에서도 `main↓3`로 pull이 밀렸음을 알려줌.
- **Rate limit 시각화** — 5h / 7d Claude.ai 구독 윈도우를 바 형태로 표현, 임계점 색상 코딩.
- **프롬프트 영역 확대** — 마지막 프롬프트가 Line 2의 대부분을 차지 (v5 대비 약 3배).
- **컨텍스트 위기 경고** — 90%+에서 cost 자리를 빨간 `⚠ try /handoff`가 대체.
- **`/handoff` (부가 기능, 비상구)** — 세션 컨텍스트가 고갈될 때 구조화된 MD 요약을 `~/.claude/claude-recall/handoffs/`에 저장. 파일은 세션 종료 후에도 남으며, 새 세션에서 `@<경로>`로 이어서 작업 가능.
- **자동 정리** — 7일 이상 유휴 세션은 다음 SessionStart에 삭제.
- **테마 프리셋** — `default`, `minimal`, `vivid`.

> [!NOTE]
> **앞섬/뒤처짐 카운트는 마지막 `git fetch` 시점을 기준으로 합니다.** `↓N` 표시를 정확하게 유지하려면 주기적으로 `git fetch`를 실행해주세요.

> [!IMPORTANT]
> **5.x에서 업그레이드 시 주의:** `/purpose` 커맨드가 제거되었습니다. Focus는 이제 자율 관리됩니다. 기존 `purpose` state 필드는 첫 읽기에서 자동으로 `focus`로 마이그레이션됩니다 — 사용자 조치 불필요. 전체 Breaking 변경사항은 CHANGELOG.md 참조.

## 설치

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
- **theme** — `default` (시안/볼드), `minimal` (차분한, 색상 없음), `vivid` (밝은/고대비)

레거시 config의 `"line1": ["purpose", ...]`은 투명하게 `"focus"`로 매핑됩니다.

## 제거

```bash
# 1. 플러그인 제거
/plugin uninstall claude-recall@claude-recall

# 2. ~/.claude/settings.json 에서 "statusLine" 키 삭제 후 Claude Code 재시작

# 3. (선택) 세션 데이터 삭제
rm -rf ~/.claude/claude-recall/
```

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
