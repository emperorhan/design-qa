/**
 * Storybook helpers for Design QA story registration.
 * Import in your project: import { withDesignQaStory } from "@emperorhan/design-qa/storybook";
 */

export const DESIGN_QA_TAG = "design-qa";

export interface DesignQaViewport {
  width: number;
  height: number;
}

export interface DesignQaEntry {
  /** Unique registry key (e.g. "Pages/LoginPage.Default") */
  key: string;
  /** Storybook title (e.g. "Pages/LoginPage") */
  title: string;
  /** Story export name (e.g. "Default") */
  exportName: string;
  /** Figma node ID (colon format: "3366:255") */
  figmaNodeId: string;
  /** Full Figma URL for the node */
  figmaUrl: string;
  /** Story source file path relative to project root */
  sourcePath: string;
  /** Figma reference screenshot path (optional) */
  referencePath?: string;
  /** Viewport size for screenshot comparison */
  viewport?: DesignQaViewport;
}

const DEFAULT_VIEWPORT: DesignQaViewport = {
  width: 1440,
  height: 1024,
};

export function buildDesignQaParameters(entry: DesignQaEntry) {
  return {
    design: {
      type: "figma" as const,
      url: entry.figmaUrl,
    },
    qa: {
      figmaNodeId: entry.figmaNodeId,
      referencePath: entry.referencePath,
      viewport: entry.viewport ?? DEFAULT_VIEWPORT,
      tags: [DESIGN_QA_TAG],
      registryKey: entry.key,
      sourcePath: entry.sourcePath,
    },
  };
}

type StoryLike = {
  tags?: string[];
  parameters?: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Wraps a Storybook story with Design QA metadata.
 * Adds Figma URL, node ID, and QA tags to story parameters.
 *
 * @example
 * export const Default: Story = withDesignQaStory(registry["Pages/Home.Default"], {
 *   name: "홈 화면",
 *   render: () => <HomePage />,
 * });
 */
export function withDesignQaStory<TStory extends StoryLike>(
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

/**
 * Converts a Storybook title + export name to a story ID.
 * e.g. ("Pages/LoginPage", "Default") → "pages-loginpage--default"
 */
export function toStorybookId(title: string, exportName: string): string {
  const titlePart = title
    .replace(/[^a-zA-Z0-9/]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const exportPart = exportName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${titlePart}--${exportPart}`;
}
