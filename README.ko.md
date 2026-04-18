<h1 align="center">claude-recall</h1>

<p align="center">
  <em>병렬 Claude Code 세션의 즉각적인 컨텍스트 복구</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-5.0.0-blue?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-blueviolet?style=flat-square" alt="Claude Code Plugin">
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

Claude Code를 터미널 여러 개에서 동시에 돌리다 보면, 탭을 전환할 때마다 **"여기서 뭐 하고 있었지?"** 하는 순간이 옵니다.

claude-recall은 모든 Claude Code 세션의 맥락을 자동으로 추적해서, 전환하는 즉시 다시 집중할 수 있게 해줍니다.

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall: 여러 터미널 탭" width="720">
</p>

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall: 화면 분할" width="800">
</p>

## HUD 구성 요소

프롬프트 입력창 위에 항상 표시되는 2줄 HUD:

| 요소 | 위치 | 설명 | 출처 |
|------|------|------|------|
| **accent bar** | 1-2줄, 왼쪽 | 세션 고유 색상 바 (`▍`) — 프로젝트 디렉토리 + 브랜치 기반 결정적 색상 | claude-recall |
| **purpose** | 1줄, 왼쪽 | 세션 목적 — 첫 프롬프트에서 자동 감지, 또는 `/purpose`로 설정 | claude-recall |
| **branch** | 1줄, 오른쪽 | 현재 git branch | claude-recall |
| **model** | 1줄, 오른쪽 | 사용 중인 Claude 모델 (예: Opus) | Claude Code 빌트인 |
| **turn** | 2줄, 왼쪽 | 현재 프롬프트 번호 (`#12`) | claude-recall |
| **last prompt** | 2줄, 왼쪽 | 마지막으로 입력한 프롬프트 | claude-recall |
| **elapsed** | 2줄, 오른쪽 | 마지막 활동 이후 경과 시간 | claude-recall |
| **context%** | 2줄, 오른쪽 | 컨텍스트 윈도우 사용량 — 색상 코딩: 초록(<70%), 노랑(70-89%), 빨강(≥90%) | Claude Code 빌트인 |
| **cost** | 2줄, 오른쪽 | 누적 세션 비용 (컨텍스트 ≥ 90% 시 숨김) | Claude Code 빌트인 |
| **worktree** *(옵션)* | 1줄, 오른쪽 | 링크드 git 워크트리 안에서 `⎇ <이름>` 표시 | Claude Code 빌트인 |
| **rate_limits** *(옵션)* | 2줄, 오른쪽 | `5h:NN%` Claude.ai 사용 한도 (<50% 숨김) | Claude Code 빌트인 |

> [!TIP]
> 5회 이상 프롬프트를 입력하면 purpose 옆에 `(try /purpose)` 힌트가 나타납니다. `/purpose`를 실행하면 Claude가 대화 내용을 분석해서 더 정확한 목적을 제안합니다.

> [!WARNING]
> 컨텍스트 사용량이 **90% 이상**이 되면, 비용 표시 대신 빨간색 `⚠ try /handoff` 경고가 나타납니다. `/handoff`를 실행하면 핸드오프 요약이 파일로 저장되며, 새 세션에서 `@<경로>`로 참조해 이어서 작업할 수 있습니다.

## 주요 기능

- **자동 추적** — 설치만 하면 끝. 세션 시작, 프롬프트 입력, 세션 종료를 자동으로 기록
- **Auto-purpose** — 첫 프롬프트에서 세션 목적을 자동으로 잡아줌
- **스마트 purpose 갱신** — `/purpose`를 실행하면 대화 내용을 분석해서 AI가 목적을 제안
- **세션 고유 색상** — 프로젝트 디렉토리 + 브랜치 조합에 따라 세션별 고유한 accent 색상이 자동 부여되어, 텍스트를 읽기 전에 색상만으로 세션을 구분할 수 있음
- **컨텍스트 위기 경고** — 컨텍스트 사용량 90% 이상 시 HUD에 `⚠ try /handoff` 경고 표시
- **`/handoff` 힌트** — 컨텍스트가 70–89%에 도달하면 Line 1에 `(try /handoff)` 힌트 노출, 위기 직전에 핸드오프 명령 존재를 알려줌
- **세션 핸드오프** — `/handoff`가 `~/.claude/claude-recall/handoffs/`에 마크다운 파일로 요약을 저장, 세션이 종료돼도 자산이 유실되지 않음. 새 세션에서 `@<경로>`로 참조해 이어서 작업
- **턴 카운터** — 현재 몇 번째 프롬프트인지 표시 (`#1`, `#12`, `#50`)
- **빌트인 메트릭 통합** — Claude Code가 제공하는 모델, 컨텍스트%, 비용 정보를 함께 표시
- **HUD 커스터마이징** — `~/.claude/claude-recall/config.json`으로 표시할 요소 선택
- **컬러 테마** — `default`, `minimal`, `vivid` 3종 프리셋 지원
- **워크트리 인식** — `worktree` 슬롯을 활성화하면 링크드 git worktree 안에 있을 때 `⎇ <이름>` 표시
- **사용 한도 표시** — `rate_limits` 슬롯을 활성화하면 Claude.ai의 5시간 사용량을 표시 (<50% 숨김, 50–79% 노랑, ≥80% 빨강)
- **자동 정리** — 7일 이상 유휴 상태인 세션은 자동 삭제

