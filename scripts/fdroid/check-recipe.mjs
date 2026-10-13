#!/usr/bin/env node
// Check an F-Droid recipe before it reaches the merge request. The mistake this exists for:
// leaving the previous version's build in when adding a new one, which a reviewer then has to
// ask about. It also catches the pieces that go stale together, since a release touches all of
// them: the version the recipe builds, its code, and the commit it names.
//
//   node scripts/fdroid/check-recipe.mjs [path]        (default: this repo's copy)
// Exits 1 and lists what is wrong. Reads a file, or standard input when given "-".

import { readFileSync } from "node:fs";

/** versionCode as the recipe computes it: 1.10 is 11000, 1.9 is 10900. */
export function codeFor(versionName) {
  const [major, minor = "0"] = versionName.split(".");
  return Number(major) * 10000 + Number(minor) * 100;
}

/** Everything wrong with this recipe, as sentences. Empty means it is fine. */
export function checkRecipe(text) {
  const problems = [];
  const builds = [...text.matchAll(/^ {2}- versionName: '([^']+)'\n {4}versionCode: (\d+)\n {4}commit: (\S+)/gm)];
  const names = [...text.matchAll(/^ {2}- versionName:/gm)];

  if (names.length === 0) return ["no build entry at all"];
  if (names.length !== builds.length) {
    problems.push(`${names.length} build entries but ${builds.length} readable: versionName, versionCode and commit must be the first three lines of each`);
  }
  if (names.length > 1) {
    problems.push(`${names.length} versions are built; F-Droid asked for the current one alone, so drop ${builds.slice(0, -1).map((b) => b[1]).join(", ")}`);
  }

  const last = builds.at(-1);
  if (!last) return problems;
  const [, version, code, commit] = last;
  if (Number(code) !== codeFor(version)) {
    problems.push(`${version} should be versionCode ${codeFor(version)}, not ${code}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    problems.push(`commit must be a full hash, not "${commit}": F-Droid refuses a tag or a branch there`);
  }

  // fdroid rewritemeta rewrites the file its own way and CI fails when the two differ. The one
  // that keeps catching us: the blank line between the last build and the key after it.
  if (/^ {6}- .*\n[A-Za-z]/m.test(text)) {
    problems.push("the Builds block needs a blank line after it, or fdroid rewritemeta rewrites the file and CI refuses it");
  }

  const current = /^CurrentVersion: '([^']+)'/m.exec(text)?.[1];
  const currentCode = /^CurrentVersionCode: (\d+)/m.exec(text)?.[1];
  if (current !== version) problems.push(`CurrentVersion is ${current ?? "missing"}, but the build is ${version}`);
  if (currentCode !== code) problems.push(`CurrentVersionCode is ${currentCode ?? "missing"}, but the build is ${code}`);

  return problems;
}

const run = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""));
if (run) {
  const path = process.argv[2] ?? new URL("app.omnitext.yml", import.meta.url).pathname;
  const text = readFileSync(path === "-" ? 0 : path, "utf8");
  const problems = checkRecipe(text);
  if (problems.length) {
    console.error(`${path === "-" ? "recipe" : path}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`${path === "-" ? "recipe" : path}: one version, consistent`);
}
