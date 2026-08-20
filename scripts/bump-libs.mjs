#!/usr/bin/env node
// Bump the in-house git-dependency libraries to their latest `main` HEAD and verify.
//
// These libs live on GitHub (not npm) and are pinned by commit SHA in package-lock.json. `npm
// outdated` is blind to them, but Dependabot is NOT: it opens a per-lib PR when a lib's `main`
// HEAD moves, so it normally keeps the consumer current on its own. This script stays as a manual
// "bump every lib at once" shortcut for when you don't want to wait for the weekly PRs. Run it,
// then commit the updated package-lock.json. `npm install github:<owner>/<lib>` re-resolves to
// the newest commit on the default branch.
import { execSync } from "node:child_process";

const OWNER = "hikashop-nicolas";
/** Libraries this app depends on directly. */
const LIBS = ["richdoc", "pdfedit", "geoedit", "sheetedit", "mediaplay", "subedit", "imageview",
              "cadview"];
/**
 * Libraries reached THROUGH those, which `npm install github:...` on the parent does not move:
 * the lockfile already holds a commit that satisfies the parent's unpinned spec, so npm keeps it.
 * That is how an Android build broke once, on a sheetedit that needed a vbalang export the pinned
 * commit did not have yet. `npm update` re-resolves them to their current HEAD.
 */
const NESTED = ["mlang", "vbalang", "localml"];
/**
 * Run a step, and say which one failed rather than printing a stack trace from inside this
 * script. execSync throws an Error whose message is the command line and whose stack is all
 * node internals, so a failed install reads as a crash in the bumper rather than as "github
 * was unreachable" or "the tests are red".
 */
const run = (cmd, what) => {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.error(`\n${what} failed: ${cmd}`);
    console.error("Nothing was committed. The lockfile may hold some of the bumps already, " +
                  "so check `git diff package-lock.json` before rerunning.");
    process.exit(1);
  }
};

for (const lib of LIBS) {
  console.log(`\n=== bumping ${lib} ===`);
  run(`npm install github:${OWNER}/${lib}`, `bumping ${lib}`);
}
console.log(`\n=== bumping the nested libs (${NESTED.join(", ")}) ===`);
run(`npm update ${NESTED.join(" ")}`, "bumping the nested libs");

console.log("\n=== typecheck ===");
run("npm run typecheck", "typecheck");
console.log("\n=== tests ===");
run("npm run test", "tests");

console.log("\nAll libs bumped and verified. Review `git diff package-lock.json`, then commit + push.");
