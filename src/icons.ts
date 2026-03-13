import fs from "node:fs";
import path from "node:path";

export interface IconDatasetEntry {
  id: string;
  name: string;
  nodeId?: string;
  variant?: string;
  semanticRole?: string;
  svgPath: string;
  usage?: string[];
  libraryCandidate?: string;
  viewport?: {
    width: number;
    height: number;
  };
  background?: {
    hasFill: boolean;
    fillColor: string | null;
  };
}

export interface NormalizedIconEntry extends IconDatasetEntry {
  componentName: string;
  normalizedSvgPath: string;
  normalizedSvg: string;
}

export interface IconValidationCheck {
  id: string;
  svgExists: boolean;
  isSvg: boolean;
  hasViewBox: boolean;
  hasRootDimensions: boolean;
  hasHardcodedColors: boolean;
  hasBackgroundRect: boolean;
  errors: string[];
  warnings: string[];
}

export function getIconDatasetPath(cwd: string) {
  return path.join(cwd, ".design-qa", "figma", "icons.json");
}

export function loadIconDataset(cwd: string) {
  const datasetPath = getIconDatasetPath(cwd);
  if (!fs.existsSync(datasetPath)) {
    return { datasetPath, icons: [] as IconDatasetEntry[] };
  }
  const icons = JSON.parse(fs.readFileSync(datasetPath, "utf-8")) as IconDatasetEntry[];
  return { datasetPath, icons: Array.isArray(icons) ? icons : [] };
}

export function validateIconDataset(cwd: string) {
  const { datasetPath, icons } = loadIconDataset(cwd);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: IconValidationCheck[] = [];
  if (!fs.existsSync(datasetPath)) {
    return { datasetPath, icons, errors, warnings, checks };
  }

  for (const icon of icons) {
    const check: IconValidationCheck = {
      id: icon.id || "unknown",
      svgExists: false,
      isSvg: false,
      hasViewBox: false,
      hasRootDimensions: false,
      hasHardcodedColors: false,
      hasBackgroundRect: false,
      errors: [],
      warnings: [],
    };
    if (!icon.id) {
      check.errors.push("icons.json contains an entry without id");
      errors.push("icons.json contains an entry without id");
      checks.push(check);
      continue;
    }
    if (!icon.name) {
      check.errors.push(`${icon.id} is missing name`);
      errors.push(`${icon.id} is missing name`);
    }
    if (!icon.svgPath) {
      check.errors.push(`${icon.id} is missing svgPath`);
      errors.push(`${icon.id} is missing svgPath`);
      checks.push(check);
      continue;
    }
    const absSvgPath = path.resolve(cwd, icon.svgPath);
    if (!fs.existsSync(absSvgPath)) {
      check.errors.push(`${icon.id} svg is missing: ${icon.svgPath}`);
      errors.push(`${icon.id} svg is missing: ${icon.svgPath}`);
      checks.push(check);
      continue;
    }
    check.svgExists = true;
    const svg = fs.readFileSync(absSvgPath, "utf-8");
    if (!svg.includes("<svg")) {
      check.errors.push(`${icon.id} is not a valid SVG file: ${icon.svgPath}`);
      errors.push(`${icon.id} is not a valid SVG file: ${icon.svgPath}`);
      checks.push(check);
      continue;
    }
    check.isSvg = true;
    check.hasViewBox = Boolean(extractViewBox(svg));
    check.hasRootDimensions = /<svg\b[^>]*\s(width|height)=["'][^"']+["']/i.test(svg);
    check.hasHardcodedColors = /\s(fill|stroke)=["'](?!none|currentColor)[^"']+["']/i.test(svg);
    check.hasBackgroundRect = detectBackgroundRect(svg, extractViewBox(svg));
    if (!check.hasViewBox && !icon.viewport) {
      check.errors.push(`${icon.id} has no viewBox and no viewport metadata`);
      errors.push(`${icon.id} has no viewBox and no viewport metadata`);
    }
    if (check.hasRootDimensions) {
      check.warnings.push(`${icon.id} SVG still has root width/height and should be normalized before use`);
      warnings.push(`${icon.id} SVG still has root width/height and should be normalized before use`);
    }
    if (check.hasHardcodedColors) {
      check.warnings.push(`${icon.id} SVG contains hardcoded fill/stroke colors`);
      warnings.push(`${icon.id} SVG contains hardcoded fill/stroke colors`);
    }
    if (check.hasBackgroundRect) {
      check.warnings.push(`${icon.id} SVG contains a background-sized rect`);
      warnings.push(`${icon.id} SVG contains a background-sized rect`);
    }
    checks.push(check);
  }

  return { datasetPath, icons, errors, warnings, checks };
}

