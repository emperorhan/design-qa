# Design QA 팀 가이드

Claude Code + Figma + Storybook 기반 디자인 QA 워크플로우.

## 사전 준비 (1회만)

### 1. 도구 설치

```bash
# agent-browser (스크린샷 QA용)
npm install -g @anthropic-ai/agent-browser

# 프로젝트에 패키지 설치
pnpm add -D @emperorhan/design-qa

# 초기화 (config, skill, registry 자동 생성)
npx @emperorhan/design-qa init

# 환경 점검
npx @emperorhan/design-qa doctor
```

모든 항목이 ✓ 이면 준비 완료:

```
  ✓ Claude Code
  ✓ agent-browser
  ✓ Storybook (React)
  ✓ React
  ✓ Figma MCP Bridge
  ✓ designqa.config.ts
  ✓ Claude Skill (design-qa)
  ✓ Design Tokens CSS
```

### 2. Figma MCP Bridge 설정

프로젝트 루트(또는 상위)의 `.mcp.json`에 추가합니다. 파일이 이미 있으면 `mcpServers`에 `figma-bridge`를 추가:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "npx",
      "args": ["-y", "@gethopp/figma-mcp-bridge"]
    }
  }
}
```

> API 토큰 불필요. Figma 데스크톱 앱이 실행 중이어야 합니다.

---

## 일상 작업 플로우

### Step 1. 아이콘 준비

Figma에서 사용할 아이콘을 SVG로 export하여 아이콘 디렉토리(예: `src/assets/icons/`)에 저장합니다.

> Claude가 SVG를 자동 정규화합니다: width/height 제거, fill→`currentColor` 변환, viewBox 보장.

### Step 2. Figma 데스크톱 앱 열기

1. Figma 데스크톱 앱을 실행합니다
2. 작업할 디자인 파일을 엽니다
3. 구현할 페이지/프레임을 선택합니다

### Step 3. Storybook 실행

```bash
pnpm storybook
```

### Step 4. Claude Code에서 Design QA 실행

```bash
# Claude Code 시작 (init 직후에는 재시작 필요)
claude
```

#### 단일 페이지 QA

```
/design-qa LoginPage
```

#### 전체 페이지 순차 QA

```
Figma의 모든 페이지에 대해서 순차적으로 design-qa 해줘
```

#### 새 페이지 구현 + QA

```
Figma에 있는 SettingsPage를 구현하고 design-qa 해줘
```

---

## Claude가 하는 일

`/design-qa` 명령을 실행하면 Claude가 자동으로:

1. **Figma 스펙 추출** — MCP Bridge로 spacing, color, typography 값을 읽음
2. **코드 비교** — 현재 구현과 Figma 스펙의 차이를 분석
3. **자동 수정** — High severity mismatch를 코드에서 수정
4. **Storybook 검증** — agent-browser로 스크린샷 촬영 후 비교
5. **결과 리포트** — pass/fail 판정 + 수정 내역 출력

### 결과 형식

```
### Plan
LoginPage YubiKey 연결 상태 QA

### Findings
**Spec mismatch**
- StatusBadge padding: 8px → 10px 16px

### Changes
- `src/components/StatusBadge.tsx` — padding 수정

### QA Result
**pass**

### Remaining Risk
없음
```

---

## 새 컴포넌트 추가

### 1. Figma 노드 ID 확인

Figma URL에서 `node-id` 파라미터를 찾습니다:

```
https://www.figma.com/design/abc123/...?node-id=3366-255
                                                ^^^^^^^^
                                                3366:255 (하이픈→콜론)
```

### 2. 레지스트리에 등록

`src/stories/designQa.ts`에 매핑을 추가합니다:

```ts
"Pages/NewPage.Default": {
  key: "Pages/NewPage.Default",
  title: "Pages/NewPage",
  exportName: "Default",
  figmaNodeId: "3366:255",
  figmaUrl: "https://www.figma.com/design/abc123/...?node-id=3366-255",
  sourcePath: "src/pages/NewPage.stories.tsx",
},
```

### 3. 스토리에 래퍼 적용

```tsx
export const Default: Story = withRegisteredDesignQaStory("Pages/NewPage.Default", {
  name: "기본 상태",
  render: () => <NewPage />,
});
```

### 4. QA 실행

```
/design-qa NewPage
```

---

## 규칙

| 규칙 | 설명 |
|------|------|
| Storybook 먼저 | 스토리가 1차 결과물, 앱 통합은 2차 |
| 1 스토리 = 1 Figma 노드 | 상태별로 분리 (Default, Error, Loading 등) |
| 토큰 사용 | CSS 변수 사용, 하드코딩 금지 |
| 아이콘은 수동 | Figma에서 SVG export → 아이콘 디렉토리 (Claude가 정규화) |
| Figma 앱 열기 | MCP Bridge가 데스크톱 앱에 직접 연결 |

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| Figma 노드를 못 읽음 | Figma 데스크톱 앱이 열려 있는지 확인 |
| Storybook 접속 안됨 | `pnpm storybook` 실행 확인 |
| agent-browser 에러 | `npm i -g @anthropic-ai/agent-browser` 재설치 |
| 스킬이 안 보임 | `init` 후 Claude Code 재시작 |
| doctor 실패 | `npx @emperorhan/design-qa doctor`로 누락 항목 확인 |
