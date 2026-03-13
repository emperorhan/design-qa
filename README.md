# @emperorhan/design-qa

`@emperorhan/design-qa`는 Figma 또는 screenshot에서 디자인 신호를 수집하고, Storybook 기반 UI를 생성한 뒤, `agent-browser`와 평가 루프로 자동 보정하는 프론트엔드 디자인 QA 패키지다.

## Installation

두 가지 설치 방식을 지원한다.

### 권장: 타겟 프론트엔드 레포에 로컬 설치

```bash
pnpm add -D @emperorhan/design-qa
```

그 다음 레포 루트에서 실행한다.

```bash
npx design-qa init
npx design-qa doctor
```

또는 `package.json` script로 감싸서 사용한다.

```json
{
  "scripts": {
    "design:qa:doctor": "design-qa doctor",
    "design:qa:ingest": "design-qa ingest hybrid --figma <url> --screenshot <path>",
    "design:qa:generate": "design-qa generate storybook",
    "design:qa:eval": "design-qa eval",
    "design:qa:fix": "design-qa fix",
    "design:qa:loop": "design-qa loop --max-iterations 5"
  }
}
```

### 대안: 글로벌 설치

```bash
npm i -g @emperorhan/design-qa
```

그 다음 타겟 레포 루트로 이동해서 실행하거나, `--repo`로 레포 경로를 지정한다.

```bash
design-qa init --repo ./apps/web
design-qa doctor --repo ./apps/web
```

실무 기본 권장은 글로벌보다 로컬 설치다. 이유는 설정 파일, generated artifact, Storybook, registry가 모두 타겟 레포에 귀속되기 때문이다.

## Quick Start For A Host Frontend Repo

### 1. 타겟 레포 초기화

레포 루트에서:

```bash
design-qa init
```

다른 위치에서 특정 레포를 지정하려면:

```bash
design-qa init --repo ./apps/web
```

`init`은 기본적으로 기존 파일을 덮어쓰지 않는다. 다시 생성하려면:

```bash
design-qa init --repo ./apps/web --force
```

생성 파일:

- `designqa.config.ts`
- `src/stories/designQa.ts`
- `AGENTS.md`
- `CLAUDE.md`
- `codex_prompt.md`
- `.design-qa/README.md`

### 2. 환경과 wiring 확인

```bash
design-qa doctor
```

또는:

```bash
design-qa doctor --repo ./apps/web
```

### 3. 디자인 source ingest

Figma:

```bash
design-qa prepare-figma-collection
design-qa validate-dataset
design-qa ingest figma <url-or-node>
```

Screenshot:

```bash
design-qa ingest screenshot ./reference.png
```

Hybrid:

```bash
design-qa ingest hybrid --figma <url-or-node> --screenshot ./reference.png
```

### 4. Storybook scaffold 생성

```bash
design-qa generate storybook
```

### 5. 시각 평가 실행

```bash
design-qa eval
```

### 6. Codex / Claude Code에 semantic review 위임

아래 파일을 읽게 하면 된다.

- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`

에이전트는 결과를 아래 파일에 JSON 배열로 써야 한다.

- `.design-qa/semantic-eval.output.json`

patch 수행은 아래 파일을 기준으로 한다.

- `.design-qa/patch-plan.json`
- `.design-qa/patch-prompt.md`

의미:

- dataset phase는 `.design-qa/figma/*`만 쓴다
- patch phase는 source file만 수정한다
- generated artifacts는 읽기 전용 컨텍스트다

그 다음 다시:

```bash
design-qa eval --report-only
design-qa fix
```

또는 반복 루프:

```bash
design-qa loop --max-iterations 5
```

## Icon Dataset

아이콘은 일반 node나 screenshot 안에 묻어두지 말고 별도 dataset으로 관리하는 것을 권장한다.

권장 파일:

- `.design-qa/figma/icons.json`
- `.design-qa/figma/icons/*.svg`

예시:

```json
[
  {
    "id": "icon-download-16",
    "name": "download",
    "nodeId": "123:457",
    "variant": "line",
    "semanticRole": "action/download",
    "svgPath": ".design-qa/figma/icons/icon-download-16.svg",
    "usage": ["Pages/Example.Default"],
    "libraryCandidate": "download",
    "viewport": { "width": 16, "height": 16 },
    "background": {
      "hasFill": false,
      "fillColor": null
    }
  }
]
```

`design-qa generate storybook`은 icons dataset이 있으면 다음을 수행한다.

- raw SVG를 정규화
- 루트 `width`/`height` 제거
- `viewBox` 유지 또는 복원
- 하드코딩 배경 rect 제거
- 하드코딩 색상을 `currentColor`로 치환
- 반응형 React 아이콘 컴포넌트를 `icons.generated.tsx`로 생성

따라서 generated icon은 기본적으로:

- 배경 투명
- `size="1em"` 기반
- 부모 텍스트 색을 따름

즉 기존 제품 배경과 충돌하지 않고, 반응형 레이아웃 안에서 고정 폭/고정 높이로 굳지 않도록 설계된다.

## Figma Dataset Workflow

팀 파일럿에서는 direct MCP보다 `agent-prepared dataset`을 권장한다.

권장 순서:

1. `design-qa prepare-figma-collection`
2. Codex 또는 Claude Code가 native Figma MCP로 `.design-qa/figma/collection-plan.json`의 항목을 채운다.
3. `design-qa validate-dataset`
4. 실패하면 `design-qa dataset-fix`
5. 호스트 에이전트가 `.design-qa/dataset-fix.json`과 `.design-qa/dataset-fix-prompt.md`를 읽고 dataset를 보완한다.
6. `design-qa ingest figma`

`prepare-figma-collection`은 실제 dataset 상태를 읽어 각 항목을 `pending`, `ready`, `partial`, `collected`, `invalid`로 표시한다.
각 항목은 `collectionItemId`, `phase`, `recommendedAction`도 함께 제공한다.

collection plan은 최소 단위와 제품 레벨 단위를 함께 잡는다.

- 최소 단위:
  - favicon
  - OG image
  - typography
  - color
  - spacing
  - evaluation baseline
- 제품 레벨:
  - icons
  - Header
  - Footer
  - StatusPanel
  - Button
  - RadioBox
  - Input
  - Card
  - Modal
  - Tabs
  - Table
  - pages from the story registry

공식 dataset 파일:

- `.design-qa/figma/context.json`
- `.design-qa/figma/nodes.json`
- `.design-qa/figma/tokens.json`
- `.design-qa/figma/components.json`
- `.design-qa/figma/icons.json`
- `.design-qa/figma/manifest.json`

asset 규약:

- `.design-qa/figma/assets/favicon.svg|png|ico`
- `.design-qa/figma/assets/favicon.background.json`
- `.design-qa/figma/assets/og-image.png|jpg|jpeg`
- `.design-qa/figma/assets/og-image.background.json`

선택 파일:

- `.design-qa/figma/screenshots/<node-id>.png`
- `.design-qa/figma/code-connect.json`
- `.design-qa/figma/constraints.json`
- `.design-qa/figma/typography-runs.json`

## Common CLI Pattern

대부분의 명령은 현재 디렉터리를 타겟 레포로 본다.  
어느 위치에서든 타겟 레포를 지정하려면 `--repo <path>`를 쓴다.

```bash
design-qa doctor --repo ./apps/web
design-qa eval --repo ./apps/web
design-qa fix --repo ./apps/web
```

지원 명령:

```bash
design-qa validate [--repo <path>]
design-qa validate-dataset [--repo <path>]
design-qa dataset-fix [--repo <path>]
design-qa doctor [--repo <path>]
design-qa ingest <figma|screenshot|hybrid> [...] [--repo <path>]
design-qa generate storybook [--repo <path>]
design-qa eval [--repo <path>]
design-qa fix [--repo <path>]
design-qa loop [--repo <path>]
design-qa report [--repo <path>]
design-qa init [--repo <path>] [--force]
```

## Environment

환경변수는 `필수`, `선택`, `에이전트 위임용`으로 나뉜다.

### 필수

현재 v1 기준으로 “항상 필요한” 환경변수는 없다.

대신 모드별 런타임 요구사항이 있다.

- Figma ingest의 권장 경로는 host agent가 native Figma MCP로 dataset를 준비하는 것이다
- live MCP bridge는 dataset가 없을 때만 fallback으로 사용한다
- browser eval을 쓰려면 `agent-browser`가 설치되어 있어야 한다
- Storybook 기반 비교를 하려면 Storybook이 실행 가능해야 한다

### 선택

`DESIGN_QA_MCP_BRIDGE_URL`

- 기본값: `ws://localhost:1994/ws`
- legacy fallback MCP bridge 주소를 덮어쓴다

예:

```bash
export DESIGN_QA_MCP_BRIDGE_URL=ws://localhost:1994/ws
```

`DESIGN_LOOP_AUTOFIX_CMD`

- `design-qa loop`에서 자동 수정 커맨드를 사용할 때만 필요하다

예:

```bash
export DESIGN_LOOP_AUTOFIX_CMD="codex exec < .design-qa/fix-prompt.md"
```

### 에이전트 위임용

semantic eval은 환경변수보다 파일 계약이 더 중요하다.

입력:

- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`

출력:

- `.design-qa/semantic-eval.output.json`

Codex나 Claude Code는 위 입력 파일을 읽고, 출력 파일을 JSON 배열로 작성하면 된다.

Figma dataset도 같은 방식으로 agent contract를 가진다.

- Codex / Claude Code는 native Figma MCP로 `.design-qa/figma/*`를 작성
- `design-qa validate-dataset`이 completeness를 검증
- `design-qa dataset-fix`가 repair JSON과 prompt를 생성

## Consumer Config

타겟 레포 루트에 `designqa.config.ts`를 둔다.

```ts
export default {
  mode: "hybrid",
  storybookUrl: "http://127.0.0.1:6006",
  threshold: 90,
  reportDir: ".design-qa",
  storyRoot: "src",
  registryModule: "src/stories/designQa.ts",
  generation: {
    outDir: ".design-qa/generated",
    emitAgentDocs: true,
  },
  evaluation: {
    visualThreshold: 90,
    semantic: {
      enabled: true,
      severityThreshold: "medium",
      outputFile: ".design-qa/semantic-eval.output.json",
    },
  },
  tokenSourcePaths: ["src/styles/tokens.ts"],
  cache: {
    figma: {
      preferLive: true,
    },
  },
};
```

## Registry Entry

```ts
export const DESIGN_QA_REGISTRY = {
  "Pages/LoginPage.Default": {
    key: "Pages/LoginPage.Default",
    title: "Pages/LoginPage",
    exportName: "Default",
    sourcePath: "src/pages/LoginPage.stories.tsx",
    sourceType: "hybrid",
    figmaNodeId: "3359:610",
    figmaUrl: "https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=3359-610",
    screenshotPath: "figma-refs/screens/login-default.png",
    referencePath: "figma-refs/screens/login-default.png",
    designIrId: "login-page-default",
    evaluationProfile: "default",
  },
} as const;
```

기존 `figmaNodeId`/`figmaUrl`만 있는 entry는 자동으로 `figma` source로 해석된다.

## Generated Files

기본 출력 위치:

- `.design-qa/design-ir.json`
- `.design-qa/eval-report.json`
- `.design-qa/fix-prompt.md`
- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`
- `.design-qa/semantic-eval.output.json`
- `.design-qa/generated/tokens.generated.ts`
- `.design-qa/generated/components.generated.tsx`
- `.design-qa/generated/stories.generated.tsx`
- `.design-qa/generated/registry.generated.json`
- `.design-qa/generated/icons.generated.tsx`
- `.design-qa/generated/icons/*.svg`
- `.design-qa/dataset-validation.json`
- `.design-qa/dataset-validation.md`
- `.design-qa/dataset-fix.json`
- `.design-qa/dataset-fix-prompt.md`
- `.design-qa/patch-plan.json`
- `.design-qa/patch-prompt.md`

`patch-plan.json` story 항목에는 다음이 포함된다.

- `primaryTargetFile`
- `secondaryTargetFiles`
- `tokenTargetFiles`
- `readonlyContextFiles`
- `referenceArtifacts`
- `semanticStatus`

## Runtime Notes

- Storybook URL은 환경변수보다 `designqa.config.ts`에서 관리하는 것을 기본 원칙으로 둔다.
- `doctor`는 MCP bridge, Storybook, `agent-browser`, semantic artifact 상태를 함께 점검한다.
- 글로벌 설치를 쓰더라도 파일 출력은 항상 타겟 프론트엔드 레포 안에 쓴다.
- 현재 패키지는 one-shot code generator보다 반복 보정형 시스템으로 설계되어 있다.
