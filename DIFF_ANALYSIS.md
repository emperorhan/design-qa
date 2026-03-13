# Figma <> agent-browser Diff Analysis

## Goal

`@emperorhan/design-qa`의 diff 분석은 "Figma 기준과 Storybook 구현이 충분히 같은가?"를 빠르게 판단하기 위한 것이다.

핵심은 완전한 픽셀 동일성보다 다음을 먼저 잡는 것이다.

- 구조가 맞는가
- 상태가 맞는가
- 토큰이 크게 어긋나지 않는가
- overflow / clipping 같은 치명 문제가 없는가

## Current Runtime Model

현재 패키지는 다음 순서로 diff를 만든다.

1. registry에서 `story <-> figma node` 매핑을 읽는다
2. Storybook `iframe.html?id=...`를 연다
3. `agent-browser`로 viewport를 고정한다
4. animation / transition / caret를 제거한다
5. story screenshot을 캡처한다
6. reference asset 또는 cache image와 pixel diff를 계산한다
7. `agent-browser eval`로 overflow를 검사한다
8. score와 critical violation을 계산한다

즉 현재 구조는:

```text
Figma node
  -> mapped story
  -> Storybook render
  -> agent-browser capture/eval
  -> score
```

## Why This Is Efficient

이 방식이 효율적인 이유는 세 가지다.

### 1. Story 기준으로 비교 범위를 고정한다

Figma와 제품 전체 페이지를 직접 비교하면 노이즈가 크다.

대신:

- `story 1개 = Figma node 1개 = UI state 1개`

로 고정하면 diff 범위가 좁아지고, 어떤 상태가 깨졌는지 바로 알 수 있다.

### 2. agent-browser를 "렌더 + DOM 관찰기"로 쓴다

`agent-browser`는 단순 screenshot 도구가 아니라 DOM에 직접 질문할 수 있다.

예:

- overflow가 있는가
- 특정 element가 렌더됐는가
- 상태 버튼이 비활성화인가
- 텍스트가 잘렸는가

즉 screenshot만으로 판단하지 않고, 시각 diff + DOM signal을 같이 본다.

### 3. Figma live MCP를 항상 직접 비교하지 않는다

라이브 Figma는 유연하지만 느리고 불안정할 수 있다.

그래서 실제 운영은 다음 계층이 효율적이다.

1. live Figma MCP
2. figma-sync cache
3. exported reference PNG

즉 live source를 우선하되, diff 엔진은 항상 안정적인 reference를 하나 확보한 뒤 분석하는 구조가 효율적이다.

## Recommended Diff Strategy

Figma <> agent-browser diff는 아래 3층으로 나누는 것이 가장 효율적이다.

### Layer 1. Mapping Validation

가장 먼저 확인해야 하는 것은 "올바른 걸 비교하고 있는가"다.

체크 항목:

- story에 registry key가 있는가
- registry key가 올바른 Figma node를 가리키는가
- `figmaUrl`과 `figmaNodeId`가 일치하는가
- reference asset이 존재하는가

이 단계가 깨지면 이후 pixel diff는 의미가 없다.

### Layer 2. Structural / DOM Diff

두 번째는 구조 검증이다.

`agent-browser eval`로 다음을 확인하는 것이 효율적이다.

- overflow / clipping
- 필수 블록 존재 여부
- 버튼 / badge / list item count
- 빈 상태 / error 상태 / disabled 상태 렌더

이 단계는 pixel diff보다 싸고, 치명적 문제를 빨리 잡는다.

### Layer 3. Visual Diff

마지막으로 screenshot diff를 돌린다.

여기서는 다음만 본다.

- spacing drift
- block alignment
- icon 위치
- visual density
- 전체적인 card / panel proportion

shadow 1px 차이 같은 것은 low severity로 둔다.

## Efficient Severity Model

효율적인 diff는 "모든 차이를 똑같이 다루지 않는 것"이다.

### Critical

즉시 fail:

- Figma mapping missing
- story missing
- overflow
- clipped text
- required state missing
- screenshot generation failure

### High

강한 감점:

- panel proportion mismatch
- 잘못된 spacing 그룹
- wrong token family
- CTA hierarchy mismatch

### Medium

가능하면 수정:

- icon alignment drift
- text baseline drift
- small spacing mismatch

### Low

pass 가능:

- 1~2px 차이
- shadow / anti-aliasing 차이

## What agent-browser Should Analyze Directly

`agent-browser`는 아래 항목을 screenshot 전에 먼저 분석하는 것이 효율적이다.

- `scrollWidth > clientWidth`
- `scrollHeight > clientHeight`
- disabled / enabled 상태
- visible / hidden 상태
- 특정 key text 존재 여부
- 선택된 item count
- interactive element count

즉, 눈으로만 보지 말고 DOM signal을 먼저 score에 반영해야 한다.

## What Should Still Come From Figma

Figma는 다음 기준값의 source of truth로 쓰는 것이 좋다.

- node mapping
- state 분리
- token intent
- panel grouping
- reference screenshot

반대로 실제 diff 계산 자체는 Storybook render 결과 기준이 더 안정적이다.

즉 Figma는 "정답의 기준", agent-browser는 "현재 렌더의 관찰기" 역할이다.

## Practical Optimization Rules

운영 시에는 아래 원칙이 가장 효율적이다.

1. 전체 페이지보다 state story를 먼저 diff한다
2. screenshot 전 DOM 검사를 먼저 한다
3. animation과 caret를 항상 제거한다
4. viewport를 고정한다
5. 한 번 통과한 story는 reference를 재사용한다
6. pixel diff는 마지막 단계로 둔다
7. fail 원인을 "mapping / structural / visual"로 나눠 출력한다

## Output Format Recommendation

story별 결과는 아래처럼 나누는 것이 해석하기 쉽다.

```json
{
  "story": "Pages/LoginPage.YubiKeyConnected",
  "mapping": "pass",
  "structural": {
    "overflowCount": 0,
    "missingElements": []
  },
  "visual": {
    "pixelDiffRatio": 0.031,
    "dimensionMismatch": 0
  },
  "score": 95,
  "criticalViolations": []
}
```

## Summary

가장 효율적인 Figma <> agent-browser diff는 다음 식이다.

```text
mapping validation
-> DOM / structural checks
-> screenshot diff
-> severity scoring
-> threshold decision
```

즉:

- Figma는 기준을 제공하고
- Storybook은 비교 대상을 고정하고
- agent-browser는 현재 렌더를 측정하며
- score는 pass / fail을 단순하게 만든다

이 구조가 가장 빠르고, 노이즈가 적고, Storybook-first 개발 흐름과도 가장 잘 맞는다.
