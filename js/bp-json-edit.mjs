// Minimal, purpose-built JSON text editor for scripts/apply-approved-suggestions.js.
//
// Why not JSON.parse + JSON.stringify the whole file back out? The files in
// data/topics/ and data/bookwide/ are NOT uniformly formatted (some indent
// differently, some inline short arrays) — re-serializing a whole file would
// produce a huge reformatting diff around every one-line content change,
// making the owner's `git diff` review useless. Instead these helpers locate
// exact byte ranges in the ORIGINAL text and splice only what changed.
//
// Deliberately narrow: enough to (a) find a named top-level key's value
// range, (b) find a key within a specific object's range, (c) enumerate an
// array's element ranges, and (d) splice text in/out. Every caller is
// expected to re-validate the result with JSON.parse before trusting it —
// see scripts/apply-approved-suggestions.js's structural-diff safety check.

function skipWs(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

function skipString(src, i) {
  // src[i] === '"'
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === '"') return j + 1;
    j++;
  }
  throw new Error(`Unterminated string starting at ${i}`);
}

function skipBalanced(src, i, open, close) {
  // src[i] === open
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"') {
      j = skipString(src, j);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  throw new Error(`Unbalanced ${open}${close} starting at ${i}`);
}

// Returns the index just past the JSON value starting at (whitespace-
// trimmed) index i.
export function skipValue(src, i) {
  i = skipWs(src, i);
  const c = src[i];
  if (c === '"') return skipString(src, i);
  if (c === "{") return skipBalanced(src, i, "{", "}");
  if (c === "[") return skipBalanced(src, i, "[", "]");
  let j = i;
  while (j < src.length && !',]}\n\r\t "'.includes(src[j])) j++;
  return j;
}

// Finds `key` as a direct property of the object literal starting at
// objStart (index of its '{'). Returns { keyStart, valueStart, valueEnd }
// or null if the object has no such key. Throws if objStart doesn't point
// at an object.
export function findKeyInObject(src, objStart, key) {
  if (src[objStart] !== "{") {
    throw new Error(`findKeyInObject: expected '{' at ${objStart}`);
  }
  let i = objStart + 1;
  while (true) {
    i = skipWs(src, i);
    if (src[i] === "}") return null;
    if (src[i] === ",") {
      i++;
      continue;
    }
    const keyStart = i;
    const keyEnd = skipString(src, i);
    const keyName = JSON.parse(src.slice(keyStart, keyEnd));
    i = skipWs(src, keyEnd);
    if (src[i] !== ":") throw new Error(`Expected ':' at ${i}`);
    i = skipWs(src, i + 1);
    const valueStart = i;
    const valueEnd = skipValue(src, i);
    if (keyName === key) return { keyStart, valueStart, valueEnd };
    i = skipWs(src, valueEnd);
    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === "}") return null;
  }
}

// Returns [{start, end}, ...] for each element of the array literal
// starting at arrayStart (index of its '[').
export function arrayElementRanges(src, arrayStart) {
  if (src[arrayStart] !== "[") {
    throw new Error(`arrayElementRanges: expected '[' at ${arrayStart}`);
  }
  const ranges = [];
  let i = arrayStart + 1;
  while (true) {
    i = skipWs(src, i);
    if (src[i] === "]") return ranges;
    if (src[i] === ",") {
      i++;
      continue;
    }
    const start = i;
    const end = skipValue(src, i);
    ranges.push({ start, end });
    i = skipWs(src, end);
    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === "]") return ranges;
  }
}

// Leading whitespace of the line containing position `pos`.
export function lineIndent(src, pos) {
  let lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  let i = lineStart;
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  return src.slice(lineStart, i);
}

