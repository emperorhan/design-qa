export const DESIGN_QA_TAG = "design-qa";

export interface DesignQaViewport {
  width: number;
  height: number;
}

export type DesignSourceType = "figma" | "screenshot" | "hybrid";

export interface DesignQaEntry {
  key: string;
  title: string;
  exportName: string;
  sourcePath: string;
  fixture?: boolean;
  sourceType?: DesignSourceType;
  figmaNodeId?: string;
  figmaUrl?: string;
  screenshotPath?: string;
  referencePath?: string;
  referenceType?: "mcp" | "cache";
  viewport?: DesignQaViewport;
  designIrId?: string;
  evaluationProfile?: string;
}

const DEFAULT_VIEWPORT: DesignQaViewport = {
  width: 1440,
  height: 1024,
};

export function buildDesignQaParameters(entry: DesignQaEntry) {
  const sourceType = getDesignSourceType(entry);
  return {
    design: {
      type: sourceType,
      url: entry.figmaUrl,
      screenshotPath: entry.screenshotPath,
      designIrId: entry.designIrId,
    },
    qa: {
      figmaNodeId: entry.figmaNodeId,
      figmaPageId: entry.figmaNodeId?.split(":")[0],
      referenceType: entry.referenceType ?? "mcp",
      referencePath: entry.referencePath,
      screenshotPath: entry.screenshotPath,
      viewport: entry.viewport ?? DEFAULT_VIEWPORT,
      tags: [DESIGN_QA_TAG],
      registryKey: entry.key,
      sourcePath: entry.sourcePath,
      sourceType,
      evaluationProfile: entry.evaluationProfile ?? "default",
    },
  };
}

type StoryLike<TArgs> = {
  tags?: string[];
  parameters?: Record<string, unknown>;
} & Record<string, unknown>;

export function withDesignQaStory<TArgs, TStory extends StoryLike<TArgs>>(
  entry: DesignQaEntry,
  story: TStory,
): TStory {
  return {
    ...story,
    tags: [...(story.tags ?? []), DESIGN_QA_TAG],
    parameters: {
      ...story.parameters,
      ...buildDesignQaParameters(entry),
    },
  };
}

export function toStorybookId(title: string, exportName: string): string {
  return `${sanitizeTitlePart(title)}--${sanitizeExportPart(exportName)}`;
}

export function getDesignSourceType(entry: DesignQaEntry): DesignSourceType {
  if (entry.sourceType) {
    return entry.sourceType;
  }
  if (entry.figmaNodeId && entry.screenshotPath) {
    return "hybrid";
  }
  if (entry.figmaNodeId || entry.figmaUrl) {
    return "figma";
  }
  return "screenshot";
}

export function isFixtureEntry(entry: DesignQaEntry) {
  return (
    entry.fixture === true ||
    (entry.key === "Pages/Example.Default" &&
      entry.sourcePath === "src/stories/Example.stories.tsx" &&
      entry.figmaNodeId === "123:456")
  );
}

function sanitizeTitlePart(value: string) {
  return value
    .replace(/[^a-zA-Z0-9/]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function sanitizeExportPart(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
