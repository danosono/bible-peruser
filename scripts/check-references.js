#!/usr/bin/env node
// Scans every `references` array in data/topics and data/bookwide and reports
// cross-references the in-app popup can't resolve (hover shows no verse text,
// which is otherwise the only symptom). Also lists references that only work
// via the one tolerated alias ("Psalm" for "Psalms") so files can be kept on
// full canonical book names when convenient.
//
// Usage:
//   node scripts/check-references.js            # report; exit 1 if any unresolvable
//   node scripts/check-references.js --aliases  # also list "Psalm ..." entries
//
// Non-reference filler strings ("-", "REPENT:", "[Other]", "-- at Jerusalem")
// are intentional grouping text and are ignored, same as the renderer does.
// No npm install — built-ins only. Never edits anything.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SHOW_ALIASES = process.argv.includes("--aliases");

const { bookNames, resolveBookAlias } = await import(
  pathToFileURL(path.join(REPO_ROOT, "js", "bible-utils.js")).href
);

// Mirrors bpBookNameToId in js/bible-loader.js (full names + "psalm").
const nameToId = Object.fromEntries(
  Object.entries(bookNames).map(([id, name]) => [String(name).toLowerCase(), id]),
);
nameToId["psalm"] = "PSA";

// Mirrors REFERENCE_CORE_RE in js/bible-loader.js.
const REFERENCE_CORE_RE =
  /^((?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+\d+(?::\d+(?:[-–]\d+)?)?/;

const unresolvable = [];
const viaAlias = [];
let total = 0;

function checkReference(raw, where) {
  total++;
  const match = String(raw).trim().match(REFERENCE_CORE_RE);
  if (!match) return; // filler / grouping text, not a reference
  const bookName = match[1].replace(/\s+/g, " ").toLowerCase();
  if (!nameToId[bookName]) {
    const guess = resolveBookAlias(match[1]);
    unresolvable.push(
      `${where}: ${JSON.stringify(raw)}` +
        (guess ? `  (did you mean "${bookNames[guess]}"?)` : ""),
    );
  } else if (bookName === "psalm") {
    viaAlias.push(`${where}: ${JSON.stringify(raw)}`);
  }
}

function walk(node, where) {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, where));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "references" && Array.isArray(value)) {
      value.forEach((ref) => checkReference(ref, where));
    } else {
      walk(value, where);
    }
  }
}

let fileCount = 0;
for (const dir of ["data/topics", "data/bookwide"]) {
  const abs = path.join(REPO_ROOT, dir);
  for (const file of readdirSync(abs).sort()) {
    if (!file.endsWith(".json")) continue;
    fileCount++;
    const text = readFileSync(path.join(abs, file), "utf8");
    walk(JSON.parse(text), `${dir}/${file}`);
  }
}

console.log(`Checked ${total} references in ${fileCount} files.`);

if (unresolvable.length) {
  console.log(`\n${unresolvable.length} UNRESOLVABLE (popup will show no verse):`);
  unresolvable.forEach((line) => console.log("  " + line));
} else {
  console.log("No unresolvable references.");
}

if (SHOW_ALIASES) {
  console.log(
    `\n${viaAlias.length} resolved only via the "Psalm" alias (fine, but non-canonical):`,
  );
  viaAlias.forEach((line) => console.log("  " + line));
} else if (viaAlias.length) {
  console.log(
    `(${viaAlias.length} use "Psalm" instead of "Psalms" — pass --aliases to list them.)`,
  );
}

process.exit(unresolvable.length ? 1 : 0);
