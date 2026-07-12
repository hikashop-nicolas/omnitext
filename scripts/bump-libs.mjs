#!/usr/bin/env node
// Bump the in-house git-dependency libraries to their latest `main` HEAD and verify.
//
// These libs live on GitHub (not npm) and are pinned by commit SHA in package-lock.json, so
// `npm outdated` and Dependabot are blind to them: nothing tells you the consumer is behind a
// lib you just pushed. Run this after pushing a lib fix to pull every lib's latest, then commit
// the updated package-lock.json. `npm install github:<owner>/<lib>` re-resolves to the newest
// commit on the default branch.
import { execSync } from "node:child_process";

const OWNER = "hikashop-nicolas";
const LIBS = ["richdoc", "pdfedit", "geoedit", "sheetedit", "mediaplay"];
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

for (const lib of LIBS) {
  console.log(`\n=== bumping ${lib} ===`);
  run(`npm install github:${OWNER}/${lib}`);
}

console.log("\n=== typecheck ===");
run("npm run typecheck");
console.log("\n=== tests ===");
run("npm run test");

console.log("\nAll libs bumped and verified. Review `git diff package-lock.json`, then commit + push.");
