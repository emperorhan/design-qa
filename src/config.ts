/**
 * Design QA configuration schema.
 * Each project creates a `designqa.config.ts` at its root.
 */
export interface DesignQaConfig {
  /** Storybook dev server URL (default: http://localhost:6006) */
  storybookUrl?: string;

  /** Path to CSS design tokens file, relative to project root */
  tokensPath: string;

  /** Source root directory (default: src) */
  srcRoot?: string;

  /** Path to the design QA registry file, relative to project root */
  registryPath: string;

  /** Path to store Figma reference screenshots, relative to project root */
  figmaRefsPath?: string;
}

export const DEFAULT_CONFIG: Required<DesignQaConfig> = {
  storybookUrl: "http://localhost:6006",
  tokensPath: "src/styles/tokens.css",
  srcRoot: "src",
  registryPath: "src/stories/designQa.ts",
  figmaRefsPath: "figma-refs",
};

export function mergeConfig(partial: DesignQaConfig): Required<DesignQaConfig> {
  return { ...DEFAULT_CONFIG, ...partial };
}
