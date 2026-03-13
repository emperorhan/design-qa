# @emperorhan/design-qa

`@emperorhan/design-qa`는 Figma 또는 screenshot에서 디자인 신호를 수집하고, React + Storybook 기반 UI 작업을 평가하며, host agent가 활용할 수 있는 artifact와 machine-readable 결과를 제공하는 프론트엔드 디자인 QA toolkit입니다.

이 패키지는 React 프론트엔드 앱과 React Storybook 위에서 동작합니다. 앱이나 Storybook을 대신 만들지는 않으며, 직접 코드를 수정하는 에이전트도 아닙니다. 대신 호스트 LLM 에이전트가 호출하는 tool/package 역할을 맡습니다.

## 시작 전

아래 조건이 먼저 필요합니다.

- 실제 프론트엔드 앱 레포
- 실행 가능한 React Storybook
- Figma 경로를 쓸 경우 Codex 또는 Claude Code의 native Figma MCP
- 시각 평가를 쓸 경우 `agent-browser`

빈 디렉토리에서는 바로 동작하지 않습니다. 먼저 React 앱과 React Storybook을 준비합니다.

```bash
pnpm create vite my-app --template react-ts
cd my-app
pnpm install
npx storybook@latest init
pnpm add -D @emperorhan/design-qa
```

## 설치

```bash
pnpm add -D @emperorhan/design-qa
npx design-qa init
npx design-qa doctor
```

글로벌 설치도 가능하지만 기본 권장은 레포 로컬 설치입니다.

```bash
npm i -g @emperorhan/design-qa
design-qa init --repo ./apps/web
design-qa doctor --repo ./apps/web
```

## Agent Workflow

호스트 에이전트 기준 기본 흐름은 아래 세 단계입니다.

```bash
npx design-qa collect --json
npx design-qa generate --json
npx design-qa eval --json
```

- `collect`: Figma dataset 준비 상태 점검, collection plan 동기화, agent task 생성
- `generate`: IR와 generated React Storybook scaffold 생성
- `eval`: deterministic/visual 평가와 patch artifact 생성

이후 patch는 `design-qa`가 직접 하지 않습니다. 호스트 에이전트가 `.design-qa/patch-plan.json`과 `.design-qa/patch-prompt.md`를 읽고 source file을 수정한 뒤 `eval`을 다시 호출합니다.

`loop`는 편의 명령으로 남아 있지만, 공식적인 agent workflow는 `eval -> patch with host agent -> eval` 반복입니다.

## Agent Runbook

호스트 LLM 에이전트는 아래 사용자 요청을 직접 처리할 수 있어야 합니다.

> `@emperorhan/design-qa를 이용해서 figma desktop mcp 주소로부터 데이터를 가져와서 storybook을 만들고 design qa 루프를 통해 UI 개발을 완성해줘`

이 요청을 받으면 에이전트는 아래 순서로 움직입니다.

1. React app + React Storybook host인지 확인합니다.
2. `design-qa doctor`로 현재 레포 상태를 점검합니다.
3. Figma dataset 수집에 필요한 입력이 충분한지 확인합니다.
4. 부족한 Figma 정보만 사용자에게 요청합니다.
5. `design-qa collect --json`으로 dataset planning artifact를 생성합니다.
6. native Figma MCP로 `.design-qa/figma/*`를 채웁니다.
7. `design-qa validate-dataset --json`으로 dataset를 검증합니다.
8. `design-qa generate --json`으로 React Storybook scaffold를 생성합니다.
9. Storybook을 실행하고 `design-qa eval --json`로 평가합니다.
10. `.design-qa/patch-plan.json`과 `.design-qa/patch-prompt.md`를 읽고 source file을 수정합니다.
11. `design-qa eval --report-only --json`를 반복해서 threshold를 맞춥니다.

### 에이전트가 먼저 확인할 것

- 레포가 React host인지
- Storybook이 React framework인지
- `agent-browser`가 설치되어 있는지
- Figma desktop MCP가 열려 있는지
- 이미 `.design-qa/figma/*` dataset가 있는지

### 에이전트가 사용자에게 물어봐야 하는 경우

아래 정보가 없으면 에이전트가 사용자에게 요청해야 합니다.

- Figma desktop MCP 주소
  - 기본값은 `http://127.0.0.1:3845/mcp`입니다
  - 다른 주소를 쓰면 사용자가 알려줘야 합니다
- 대상 Figma 파일 또는 페이지 범위
  - file link
  - page name
  - frame link
  - node id
- 어떤 UI 범위를 먼저 완성할지
  - 전체 앱
  - 특정 페이지
  - 특정 컴포넌트
