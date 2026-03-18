---
name: design-qa
description: Figma 기준으로 UI를 구현하고 Storybook + agent-browser로 자동 QA 폐쇄 루프를 수행한다. 디자인 점검, UI 구현, 스타일 수정, 컴포넌트 QA에 사용한다.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Design QA 폐쇄 루프

$ARGUMENTS 에 대해 Design QA 폐쇄 루프를 수행한다.

## 사용법

```
/design-qa LoginPage              # 단일 페이지/컴포넌트
/design-qa PinInput               # 단일 컴포넌트
/design-qa all                    # 전체 페이지 순회
/design-qa LoginPage --fix-only   # mismatch 수정만 수행
```

## 프로젝트 설정 확인

이 스킬은 프로젝트 루트의 `designqa.config.ts`를 참조한다.
설정이 없으면 `npx @emperorhan/design-qa init`으로 생성한다.

```ts
// designqa.config.ts 주요 설정
{
  tokensPath: "src/styles/tokens.css",    // 디자인 토큰 파일
  registryPath: "src/stories/designQa.ts", // Figma 매핑 레지스트리
  figmaRefsPath: "figma-refs",             // Figma 참조 이미지
}
```

## SVG 아이콘 정규화

아이콘 디렉토리에 새 SVG가 추가되면 자동으로 정규화한다.

| 항목 | 처리 |
|------|------|
| `width`/`height` 속성 | **제거** (CSS에서 크기 제어) |
| `viewBox` | `"0 0 24 24"` 보장 |
| `fill` 값 | 하드코딩 색상 → **`currentColor`** 변환 |
| `fill="none"` | 유지 (투명 영역) |
| `xmlns:xlink`, `class`, `style` | 제거 |
| 빈 `<path d=""/>` | 제거 |

Before:
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M10.828 12l4.95..." fill="#060607"/>
</svg>
```

After:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M10.828 12l4.95..."/>
</svg>
```

## 폐쇄 루프 절차

### Step 1. 설정 읽기
- `designqa.config.ts`에서 프로젝트 설정을 읽는다
- `tokensPath`에서 디자인 토큰 값을 확인한다
- `registryPath`에서 Figma 매핑 레지스트리를 읽는다

### Step 2. 대상 컴포넌트 식별
- $ARGUMENTS로 전달된 컴포넌트를 찾는다
- 레지스트리에서 해당 컴포넌트의 `figmaNodeId` 확인

### Step 3. Figma 기준 분석
- Figma MCP 도구(`mcp__figma-bridge__get_node`, `mcp__figma-bridge__get_screenshot`)로 디자인 값 추출
- 대상: spacing, typography, color, radius, layout, variant, interaction state

### Step 4. 기존 코드 구조 분석
- 현재 구현된 스타일 값을 코드에서 추출한다
- Figma 스펙과 코드 값을 비교하여 차이를 목록화한다

### Step 5. 컴포넌트 구현 또는 수정
- Figma 기준에 맞게 코드를 수정한다
- 스토리 파일이 없으면 생성한다
- `tokensPath`의 CSS 변수를 활용한다 (하드코딩 금지)

### Step 6. Storybook에서 렌더링
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:6006
```
- 실행 중이 아니면 사용자에게 Storybook 실행을 요청한다

### Step 7. agent-browser로 QA 수행
```bash
agent-browser open "http://localhost:6006/iframe.html?id=<story-id>&viewMode=story"
agent-browser wait --load networkidle
agent-browser screenshot /tmp/qa-result.png
```

### Step 8. mismatch 분석

세 가지로 분류:
- **Spec mismatch**: padding, radius, typography, color 불일치
- **Visual mismatch**: overflow, clipping, layout shift, icon alignment
- **State mismatch**: hover/focus/disabled/loading/error 상태 누락

Severity:
- **High**: overflow, layout 깨짐, state 누락, token 불일치 → 반드시 수정
- **Medium**: spacing 차이, icon misalignment → 가능하면 수정
- **Low**: 1~2px 차이, shadow 미세 차이 → 무시 가능

### Step 9. High severity 수정
- High severity mismatch를 수정한다
- 수정 후 Step 6로 돌아간다 (루프)

### Step 10. 종료 판단

다음 4가지를 모두 만족하면 종료:
- [ ] high severity mismatch 없음
- [ ] 텍스트 overflow 없음
- [ ] interaction state 정상
- [ ] Storybook에서 재현 가능

### Step 11. 결과 출력

```
### Plan
이번 작업 목표

### Findings
**Spec mismatch**
- (항목)

**Visual mismatch**
- (항목)

**State mismatch**
- (항목)

### Changes
- `파일경로` — 변경 내용

### QA Result
**pass** / **fail**

### Remaining Risk
남은 문제 (없으면 "없음")
```

### Step 12. 세션 정리
```bash
agent-browser close
```

## 새 컴포넌트 등록

레지스트리 파일(`registryPath`)에 엔트리를 추가한다:
```ts
"Pages/NewPage.Default": {
  key: "Pages/NewPage.Default",
  title: "Pages/NewPage",
  exportName: "Default",
  figmaNodeId: "1234:5678",
  figmaUrl: "https://www.figma.com/design/...",
  sourcePath: "src/pages/NewPage.stories.tsx",
},
```

스토리에서 `withRegisteredDesignQaStory()` 래퍼 사용:
```ts
export const Default: Story = withRegisteredDesignQaStory("Pages/NewPage.Default", {
  render: () => <NewPage />,
});
```

## 범위 제한

**허용**: UI 컴포넌트 구현, 스타일 수정, 레이아웃 조정, Storybook 스토리 작성
**금지**: 백엔드 개발, API 구현, DB 작업, 인프라 설정, 서버 로직