// Formats a value (string, string[], or a plain object of such) as JSON
// text. Short arrays/objects are inlined; longer arrays break one-per-line
// at `indent` to match the multi-line style already used for note/text
// arrays in these files.
export function formatValue(value, indent) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length <= 1) return JSON.stringify(value);
    const inner = value.map((v) => `${indent}  ${formatValue(v, indent + "  ")}`);
    return `[\n${inner.join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return "{}";
    const inner = keys.map(
      (k) => `${indent}  ${JSON.stringify(k)}: ${formatValue(value[k], indent + "  ")}`,
    );
    return `{\n${inner.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

// --- Splice primitives (each returns a NEW string; callers re-locate
//     offsets from the fresh string before their next splice) ---

export function spliceRange(src, start, end, replacement) {
  return src.slice(0, start) + replacement + src.slice(end);
}

// Appends `element` (a parsed value) to the array literal at
// {arrayStart, arrayEnd} (arrayEnd = index just past the closing ']').
export function spliceAppendToArray(src, arrayStart, arrayEnd, element) {
  const elements = arrayElementRanges(src, arrayStart);
  const baseIndent = lineIndent(src, arrayStart);
  const elemIndent = elements.length
    ? lineIndent(src, elements[elements.length - 1].start)
    : baseIndent + "  ";
  const text = formatValue(element, elemIndent);
  if (!elements.length) {
    // Empty array: `[]` or `[ ]` -> multi-line with the one new element.
    return spliceRange(
      src,
      arrayStart,
      arrayEnd,
      `[\n${elemIndent}${text}\n${baseIndent}]`,
    );
  }
  const lastEnd = elements[elements.length - 1].end;
  return spliceRange(src, lastEnd, lastEnd, `,\n${elemIndent}${text}`);
}

// Inserts a new `"chapterKey": [ element ]` property into the chapterTopics
// object at chapterTopicsObjStart (index of its '{'), used when a chapter
// has no existing topic entries at all yet.
export function spliceInsertChapterKey(
  src,
  chapterTopicsObjStart,
  chapterTopicsObjEnd,
  chapterKey,
  element,
) {
  const baseIndent = lineIndent(src, chapterTopicsObjStart);
  const keyIndent = baseIndent + "  ";
  const elemIndent = keyIndent + "  ";
  const arrText = `[\n${elemIndent}${formatValue(element, elemIndent)}\n${keyIndent}]`;
  const closeBrace = chapterTopicsObjEnd - 1; // index of the object's '}'
  const insertion = `,\n${keyIndent}${JSON.stringify(String(chapterKey))}: ${arrText}`;
  return spliceRange(src, closeBrace, closeBrace, insertion);
}

// Sets `key` to `value` inside the object at {objStart, objEnd}. Replaces
// the value in place if the key exists, otherwise inserts a new property.
export function spliceSetField(src, objStart, objEnd, key, value) {
  const found = findKeyInObject(src, objStart, key);
  const indent = lineIndent(src, objStart);
  const text = formatValue(value, indent);
  if (found) {
    return spliceRange(src, found.valueStart, found.valueEnd, text);
  }
  const closeBrace = objEnd - 1;
  const insertion = `,\n${indent}  ${JSON.stringify(key)}: ${text}`;
  return spliceRange(src, closeBrace, closeBrace, insertion);
}

// Locates the full removable span of `key: value` (including whichever
// adjoining comma keeps the remaining object well-formed) within the
// object at objStart. Returns null if the key isn't present.
function findKeyRangeInObject(src, objStart, key) {
  let i = objStart + 1;
  let prevCommaEnd = i;
  while (true) {
    i = skipWs(src, i);
    if (src[i] === "}") return null;
    if (src[i] === ",") {
      i++;
      prevCommaEnd = i;
      continue;
    }
    const keyStart = i;
    const keyEnd = skipString(src, i);
    const keyName = JSON.parse(src.slice(keyStart, keyEnd));
    let j = skipWs(src, keyEnd);
    j = skipWs(src, j + 1); // past ':'
    const valueStart = j;
    const valueEnd = skipValue(src, j);
    if (keyName === key) {
      const after = skipWs(src, valueEnd);
      if (src[after] === ",") {
        return { removalStart: keyStart, removalEnd: after + 1 };
      }
      return { removalStart: prevCommaEnd, removalEnd: valueEnd };
    }
    i = skipWs(src, valueEnd);
    if (src[i] === ",") {
      i++;
      prevCommaEnd = i;
      continue;
    }
    if (src[i] === "}") return null;
  }
}

// Removes `key` entirely from the object at {objStart, objEnd}. No-op
// (returns src unchanged) if the key isn't present.
export function spliceDeleteField(src, objStart, objEnd, key) {
  const found = findKeyRangeInObject(src, objStart, key);
  if (!found) return src;
  return spliceRange(src, found.removalStart, found.removalEnd, "");
}