- Storybook이 아직 없거나 깨져 있으면
  - 현재 호스트가 React Storybook으로 갈 수 있는지

에이전트는 이미 레포와 dataset에서 추론 가능한 정보는 다시 묻지 않습니다. 정말 필요한 Figma 범위와 접속 정보만 요청해야 합니다.

### 에이전트가 물으면 안 되는 것

- 이미 `designqa.config.ts`에 있는 값
- 이미 `.design-qa/figma/manifest.json`에 있는 값
- 이미 registry에 있는 story/source mapping
- 단순히 실행해보면 알 수 있는 상태

### 에이전트가 수정하면 안 되는 것

- generated artifact를 source of truth처럼 직접 수정하면 안 됩니다
- patch는 source story/component/token file에만 적용해야 합니다
- `.design-qa/*`는 운영 artifact이며, dataset phase 외에는 임의 수정하지 않습니다

## CLI And API

`design-qa`는 CLI와 package API를 둘 다 제공합니다. 권장 주체는 호스트 에이전트입니다.

CLI:

```bash
npx design-qa collect --json
npx design-qa generate --json
npx design-qa eval --json
```

API:

```ts
import {
  collectDesignQa,
  generateDesignQa,
  evaluateDesignQa,
  validateDesignQaDataset,
  inspectDesignQaDataset,
} from "@emperorhan/design-qa";

const collectResult = await collectDesignQa({ cwd: process.cwd(), args: ["--agent", "codex"] });
const generateResult = await generateDesignQa({ cwd: process.cwd() });
const evalResult = await evaluateDesignQa({ cwd: process.cwd(), args: ["--report-only"] });
```

핵심 명령은 `--json`을 지원하며 아래 구조를 반환합니다.

```json
{
  "ok": true,
  "summary": "human-readable summary",
  "data": {},
  "artifacts": [],
  "warnings": [],
  "errors": [],
  "nextActions": []
}
```

호스트 에이전트는 text 출력이 아니라 `--json` 결과를 기준으로 다음 행동을 결정하는 것이 좋습니다.

### 1. 레포 초기화와 점검

```bash
npx design-qa init
npx design-qa doctor
```

`storybook not reachable`가 나오면 먼저 레포의 Storybook setup을 끝내야 합니다.

`doctor`는 이제 아래 항목도 함께 진단합니다.

- Storybook script 존재 여부
- Storybook package major/version 조합
- React Storybook framework package 존재 여부
- Storybook 포트가 실제로 열려 있는지
- collection-plan과 current registry의 정합성

`@storybook/html-vite` 같은 non-React Storybook framework는 generated Design QA story와 호환되지 않습니다. 이 경우 `generate`는 실패해야 정상입니다.

### 2. collect

가장 간단한 형태는 아래와 같습니다.

```bash
npx design-qa collect --agent codex
```

`collect`는 아래 작업을 묶어서 수행합니다.

- collection plan 갱신
- dataset agent task 생성
- manifest 안전 필드 자동 동기화
- 현재 dataset source/depth/export 상태 요약

그 다음 Codex 또는 Claude Code가 native Figma MCP로 `.design-qa/figma/*`를 채웁니다.

직접 세부 명령을 쓰고 싶다면 아래 순서를 사용할 수 있습니다.

```bash
npx design-qa prepare-figma-collection
npx design-qa export-agent-task figma-dataset --agent codex
npx design-qa detect-figma-source
npx design-qa validate-dataset
npx design-qa inspect-dataset
```

### 3. generate

```bash
npx design-qa generate
npx design-qa normalize-icons
```

기본 생성 위치는 `src/generated/design-qa`입니다. 생성 결과는 타겟 레포 source tree 안에 들어가며, React Storybook과 source code에서 바로 참조할 수 있는 위치를 기본값으로 사용합니다.

다만 generated 파일은 참고용 scaffold입니다. 실제 렌더와 최종 patch 대상은 여전히 레포의 source story/component입니다.

`generate`는 React-first입니다. React와 React Storybook framework가 없는 레포에서는 생성하지 않습니다.

Figma dataset를 기준으로 생성하려면 `collect` 이후 `generate`를 실행합니다. Screenshot 또는 hybrid는 필요하면 아래처럼 직접 ingest 할 수 있습니다.

```bash
npx design-qa ingest screenshot ./reference.png
npx design-qa ingest hybrid --figma <url-or-node> --screenshot ./reference.png
npx design-qa generate
```

### 4. patch 반복

```bash
pnpm storybook
npx design-qa eval --json
```

호스트 에이전트는 아래 artifact를 읽고 patch를 수행합니다.

