import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { LoadedDesignQaConfig } from "./config";
import { getDesignSourceType, type DesignQaEntry, type DesignSourceType } from "./storybook";

export interface DesignTokenScale<TValue = string | number> {
  name: string;
  value: TValue;
  role?: string;
  confidence?: number;
  inferred?: boolean;
  evidence?: string;
}

export interface SemanticRole {
  name: string;
  target: string;
  confidence?: number;
}

export interface ComponentSpec {
  name: string;
  source: DesignSourceType;
  variants: string[];
  states: string[];
  storyKey?: string;
  reusedFromCodeConnect?: boolean;
  codeConnectSourcePath?: string;
  confidence?: number;
  needsVerification?: boolean;
}

export interface PageComposition {
  name: string;
  sections: string[];
  breakpoints: string[];
  storyKeys: string[];
}

export interface BehaviorHint {
  component: string;
  hints: string[];
}

export interface VerificationTarget {
  id: string;
  type: "token" | "layout" | "component" | "responsive" | "interaction";
  label: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

export interface DesignIrProvenance {
  source: DesignSourceType;
  fetchedAt: string;
  confidence: number;
  nodeIds: string[];
  screenshotPath?: string;
  fileHash?: string;
  notes: string[];
}

export interface ScreenshotAnalysis {
  path: string;
  width: number;
  height: number;
  aspectRatio: number;
  dominantColors: string[];
  spacingCandidates: number[];
  radiusCandidates: number[];
  shadowCandidates: string[];
  textBandCount: number;
  blockCount: number;
}

export interface DesignIR {
  version: 1;
  mode: DesignSourceType;
  generatedAt: string;
  tokens: {
    color: DesignTokenScale[];
    typography: DesignTokenScale[];
    spacing: DesignTokenScale<number>[];
    radius: DesignTokenScale<number>[];
    shadow: DesignTokenScale[];
    motion: DesignTokenScale[];
  };
  semanticRoles: SemanticRole[];
  components: ComponentSpec[];
  pages: PageComposition[];
  behaviorHints: BehaviorHint[];
  verificationTargets: VerificationTarget[];
  screenshotAnalysis?: ScreenshotAnalysis;
  datasetProvenance?: {
    source: "figma-dataset" | "direct-mcp";
    extractionMode?: string;
    includedFiles: string[];
    registryCoverage?: {
      total: number;
      covered: number;
    };
  };
  provenance: DesignIrProvenance[];
  cacheKeys: {
    registryHash: string;
    sourceFingerprint: string;
  };
}

export function createSeedIr(config: LoadedDesignQaConfig, entries = Object.values(config.registry)): DesignIR {
  const mode = resolveIrMode(config, entries);
  const generatedAt = new Date().toISOString();
  const registryHash = createHash("sha1")
    .update(JSON.stringify(entries.map((entry) => [entry.key, entry.figmaNodeId, entry.screenshotPath, entry.referencePath])))
    .digest("hex");
  const sourceFingerprint = createHash("sha1")
    .update(JSON.stringify(entries.map((entry) => `${entry.key}:${getDesignSourceType(entry)}`)))
    .digest("hex");

  return {
    version: 1,
    mode,
    generatedAt,
    tokens: {
      color: inferColorTokens(mode),
      typography: inferTypographyTokens(mode),
      spacing: inferSpacingTokens(mode),
      radius: inferRadiusTokens(mode),
      shadow: inferShadowTokens(mode),
      motion: inferMotionTokens(mode),
    },
    semanticRoles: inferSemanticRoles(entries),
    components: inferComponents(entries),
    pages: inferPages(entries),
    behaviorHints: inferBehaviorHints(entries),
    verificationTargets: inferVerificationTargets(entries, mode),
    provenance: entries.map((entry) => buildProvenance(entry)),
    cacheKeys: {
      registryHash,
      sourceFingerprint,
    },
  };
}

export function readDesignIr(irPath: string) {
  if (!fs.existsSync(irPath)) {
    throw new Error(`Design IR not found: ${irPath}`);
  }
  return JSON.parse(fs.readFileSync(irPath, "utf-8")) as DesignIR;
}

export function writeDesignIr(irPath: string, ir: DesignIR) {
  fs.mkdirSync(path.dirname(irPath), { recursive: true });
  fs.writeFileSync(irPath, JSON.stringify(ir, null, 2));
}

export function withScreenshotAnalysis(ir: DesignIR, analysis: ScreenshotAnalysis): DesignIR {
  const dominantTokens = analysis.dominantColors.slice(0, 6).map((value, index) => ({
    name: `screenshot/color-${index + 1}`,
    value,
    role: index === 0 ? "surface" : index === 1 ? "text" : "accent",
    confidence: 0.55,
    inferred: true,
    evidence: `dominant-color:${index + 1}`,
  }));
  const spacingTokens = analysis.spacingCandidates.map((value) => ({
    name: `space/${value}`,
    value,
    confidence: 0.6,
    inferred: true,
    evidence: "edge-gap-clustering",
  }));
  const radiusTokens = analysis.radiusCandidates.map((value) => ({
    name: `radius/${value}`,
    value,
    confidence: 0.45,
    inferred: true,
    evidence: "corner-contrast-sampling",
  }));
  const shadowTokens = analysis.shadowCandidates.map((value, index) => ({
    name: `shadow/${index === 0 ? "sm" : "md"}`,
    value,
    confidence: 0.4,
    inferred: true,
    evidence: "luma-falloff",
  }));

  return {
    ...ir,
    screenshotAnalysis: analysis,
    tokens: {
      ...ir.tokens,
      color: dominantTokens.length > 0 ? dominantTokens : ir.tokens.color,
      spacing: spacingTokens.length > 0 ? spacingTokens : ir.tokens.spacing,
      radius: radiusTokens.length > 0 ? radiusTokens : ir.tokens.radius,
      shadow: shadowTokens.length > 0 ? shadowTokens : ir.tokens.shadow,
      typography: buildTypographyFromScreenshot(analysis),
    },
    verificationTargets: [
      ...ir.verificationTargets.filter((target) => !target.id.startsWith("screenshot:")),
      {
        id: "screenshot:responsive",
        type: "responsive",
        label: "Responsive intent inferred from single screenshot",
        reason: "A static screenshot cannot encode full breakpoint behavior.",
        severity: "high",
      },
      {
        id: "screenshot:interactions",
        type: "interaction",
        label: "Hover/focus/disabled states not observable",
        reason: "Interaction affordances require semantic review or explicit stories.",
        severity: "high",
      },
    ],
  };
}

export function mergeFigmaIntoIr(ir: DesignIR, figmaNodeIds: string[], figmaNotes: string[]): DesignIR {
  return {
    ...ir,
    mode: ir.mode === "screenshot" ? "hybrid" : "figma",
    components: ir.components.map((component) => ({
      ...component,
      source: component.source === "screenshot" ? "hybrid" : "figma",
      confidence: Math.max(component.confidence ?? 0.5, 0.8),
      needsVerification: component.source === "screenshot",
    })),
    verificationTargets: [
      ...ir.verificationTargets,
      ...(ir.mode === "screenshot"
        ? [
            {
              id: "hybrid:merge",
              type: "layout" as const,
              label: "Hybrid merge conflict review",
              reason: "Screenshot-derived layout and Figma-derived structure must be reconciled.",
              severity: "medium" as const,
            },
          ]
        : []),
    ],
    provenance: [
      {
        source: ir.mode === "screenshot" ? "hybrid" : "figma",
        fetchedAt: new Date().toISOString(),
        confidence: 0.95,
        nodeIds: figmaNodeIds,
        notes: figmaNotes,
      },
      ...ir.provenance,
    ],
  };
}

export function mergeFigmaDatasetIntoIr(
  ir: DesignIR,
  dataset: {
    extractionMode?: string;
    includedFiles: string[];
    coverage: { total: number; covered: number };
    tokens?: {
      color?: Array<{ name: string; value: string; role?: string }>;
      typography?: Array<{ name: string; value: string }>;
      spacing?: Array<{ name: string; value: number }>;
      radius?: Array<{ name: string; value: number }>;
      shadow?: Array<{ name: string; value: string }>;
      motion?: Array<{ name: string; value: string }>;
    } | null;
    components?: Array<{ name: string; storyKey?: string; variants?: string[]; codeConnect?: { sourcePath: string; exportName?: string } }> | null;
    nodeIds: string[];
    notes: string[];
  },
): DesignIR {
  return {
    ...ir,
    mode: ir.mode === "screenshot" ? "hybrid" : "figma",
    datasetProvenance: {
      source: "figma-dataset",
      extractionMode: dataset.extractionMode,
      includedFiles: dataset.includedFiles,
      registryCoverage: dataset.coverage,
    },
    tokens: {
      color:
        dataset.tokens?.color?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.color,
      typography:
        dataset.tokens?.typography?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.typography,
      spacing:
        dataset.tokens?.spacing?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.spacing,
      radius:
        dataset.tokens?.radius?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.radius,
      shadow:
        dataset.tokens?.shadow?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.shadow,
      motion:
        dataset.tokens?.motion?.map((token) => ({ ...token, confidence: 0.95, inferred: false })) ??
        ir.tokens.motion,
    },
    components:
      dataset.components && dataset.components.length > 0
        ? dataset.components.map((component) => ({
            name: component.name,
            source: ir.mode === "screenshot" ? "hybrid" : "figma",
            variants: component.variants ?? ["Default"],
            states: component.variants ?? ["default"],
            storyKey: component.storyKey,
            reusedFromCodeConnect: Boolean(component.codeConnect),
            codeConnectSourcePath: component.codeConnect?.sourcePath,
            confidence: 0.95,
            needsVerification: ir.mode === "screenshot",
          }))
        : ir.components,
    provenance: [
      {
        source: ir.mode === "screenshot" ? "hybrid" : "figma",
        fetchedAt: new Date().toISOString(),
        confidence: 0.98,
        nodeIds: dataset.nodeIds,
        notes: dataset.notes,
      },
      ...ir.provenance,
    ],
  };
}

function resolveIrMode(config: LoadedDesignQaConfig, entries: DesignQaEntry[]) {
  if (config.mode === "hybrid") {
    return "hybrid";
  }
  if (entries.some((entry) => getDesignSourceType(entry) === "hybrid")) {
    return "hybrid";
  }
  if (entries.some((entry) => getDesignSourceType(entry) === "screenshot")) {
    return config.mode === "figma" && entries.some((entry) => getDesignSourceType(entry) === "figma") ? "hybrid" : "screenshot";
  }
  return "figma";
}

function inferColorTokens(mode: DesignSourceType): DesignTokenScale[] {
  const names = [
    "surface/default",
    "surface/subtle",
    "text/primary",
    "text/secondary",
    "border/subtle",
    "action/primary",
  ];
  return names.map((name, index) => ({
    name,
    value: ["#FFFFFF", "#F5F7FA", "#111827", "#6B7280", "#D1D5DB", "#2563EB"][index] ?? "#000000",
    role: name.split("/")[0],
    confidence: mode === "screenshot" ? 0.45 : 0.85,
    inferred: mode !== "figma",
  }));
}

function inferTypographyTokens(mode: DesignSourceType): DesignTokenScale[] {
  const confidence = mode === "screenshot" ? 0.4 : 0.8;
  return [
    { name: "display/lg", value: "700 48px/56px System", confidence, inferred: mode !== "figma" },
    { name: "heading/md", value: "600 24px/32px System", confidence, inferred: mode !== "figma" },
    { name: "body/md", value: "400 16px/24px System", confidence, inferred: mode !== "figma" },
    { name: "label/sm", value: "500 14px/20px System", confidence, inferred: mode !== "figma" },
  ];
}

function inferSpacingTokens(mode: DesignSourceType): DesignTokenScale<number>[] {
  const confidence = mode === "screenshot" ? 0.5 : 0.9;
  return [4, 8, 12, 16, 24, 32, 48].map((value) => ({
    name: `space/${value}`,
    value,
    confidence,
    inferred: mode !== "figma",
  }));
}

function inferRadiusTokens(mode: DesignSourceType): DesignTokenScale<number>[] {
  const confidence = mode === "screenshot" ? 0.35 : 0.85;
  return [0, 4, 8, 12, 16].map((value) => ({
    name: `radius/${value}`,
    value,
    confidence,
    inferred: mode !== "figma",
  }));
}

function inferShadowTokens(mode: DesignSourceType): DesignTokenScale[] {
  return [
    { name: "shadow/sm", value: "0 1px 2px rgba(0,0,0,0.08)", confidence: mode === "screenshot" ? 0.35 : 0.75, inferred: mode !== "figma" },
    { name: "shadow/md", value: "0 12px 24px rgba(0,0,0,0.12)", confidence: mode === "screenshot" ? 0.35 : 0.75, inferred: mode !== "figma" },
  ];
}

function inferMotionTokens(mode: DesignSourceType): DesignTokenScale[] {
  return [
    { name: "motion/fast", value: "120ms ease-out", confidence: mode === "screenshot" ? 0.2 : 0.6, inferred: mode !== "figma" },
    { name: "motion/base", value: "180ms ease-in-out", confidence: mode === "screenshot" ? 0.2 : 0.6, inferred: mode !== "figma" },
  ];
}

function inferSemanticRoles(entries: DesignQaEntry[]): SemanticRole[] {
  const roles = new Map<string, SemanticRole>();
  for (const entry of entries) {
    const words = `${entry.title} ${entry.exportName}`.split(/[/. -]+/).filter(Boolean);
    for (const word of words) {
      const normalized = word.toLowerCase();
      if (normalized.includes("button")) {
        roles.set("button/primary", { name: "button/primary", target: entry.key, confidence: 0.7 });
      }
      if (normalized.includes("input") || normalized.includes("field")) {
        roles.set("input/default", { name: "input/default", target: entry.key, confidence: 0.7 });
      }
      if (normalized.includes("card")) {
        roles.set("surface/card", { name: "surface/card", target: entry.key, confidence: 0.7 });
      }
    }
  }
  return [...roles.values()];
}

function inferComponents(entries: DesignQaEntry[]): ComponentSpec[] {
  return entries.map((entry) => ({
    name: entry.title.split("/").at(-1) ?? entry.title,
    source: getDesignSourceType(entry),
    variants: [entry.exportName],
    states: inferStates(entry.exportName),
    storyKey: entry.key,
    reusedFromCodeConnect: false,
    confidence: getDesignSourceType(entry) === "screenshot" ? 0.45 : 0.85,
    needsVerification: getDesignSourceType(entry) !== "figma",
  }));
}

function inferPages(entries: DesignQaEntry[]): PageComposition[] {
  const groups = new Map<string, PageComposition>();
  for (const entry of entries) {
    const pageName = entry.title.split("/")[0] ?? entry.title;
    const current = groups.get(pageName) ?? {
      name: pageName,
      sections: [],
      breakpoints: ["desktop", "mobile"],
      storyKeys: [],
    };
    current.storyKeys.push(entry.key);
    current.sections.push(entry.exportName);
    groups.set(pageName, current);
  }
  return [...groups.values()];
}

function inferBehaviorHints(entries: DesignQaEntry[]): BehaviorHint[] {
  return entries.map((entry) => ({
    component: entry.key,
    hints: inferStates(entry.exportName).map((state) => `${state} state should be visually isolated in Storybook`),
  }));
}

function inferVerificationTargets(entries: DesignQaEntry[], mode: DesignSourceType): VerificationTarget[] {
  const targets: VerificationTarget[] = [];
  for (const entry of entries) {
    if (getDesignSourceType(entry) !== "figma") {
      targets.push({
        id: `entry:${entry.key}:tokens`,
        type: "token",
        label: `${entry.key} token verification`,
        reason: "Non-Figma sources infer token values and require review.",
        severity: mode === "hybrid" ? "medium" : "high",
      });
    }
  }
  return targets;
}

function inferStates(exportName: string) {
  const lower = exportName.toLowerCase();
  const states = new Set<string>(["default"]);
  const known = ["hover", "active", "disabled", "error", "loading", "empty", "mobile"];
  for (const state of known) {
    if (lower.includes(state)) {
      states.add(state);
    }
  }
  if (states.size === 1) {
    states.add("long-text");
  }
  return [...states];
}

function buildTypographyFromScreenshot(analysis: ScreenshotAnalysis): DesignTokenScale[] {
  const displaySize = Math.max(24, Math.min(52, Math.round(analysis.height * 0.06)));
  const headingSize = Math.max(20, Math.round(displaySize * 0.58));
  const bodySize = Math.max(14, Math.round(displaySize * 0.33));
  const lineHeight = (size: number) => Math.round(size * 1.4);
  return [
    { name: "display/lg", value: `700 ${displaySize}px/${lineHeight(displaySize)}px System`, confidence: 0.45, inferred: true, evidence: "image-scale" },
    { name: "heading/md", value: `600 ${headingSize}px/${lineHeight(headingSize)}px System`, confidence: 0.45, inferred: true, evidence: "text-band-density" },
    { name: "body/md", value: `400 ${bodySize}px/${lineHeight(bodySize)}px System`, confidence: 0.5, inferred: true, evidence: "text-band-density" },
    { name: "label/sm", value: `500 ${Math.max(12, bodySize - 2)}px/${lineHeight(Math.max(12, bodySize - 2))}px System`, confidence: 0.4, inferred: true, evidence: "text-band-density" },
  ];
}

function buildProvenance(entry: DesignQaEntry): DesignIrProvenance {
  const source = getDesignSourceType(entry);
  const screenshotPath = entry.screenshotPath ?? entry.referencePath;
  const screenshotAbsPath = screenshotPath ? path.resolve(process.cwd(), screenshotPath) : null;
  return {
    source,
    fetchedAt: new Date().toISOString(),
    confidence: source === "figma" ? 0.9 : source === "hybrid" ? 0.8 : 0.45,
    nodeIds: entry.figmaNodeId ? [entry.figmaNodeId] : [],
    screenshotPath,
    fileHash:
      screenshotAbsPath && fs.existsSync(screenshotAbsPath)
        ? createHash("sha1").update(fs.readFileSync(screenshotAbsPath)).digest("hex")
        : undefined,
    notes: [
      source === "screenshot" ? "Screenshot-derived values are inferred and should be verified in semantic eval." : "Structured source available.",
    ],
  };
}
