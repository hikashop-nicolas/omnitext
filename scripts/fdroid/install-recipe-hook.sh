#!/bin/sh
# Put the recipe check in front of commits to a fdroiddata clone, where the copy we send F-Droid
# lives. Hooks are not cloned, so run this once per checkout:
#   scripts/fdroid/install-recipe-hook.sh [path to fdroiddata]
set -e
dir="${1:-$HOME/dev/fdroiddata}"
[ -d "$dir/.git" ] || { echo "not a git checkout: $dir" >&2; exit 1; }
checker=$(cd "$(dirname "$0")" && pwd)/check-recipe.mjs

cat > "$dir/.git/hooks/pre-commit" <<EOF
#!/bin/sh
# Omnitext's recipe: refuse a commit that builds more than one version, or whose version, code
# and commit disagree. Installed by omnitext's scripts/fdroid/install-recipe-hook.sh.
set -e
f=metadata/app.omnitext.yml
git diff --cached --name-only | grep -qx "\$f" || exit 0
checker=$checker
[ -f "\$checker" ] || exit 0   # no app checkout: nothing to check against
git show ":\$f" | node "\$checker" - || {
  echo "(commit refused by .git/hooks/pre-commit; --no-verify overrides)" >&2
  exit 1
}
EOF
chmod +x "$dir/.git/hooks/pre-commit"
echo "installed: $dir/.git/hooks/pre-commit"
