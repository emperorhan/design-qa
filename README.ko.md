# @emperorhan/design-qa

[Claude Code](https://claude.ai/claude-code)를 위한 Figma → Storybook Design QA 툴킷.

`/design-qa <Component>` 명령 한 줄로 Figma 기준 디자인 QA를 자동 수행합니다.

## 필수 도구

| 도구 | 필수 | 설명 |
|------|------|------|
| [Claude Code](https://claude.ai/claude-code) | ✅ | AI 코딩 에이전트 |
| [React](https://react.dev/) | ✅ | UI 프레임워크 |
| [Storybook](https://storybook.js.org/) (React) | ✅ | 컴포넌트 개발 환경 |
| [agent-browser](https://www.npmjs.com/package/@anthropic-ai/agent-browser) | ✅ | 스크린샷 QA 도구 |
| [Figma](https://www.figma.com/) 데스크톱 앱 | 권장 | 디자인 소스 |
| [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) | 권장 | Figma ↔ Claude Code 연결 (토큰 불필요) |

## 설치

```bash
# 1. 프로젝트에 설치
pnpm add -D @emperorhan/design-qa
# 또는
npm install -D @emperorhan/design-qa

# 2. 프로젝트 초기화
npx @emperorhan/design-qa init

# 3. 환경 점검
npx @emperorhan/design-qa doctor
```

### init이 생성하는 파일

```
your-project/
├── designqa.config.ts              # 프로젝트 설정
├── src/stories/designQa.ts         # Figma ↔ Story 매핑 레지스트리
├── figma-refs/.gitkeep             # Figma 참조 이미지 저장소
└── .claude/skills/design-qa/
    └── SKILL.md                    # Claude Code 스킬 정의
```

### init 옵션

```bash
npx @emperorhan/design-qa init \
  --dir ./my-project \              # 프로젝트 디렉토리
  --tokens src/styles/tokens.css \  # CSS 토큰 파일 경로
  --skip-doctor \                   # 환경 점검 생략
  --force                           # 기존 파일 덮어쓰기
```

### doctor 점검 항목

```bash
npx @emperorhan/design-qa doctor
```

```
Design QA Doctor

  ✓ Claude Code — 설치됨
  ✓ agent-browser — 설치됨
  ✓ Storybook (React) — 설치됨
  ✓ React — 설치됨
  ✓ Figma MCP Bridge — 설정됨
  ✓ designqa.config.ts — 존재함
  ✓ Claude Skill (design-qa) — 등록됨
  ✓ Design Tokens CSS — src/styles/tokens.css 존재함

모든 필수 도구가 준비되었습니다!
```

### Figma MCP Bridge 설정

프로젝트 루트(또는 상위)에 `.mcp.json` 파일을 생성합니다. 이미 있으면 `mcpServers`에 추가:

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

> Figma 데스크톱 앱이 실행 중이어야 합니다. API 토큰은 불필요합니다.

## 사용법

### 1. Figma 매핑 등록

`src/stories/designQa.ts`에 스토리 ↔ Figma 노드를 등록:

```ts
export const DESIGN_QA_REGISTRY = {
  "Pages/HomePage.Default": {
    key: "Pages/HomePage.Default",
    title: "Pages/HomePage",
    exportName: "Default",
    figmaNodeId: "3366:255",  // Figma URL의 node-id (하이픈→콜론)
    figmaUrl: "https://www.figma.com/design/...",
    sourcePath: "src/pages/HomePage.stories.tsx",
  },
} as const satisfies Record<string, DesignQaEntry>;
```

### 2. 스토리에 래퍼 적용

```tsx
import { withRegisteredDesignQaStory } from "../stories/designQa";

export const Default: Story = withRegisteredDesignQaStory("Pages/HomePage.Default", {
  name: "홈 화면",
  render: () => <HomePage />,
});
```

### 3. Claude Code에서 QA 실행

```bash
/design-qa HomePage      # 단일 컴포넌트 QA
/design-qa LoginPage     # 다른 컴포넌트
/design-qa all           # 전체 등록된 페이지
```

## 동작 방식

```
/design-qa HomePage
    │
    ├─ 1. designqa.config.ts 읽기 (토큰 경로, 레지스트리 경로)
    ├─ 2. designQa.ts에서 Figma 노드 ID 조회
    ├─ 3. Figma MCP Bridge로 디자인 스펙 추출 (spacing, color, typography)
    ├─ 4. 코드와 Figma 비교 → mismatch 목록 (Spec/Visual/State)
    ├─ 5. High severity 자동 수정
    ├─ 6. Storybook + agent-browser로 렌더링 검증
    └─ 7. pass/fail 판정 (루프 반복)
```

## API

### Storybook 헬퍼

```ts
import { withDesignQaStory, toStorybookId } from "@emperorhan/design-qa/storybook";
import type { DesignQaEntry } from "@emperorhan/design-qa/storybook";
```

### Config 타입

```ts
import type { DesignQaConfig } from "@emperorhan/design-qa/config";
```

## 팀 가이드

일상 워크플로우 가이드: [TEAM_GUIDE.ko.md](./TEAM_GUIDE.ko.md)

[English Guide](./TEAM_GUIDE.md)

## 라이선스

MIT