- `.design-qa/eval-report.json`
- `.design-qa/patch-plan.json`
- `.design-qa/patch-prompt.md`
- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`

세부 단계를 직접 다루고 싶다면 아래 명령을 사용할 수 있습니다.

```bash
npx design-qa eval --json
npx design-qa export-agent-task patch --agent codex
npx design-qa eval --report-only --json
npx design-qa fix
```

호스트 에이전트가 source file을 수정한 뒤 `eval`을 다시 실행합니다. 이 반복이 실제 폐쇄 루프입니다.

## 운영 규칙

- remote MCP asset wrapper는 성공적인 SVG export가 아닙니다
- SVG asset이 필요하면 desktop MCP localhost export를 우선 사용합니다
- page dataset은 `shallow`, `nested`, `full-canvas`로 판정합니다
- 아이콘은 raw export와 normalized output을 분리 추적합니다
- generated artifact는 참고용이며, patch 대상은 source file입니다
- generated scaffold는 React Storybook host를 전제로 합니다
- CLI는 thin wrapper이며, package API와 `--json` 결과가 host agent integration의 기본 경로입니다

## 검증 모드

`design-qa`는 `minimal`과 `strict` 두 가지 검증 모드를 지원합니다.

- `minimal`
  - 작업용 story와 진행 중인 dataset에 맞는 기본 모드입니다
  - screenshot/reference 누락을 바로 hard fail로 보지 않습니다
  - 초기 연결과 반복 작업에 적합합니다
- `strict`
  - production-grade dataset 검증용 모드입니다
  - screenshot 같은 reference artifact도 엄격하게 요구합니다
  - 릴리스 전 최종 점검에 적합합니다

기본값은 `minimal`입니다.

## Icon Dataset

아이콘은 일반 node나 screenshot 안에 묻어두지 말고 별도 dataset으로 관리하는 것을 권장합니다.

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

`design-qa generate storybook`은 icons dataset이 있으면 다음을 수행합니다.

- raw SVG를 정규화
- 루트 `width`/`height` 제거
- `viewBox` 유지 또는 복원
- 하드코딩 배경 rect 제거
- 하드코딩 색상을 `currentColor`로 치환
- 반응형 React 아이콘 컴포넌트를 `icons.generated.tsx`로 생성

따라서 generated icon은 기본적으로 아래 특성을 가집니다.

- 배경 투명
- `size="1em"` 기반
- 부모 텍스트 색을 따름

즉 기존 제품 배경과 충돌하지 않고, 반응형 레이아웃 안에서 고정 폭이나 고정 높이로 굳지 않도록 설계합니다.

dataset phase에서 icon SVG를 수집할 때도 같은 규칙을 따릅니다.

- 최종 계약에서 root `width`/`height`를 고정값으로 의존하지 않는다
- `viewBox`를 유지하거나 복원한다
- 실제 icon path의 `fill`/`stroke`는 가능한 `currentColor`로 정규화한다
- 의미 없는 background rect/fill은 제거한다
- 배경이 의미 있으면 icon 자체가 아니라 background guidance로 분리한다

## Figma Dataset Workflow

팀 파일럿에서는 direct MCP보다 `agent-prepared dataset`을 권장합니다.

권장 순서:

1. `design-qa prepare-figma-collection`
2. `design-qa export-agent-task figma-dataset --agent codex` 또는 `--agent claude`
3. Codex 또는 Claude Code가 native Figma MCP로 `.design-qa/figma/collection-plan.json`의 항목을 채웁니다.
4. `design-qa detect-figma-source`
5. `design-qa validate-dataset`
6. 실패하면 `design-qa dataset-fix`
7. 호스트 에이전트가 `.design-qa/dataset-fix.json`과 `.design-qa/dataset-fix-prompt.md`를 읽고 dataset를 보완합니다.
8. `design-qa inspect-dataset`
9. `design-qa ingest figma`

`prepare-figma-collection`은 실제 dataset 상태를 읽어 각 항목을 `pending`, `ready`, `partial`, `collected`, `invalid`로 표시합니다.
각 항목은 `collectionItemId`, `phase`, `recommendedAction`도 함께 제공합니다.

registry가 바뀌면 `validate-dataset` 실행 시 manifest와 collection plan이 자동 동기화됩니다.

host agent에 바로 넘길 task artifact를 만들려면 아래 명령을 사용합니다.

```bash
design-qa export-agent-task figma-dataset --agent codex
design-qa export-agent-task patch --agent codex
```

운영 규칙:

- remote MCP asset wrapper는 성공적인 SVG export가 아닙니다
- SVG asset이 필요하면 desktop MCP localhost export를 우선 사용합니다
- page dataset은 `shallow`, `nested`, `full-canvas` 수준으로 판정합니다
- 아이콘은 raw export와 normalized output을 분리 추적합니다
- `design-qa normalize-icons`로 normalized SVG를 생성할 수 있습니다
- host Storybook은 React framework여야 합니다

collection plan은 최소 단위와 제품 레벨 단위를 함께 다룹니다.

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

대부분의 명령은 현재 디렉터리를 타겟 레포로 봅니다.  
어느 위치에서든 타겟 레포를 지정하려면 `--repo <path>`를 사용합니다.

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
design-qa detect-figma-source [--repo <path>]
design-qa inspect-dataset [--repo <path>]
design-qa normalize-icons [--repo <path>]
design-qa export-agent-task <figma-dataset|patch> [--agent <codex|claude|generic>] [--story <name>] [--repo <path>]
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

환경변수는 `필수`, `선택`, `에이전트 위임용`으로 나뉩니다.

### 필수

현재 v1 기준으로 “항상 필요한” 환경변수는 없습니다.

대신 모드별 런타임 요구사항이 있습니다.

- Figma ingest의 권장 경로는 host agent가 native Figma MCP로 dataset를 준비하는 것이다
- live MCP bridge는 dataset가 없을 때만 fallback으로 사용한다
- browser eval을 쓰려면 `agent-browser`가 설치되어 있어야 한다
- Storybook 기반 비교를 하려면 Storybook이 실행 가능해야 한다
- Storybook 패키지는 framework package와 major version이 맞아야 합니다

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

semantic eval은 환경변수보다 파일 계약이 더 중요합니다.

입력:

- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`

