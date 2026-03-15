<h1 align="center">claude-recall</h1>

<p align="center">
  <em>병렬 Claude Code 세션의 즉각적인 컨텍스트 복구</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue?style=flat-square" alt="version">
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

### HUD 구성 요소

프롬프트 입력창 위에 항상 표시되는 2줄 HUD:

| 요소 | 설명 | 출처 |
|------|------|------|
| **purpose** | 세션 목적 — 매 프롬프트마다 자동 갱신, 또는 `/purpose`로 수동 설정 | claude-recall |
| **branch** | 현재 git branch | claude-recall |
| **elapsed** | 마지막 활동 이후 경과 시간 | claude-recall |
| **model** | 사용 중인 Claude 모델 (예: Opus 4.6) | Claude Code 빌트인 |
| **context%** | 컨텍스트 윈도우 사용량 | Claude Code 빌트인 |
| **cost** | 누적 세션 비용 | Claude Code 빌트인 |
| **last prompt** | 마지막으로 입력한 프롬프트 (2줄째) | claude-recall |
| **last action** | Claude의 마지막 작업 — 예: `Edit: src/auth.ts` (2줄째, 오른쪽) | claude-recall |

## 주요 기능

- **자동 추적** — 설치만 하면 끝. 세션 시작, 프롬프트 입력, 세션 종료를 자동으로 기록
- **동적 purpose** — 매 프롬프트마다 purpose가 갱신되어 현재 작업을 반영
- **작업 추적** — Claude의 마지막 작업(파일 수정, 명령 실행)을 프롬프트 옆에 표시
- **컨텍스트 이탈 경고** — 세션 주제와 다른 프롬프트 입력 시 새 세션을 추천
- **빌트인 메트릭 통합** — Claude Code가 제공하는 모델, 컨텍스트%, 비용 정보를 함께 표시
- **전체 세션 조회** — `/list`로 모든 세션 상태를 한 테이블에서 확인
- **자동 정리** — 완료 후 7일 지난 세션은 자동 삭제

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

> [!IMPORTANT]
> `/setup` 후 **Claude Code를 재시작**해야 statusline이 활성화됩니다.

## 사용법

설치 후에는 **자동으로 동작**합니다. 추가로 쓸 수 있는 명령어:

| 명령어 | 설명 |
|--------|------|
| `/purpose <텍스트>` | 세션 목적을 수동으로 설정 (자동 감지보다 우선) |
| `/purpose` | 대화 내용을 기반으로 목적 자동 제안 |
| `/list` | 추적 중인 모든 세션 조회 |
| `/setup` | statusline 재설정 / 설치 상태 확인 |

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
→ 세션 목적, branch, 마지막 프롬프트를 자동 기록
→ 세션 주제와 다른 프롬프트가 감지되면 경고 표시

**Claude가 도구를 사용할 때마다 (Write, Edit, Bash):**
→ 마지막 작업이 기록되어 statusline에 표시

**Claude가 응답할 때마다:**
→ 저장된 정보 + 모델/비용을 합쳐서 2줄 HUD로 표시 (100ms 이내)

**`/list` 실행 시:**
→ 모든 세션 파일을 스캔해서 활성/비활성/완료 상태를 테이블로 출력

**세션 시작 시:**
→ 완료 후 7일 이상 지난 세션은 자동으로 정리

모든 상태는 `~/.claude/claude-recall/sessions/`에 JSON 파일로 저장됩니다 — 세션당 하나, 플러그인 설치 경로와 분리.

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
