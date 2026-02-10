#!/usr/bin/env node
// Strip JSON5 comments and expand ${VAR} placeholders from environment.
// Usage: node deploy/render-config.mjs <template.json5> <output.json>
import { readFileSync, writeFileSync } from "fs";

const [templatePath, outputPath] = process.argv.slice(2);
if (!templatePath || !outputPath) {
  console.error("Usage: render-config.mjs <template.json5> <output.json>");
  process.exit(1);
}

const template = readFileSync(templatePath, "utf8");

// Strip single-line // comments (but not inside strings)
const stripped = template.replace(/^\s*\/\/.*$/gm, "");

// Expand ${VAR} placeholders
const missing = [];
const expanded = stripped.replace(/\$\{(\w+)\}/g, (_, key) => {
  const val = process.env[key];
  if (!val) missing.push(key);
  return val ?? "";
});

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Validate the result is valid JSON
try {
  JSON.parse(expanded);
} catch (err) {
  console.error(`Output is not valid JSON: ${err.message}`);
  process.exit(1);
}

writeFileSync(outputPath, expanded);
console.log(`Rendered ${templatePath} → ${outputPath}`);
