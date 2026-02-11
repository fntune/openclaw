#!/usr/bin/env node
// Parse JSON5 template, expand ${VAR} placeholders, emit valid JSON.
// Usage: node deploy/render-config.mjs <template.json5> <output.json>
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const JSON5 = require("json5");

const [templatePath, outputPath] = process.argv.slice(2);
if (!templatePath || !outputPath) {
  console.error("Usage: render-config.mjs <template.json5> <output.json>");
  process.exit(1);
}

const template = readFileSync(templatePath, "utf8");

// Expand ${VAR} placeholders before parsing (so values land in strings)
const missing = [];
const expanded = template.replace(/\$\{(\w+)\}/g, (_, key) => {
  const val = process.env[key];
  if (!val) {
    missing.push(key);
  }
  return val ?? "";
});

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Parse as JSON5 (handles comments, unquoted keys, trailing commas)
let config;
try {
  config = JSON5.parse(expanded);
} catch (err) {
  console.error(`Failed to parse template: ${err.message}`);
  process.exit(1);
}

writeFileSync(outputPath, JSON.stringify(config, null, 2));
console.log(`Rendered ${templatePath} → ${outputPath}`);