> [!IMPORTANT]
> **4.x에서 업그레이드 시 주의:** v5.0에서 `/continue`와 `/export`가 제거되었습니다. 두 명령은 모두 `/handoff`로 통합되며, 이제 요약을 **파일로 저장**(이미 포화 상태인 채팅에 추가 출력하지 않음)합니다. Claude Code 네이티브 `/recap`과의 관계: `/recap`은 **계속 이어갈** 세션의 리마인드용, `/handoff`는 컨텍스트 한계로 **새 세션으로 이주**할 때의 자산 이관용 — 상호 보완적입니다.

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
> `/setup` 후 **Claude Code를 재시작**해야 statusline이 활성화됩니다.

## 사용법

설치 후에는 **자동으로 동작**합니다. 추가로 쓸 수 있는 명령어:

| 명령어 | 설명 |
|--------|------|
| `/purpose <텍스트>` | 세션 목적을 수동으로 설정 (자동 감지보다 우선) |
| `/purpose` | 대화 내용을 기반으로 목적 자동 제안 |
| `/handoff` | 핸드오프 요약을 `~/.claude/claude-recall/handoffs/`에 마크다운 파일로 저장. 새 세션에서 `@<경로>`로 참조 |
| `/setup` | statusline 재설정 / 설치 상태 확인 |

## 커스터마이징

`~/.claude/claude-recall/config.json` 파일을 생성하여 HUD를 설정할 수 있습니다:

```json
{
  "line1": ["purpose", "branch", "model"],
  "line2": ["turn", "prompt", "elapsed", "context", "cost"],
  "theme": "default"
}
```

- **line1** — 선택 가능: `purpose`, `branch`, `model`, `worktree`
- **line2** — 선택 가능: `turn`, `prompt`, `elapsed`, `context`, `cost`, `rate_limits`
- **theme** — `default` (시안/볼드), `minimal` (차분한, 색상 없음), `vivid` (밝은/고대비)

배열에서 요소를 제거하면 해당 항목이 숨겨집니다. 재시작 불필요 — 다음 statusline 렌더링 시 즉시 적용됩니다.

## 제거

```bash
# 1. 플러그인 제거
/plugin uninstall claude-recall@claude-recall

# 2. ~/.claude/settings.json 에서 "statusLine" 키 삭제 후 Claude Code 재시작

# 3. (선택) 세션 데이터 삭제
rm -rf ~/.claude/claude-recall/
```

<details>
<summary><strong>동작 방식</strong></summary>

**프롬프트를 입력할 때마다:**
→ 세션 목적, branch, 턴 수, 마지막 프롬프트를 자동 기록

**Claude가 응답할 때마다:**
→ 저장된 정보 + 모델/비용을 합쳐서 2줄 HUD로 표시 (100ms 이내)

**`/purpose` 실행 시:**
→ Claude가 대화 내용을 분석해서 간결한 목적을 제안

**`/handoff` 실행 시:**
→ Claude가 세션을 요약해서 `~/.claude/claude-recall/handoffs/{날짜}-{slug}.md` 파일로 저장합니다. 채팅에는 저장 경로만 표기되어 이미 포화 상태인 컨텍스트에 요약 본문이 추가되지 않으며, 파일은 세션이 종료돼도 그대로 남습니다. 새 세션을 열어 `@<경로>`를 입력하면 그대로 이어서 작업할 수 있습니다.

**세션 고유 색상:**
→ 각 세션은 프로젝트 디렉토리 + 브랜치 조합에 따라 고유한 색상 바(`▍`)를 부여받아, 텍스트를 읽기 전에 색상만으로 세션을 구분할 수 있음

**세션 시작 시:**
→ 7일 이상 유휴 상태인 세션은 자동으로 정리

모든 상태는 `~/.claude/claude-recall/sessions/`에 JSON 파일로 저장됩니다 — 세션당 하나, 플러그인 설치 경로와 분리. HUD 레이아웃과 테마는 `~/.claude/claude-recall/config.json`으로 설정 가능합니다.

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
