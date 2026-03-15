# claude-recall

Claude Code를 터미널 여러 개에서 동시에 돌리다 보면, 탭을 전환할 때마다 **"여기서 뭐 하고 있었지?"** 하는 순간이 옵니다.

claude-recall은 모든 Claude Code 세션의 맥락을 자동으로 추적해서, 전환하는 즉시 다시 집중할 수 있게 해줍니다.

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall statusline preview" width="720">
</p>

프롬프트 입력창 위에 항상 표시되는 2줄 요약:
- **1줄**: 이 세션이 뭘 하는 세션인지 (purpose) + branch + 경과 시간 + 모델 + 컨텍스트 사용량 + 비용
- **2줄**: 마지막으로 입력한 프롬프트

## 주요 기능

- **자동 추적** — 설치만 하면 끝. 세션 시작, 프롬프트 입력, 세션 종료를 자동으로 기록
- **Auto-purpose** — 첫 프롬프트에서 세션 목적을 자동으로 잡아줌
- **빌트인 메트릭 통합** — Claude Code가 제공하는 모델, 컨텍스트%, 비용 정보를 함께 표시
- **전체 세션 조회** — `claude-recall list`로 모든 세션 상태를 한 테이블에서 확인

```
 PURPOSE                          BRANCH        #  STATUS     ELAPSED
 Refactor auth middleware         feat/jwt      7  active     1h 23m
 결제 API 버그 수정                 fix/payment   3  active     45m
 테스트 커버리지 개선                main          2  completed  2d 5h
```

## 설치

```bash
# 1. 마켓플레이스 등록
/plugin marketplace add dkstm95/claude-recall

# 2. 플러그인 설치
/plugin install claude-recall@claude-recall

# 3. statusline 설정
/setup
```

설정 후 **Claude Code를 재시작**하면 statusline이 활성화됩니다.

## 사용법

설치 후에는 **자동으로 동작**합니다. 추가로 쓸 수 있는 명령어:

| 명령어 | 설명 |
|--------|------|
| `/purpose <텍스트>` | 세션 목적을 수동으로 설정 (자동 감지보다 우선) |
| `claude-recall list` | 터미널에서 모든 세션 현황 조회 |
| `/setup` | statusline 재설정 / 설치 상태 확인 |

<details>
<summary><strong>아키텍처</strong></summary>

```
Hooks (SessionStart / UserPromptSubmit / SessionEnd)
  → node dist/hooks/*.js
  → atomic write to ~/.claude/claude-recall/sessions/{session-id}.json

Statusline (<100ms)
  → node dist/statusline.js
  → reads state file + built-in JSON (model, cost, context%)
  → stdout: 2-line HUD

CLI
  → node dist/cli.js list
  → scans state files + PID liveness check
```

State 파일은 `~/.claude/claude-recall/sessions/`에 저장됩니다.

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