export function normalizeIconDataset(cwd: string, generationDir: string) {
  const { datasetPath, icons } = loadIconDataset(cwd);
  const normalizedDir = path.join(generationDir, "icons");
  fs.mkdirSync(normalizedDir, { recursive: true });

  const normalizedIcons = icons.map((icon) => {
    const absSvgPath = path.resolve(cwd, icon.svgPath);
    const rawSvg = fs.readFileSync(absSvgPath, "utf-8");
    const normalizedSvg = normalizeSvg(rawSvg, icon.viewport);
    const componentName = sanitizeIconComponentName(icon.name || icon.id);
    const normalizedSvgPath = path.join(normalizedDir, `${icon.id}.svg`);
    fs.writeFileSync(normalizedSvgPath, normalizedSvg);

    return {
      ...icon,
      componentName,
      normalizedSvgPath,
      normalizedSvg,
    } satisfies NormalizedIconEntry;
  });

  const manifestPath = path.join(generationDir, "icons.generated.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        sourceDataset: fs.existsSync(datasetPath) ? path.relative(cwd, datasetPath) : null,
        icons: normalizedIcons.map((icon) => ({
          ...icon,
          normalizedSvgPath: path.relative(cwd, icon.normalizedSvgPath),
        })),
      },
      null,
      2,
    ),
  );

  return { datasetPath, normalizedDir, manifestPath, icons: normalizedIcons };
}

export function renderIconsModule(icons: NormalizedIconEntry[]) {
  if (icons.length === 0) {
    return `import React from "react";\n\nexport const generatedIcons = {} as const;\n`;
  }

  const components = icons
    .map((icon) => {
      const inner = extractSvgInner(icon.normalizedSvg);
      const viewBox = extractViewBox(icon.normalizedSvg) ?? `0 0 ${icon.viewport?.width ?? 24} ${icon.viewport?.height ?? 24}`;
      return `export function ${icon.componentName}({ size = "1em", title, className }: { size?: number | string; title?: string; className?: string }) {\n  return (\n    <svg viewBox="${viewBox}" width={size} height={size} className={className} aria-hidden={title ? undefined : true} role={title ? "img" : "presentation"} focusable="false">\n      {title ? <title>{title}</title> : null}\n      ${inner}\n    </svg>\n  );\n}\n`;
    })
    .join("\n");

  const map = icons
    .map((icon) => `  "${icon.id}": ${icon.componentName},`)
    .join("\n");

  return `import React from "react";\n\n${components}\nexport const generatedIcons = {\n${map}\n} as const;\n`;
}

function normalizeSvg(svg: string, viewport?: { width: number; height: number }) {
  let output = svg
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .trim();

  const width = extractDimension(output, "width");
  const height = extractDimension(output, "height");
  let viewBox = extractViewBox(output);
  if (!viewBox && viewport) {
    viewBox = `0 0 ${viewport.width} ${viewport.height}`;
  } else if (!viewBox && width && height) {
    viewBox = `0 0 ${width} ${height}`;
  }

  output = output.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    const cleanedAttrs = attrs
      .replace(/\sxmlns=["'][^"']*["']/i, "")
      .replace(/\sviewBox=["'][^"']*["']/i, "")
      .replace(/\swidth=["'][^"']*["']/i, "")
      .replace(/\sheight=["'][^"']*["']/i, "")
      .replace(/\sfill=["'][^"']*["']/i, "")
      .replace(/\sstroke=["'][^"']*["']/i, "");
    const vb = viewBox ? ` viewBox="${viewBox}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg"${vb}${cleanedAttrs}>`;
  });

  output = removeBackgroundRects(output, viewBox);
  output = output.replace(/\sstyle=["'][^"']*["']/gi, "");
  output = output.replace(/\sclass=["'][^"']*["']/gi, "");
  output = output.replace(/\s(fill|stroke)=["'](?!none|currentColor)[^"']+["']/gi, (_m, attr) => ` ${attr}="currentColor"`);
  output = output.replace(/<svg\b([^>]*)>/i, `<svg$1 fill="none">`);

  return output;
}

function removeBackgroundRects(svg: string, viewBox: string | null) {
  if (!viewBox) return svg;
  const [, , width, height] = viewBox.split(/\s+/).map((value) => Number(value));
  const rectPattern = new RegExp(
    `<rect([^>]*?)x=["']0["']([^>]*?)y=["']0["']([^>]*?)width=["']${width}["']([^>]*?)height=["']${height}["']([^>]*?)\\/?>`,
    "gi",
  );
  return svg.replace(rectPattern, "");
}

function detectBackgroundRect(svg: string, viewBox: string | null) {
  if (!viewBox) return false;
  const [, , width, height] = viewBox.split(/\s+/).map((value) => Number(value));
  const rectPattern = new RegExp(
    `<rect([^>]*?)x=["']0["']([^>]*?)y=["']0["']([^>]*?)width=["']${width}["']([^>]*?)height=["']${height}["']([^>]*?)\\/?>`,
    "i",
  );
  return rectPattern.test(svg);
}

function extractDimension(svg: string, attr: "width" | "height") {
  const match = svg.match(new RegExp(`${attr}=["']([0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function extractViewBox(svg: string) {
  const match = svg.match(/viewBox=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function extractSvgInner(svg: string) {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "").trim();
}

function sanitizeIconComponentName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const base = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
  return `${base || "Generated"}Icon`;
}
