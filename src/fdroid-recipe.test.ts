import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The recipe (scripts/fdroid/app.omnitext.yml) is the copy we hand F-Droid, and it has twice gone
// up building the previous version as well as the current one, which a reviewer then had to ask
// about. The checker behind this also runs as a pre-commit hook in the fdroiddata clone, where
// the mistake actually lands.
const { checkRecipe, codeFor } = await import("../scripts/fdroid/check-recipe.mjs");

const recipe = readFileSync("scripts/fdroid/app.omnitext.yml", "utf8");

describe("the F-Droid recipe", () => {
  it("builds one version, with its code, commit and CurrentVersion agreeing", () => {
    expect(checkRecipe(recipe)).toEqual([]);
  });

  it("refuses a second version left behind", () => {
    const twice = recipe.replace(
      /^( {2}- versionName: '([^']+)'\n {4}versionCode: (\d+)\n {4}commit: \S+)/m,
      "  - versionName: '1.9'\n    versionCode: 10900\n    commit: 82e33d230c20ceab60ae3f881e9395bc60660ffd\n$1",
    );
    expect(checkRecipe(twice).join(" ")).toMatch(/2 versions are built/);
  });

  it("refuses a code that does not follow the version, and a commit that is not a hash", () => {
    expect(checkRecipe(recipe.replace(/versionCode: \d+/, "versionCode: 42")).join(" ")).toMatch(/versionCode/);
    expect(checkRecipe(recipe.replace(/commit: [0-9a-f]{40}/, "commit: fdroid-1.10")).join(" ")).toMatch(/full hash/);
  });

  it("numbers versions the way the build file does", () => {
    expect(codeFor("1.9")).toBe(10900);
    expect(codeFor("1.10")).toBe(11000);
    expect(codeFor("1.11")).toBe(11100);
    const gradle = readFileSync("android/app/build.gradle", "utf8");
    const name = /versionName "([^"]+)"/.exec(gradle)![1]!;
    const code = Number(/fdroidVersionCode = (\d+)/.exec(gradle)![1]);
    expect(code, `fdroidVersionCode for ${name}`).toBe(codeFor(name));
  });
});