출력:

- `.design-qa/semantic-eval.output.json`

Codex나 Claude Code는 위 입력 파일을 읽고, 출력 파일을 JSON 배열로 작성하면 됩니다.

Figma dataset도 같은 방식으로 agent contract를 가집니다.

- Codex / Claude Code는 native Figma MCP로 `.design-qa/figma/*`를 작성
- `design-qa validate-dataset`이 completeness를 검증
- `design-qa dataset-fix`가 repair JSON과 prompt를 생성

## Consumer Config

타겟 레포 루트에 `designqa.config.ts`를 둡니다.

```ts
export default {
  mode: "hybrid",
  storybookUrl: "http://127.0.0.1:6006",
  threshold: 90,
  reportDir: ".design-qa",
  storyRoot: "src",
  registryModule: "src/stories/designQa.ts",
  generation: {
    outDir: "src/generated/design-qa",
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
  validation: {
    mode: "minimal",
    autoSyncManifest: true,
    autoSyncCollectionPlan: true,
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

기존 `figmaNodeId`/`figmaUrl`만 있는 entry는 자동으로 `figma` source로 해석합니다.

`validate`는 다음 story 파일 패턴을 모두 검사합니다.

- `*.stories.ts`
- `*.stories.tsx`
- `*.stories.js`
- `*.stories.jsx`

## Generated Files

기본 출력 위치:

- `.design-qa/design-ir.json`
- `.design-qa/eval-report.json`
- `.design-qa/fix-prompt.md`
- `.design-qa/semantic-eval.input.json`
- `.design-qa/semantic-eval-prompt.md`
- `.design-qa/semantic-eval.output.json`
- `src/generated/design-qa/tokens.generated.ts`
- `src/generated/design-qa/components.generated.tsx`
- `src/generated/design-qa/designqa.generated.stories.tsx`
- `src/generated/design-qa/registry.generated.json`
- `src/generated/design-qa/icons.generated.tsx`
- `src/generated/design-qa/icons/*.svg`
- `.design-qa/dataset-validation.json`
- `.design-qa/dataset-validation.md`
- `.design-qa/dataset-fix.json`
- `.design-qa/dataset-fix-prompt.md`
- `.design-qa/patch-plan.json`
- `.design-qa/patch-prompt.md`

`patch-plan.json` story 항목에는 다음이 포함됩니다.

- `primaryTargetFile`
- `secondaryTargetFiles`
- `tokenTargetFiles`
- `readonlyContextFiles`
- `referenceArtifacts`
- `semanticStatus`

## Runtime Notes

- Storybook URL은 환경변수보다 `designqa.config.ts`에서 관리하는 것을 기본 원칙으로 둡니다.
- `doctor`는 MCP bridge, Storybook, `agent-browser`, semantic artifact 상태를 함께 점검합니다.
- 글로벌 설치를 쓰더라도 파일 출력은 항상 타겟 프론트엔드 레포 안에 씁니다.
- 현재 패키지는 one-shot code generator보다 반복 보정형 시스템으로 설계되어 있습니다.
