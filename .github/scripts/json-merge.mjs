#!/usr/bin/env node
// Git merge driver for JSON objects (the locale files): merges key by key instead of
// line by line. A key changed on only one side takes that side's value. Keys added
// on either side are kept, in upstream's order. Only the same key changed to
// different values on both sides is a conflict.
//
// Usage (git config merge.<name>.driver): node json-merge.mjs %O %A %B
// %O = common ancestor, %A = ours (this fork; the result is written here), %B = theirs.
// Exit 0 = merged. Exit 1 = conflict: %A stays unchanged and the conflicting keys go to stderr.

import { readFileSync, writeFileSync } from 'node:fs';

const [basePath, oursPath, theirsPath] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MISSING = Symbol('missing');
const conflicts = [];

function mergeValue(base, ours, theirs, path) {
  if (same(ours, theirs)) return ours;
  if (isObject(ours) && isObject(theirs)) {
    return mergeObject(isObject(base) ? base : {}, ours, theirs, path);
  }
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  conflicts.push(path || '(root)');
  return ours;
}

function mergeObject(base, ours, theirs, path) {
  // Upstream's key order first; a key only this fork has goes after its predecessor in ours.
  const order = Object.keys(theirs);
  let previous = null;
  for (const key of Object.keys(ours)) {
    if (!(key in theirs) && !order.includes(key)) {
      order.splice(previous === null ? 0 : order.indexOf(previous) + 1, 0, key);
    }
    previous = key;
  }

  const result = {};
  for (const key of order) {
    const b = key in base ? base[key] : MISSING;
    const o = key in ours ? ours[key] : MISSING;
    const t = key in theirs ? theirs[key] : MISSING;
    const keyPath = path ? `${path}.${key}` : key;
    if (o === MISSING || t === MISSING) {
      // Deleted on one side: keep the deletion only if the other side did not change the key.
      const kept = o === MISSING ? t : o;
      if (b === MISSING) result[key] = kept;
      else if (!same(kept, b)) conflicts.push(keyPath);
      continue;
    }
    result[key] = mergeValue(b === MISSING ? undefined : b, o, t, keyPath);
  }
  return result;
}

let merged;
try {
  merged = mergeValue(read(basePath), read(oursPath), read(theirsPath), '');
} catch (error) {
  console.error(`json-merge: ${error.message}`);
  process.exit(1);
}

if (conflicts.length > 0) {
  console.error(`json-merge: ${oursPath}: both sides changed: ${conflicts.join(', ')}`);
  process.exit(1);
}
writeFileSync(oursPath, `${JSON.stringify(merged, null, 2)}\n`);
