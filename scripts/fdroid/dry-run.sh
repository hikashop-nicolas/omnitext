#!/usr/bin/env bash
# Build app.omnitext the way F-Droid's servers do, in the buildserver image, from a local
# fdroiddata checkout. Use it before pushing a recipe change, and to produce the APK that is
# signed as the recipe's reference binary (scripts/fdroid/sign-apk.sh).
#   scripts/fdroid/dry-run.sh [fdroiddata-dir] [appid:versionCode]
#
# The checkout is mounted at /home/vagrant on purpose. fdroid builds in build/<appid> under the
# working directory, so the absolute path of the sources ends up compiled into the binaries:
# onnxruntime embeds 640 of them (abseil's assertions carry __FILE__). F-Droid's buildserver and
# its CI both build in /home/vagrant/build/app.omnitext, so anywhere else produces a different
# binary and the reference comparison fails. The flags match the ones fdroiddata's CI uses.
set -euo pipefail
dir="${1:-$HOME/dev/omnitext-fdroid-dryrun}"
target="${2:-app.omnitext:10900}"
cd "$dir"
# fdroid reads SOURCE_DATE_EPOCH from the app checkout before it would clone it, so a missing
# one crashes the run. CI inherits the clone from a previous job; make it here instead.
appid="${target%%:*}"
if [ ! -d "build/$appid" ]; then
  git clone "$(sed -n 's/^Repo: *//p' "metadata/$appid.yml")" "build/$appid"
fi
echo "dry run start: $(date +%H:%M:%S)"
# Each entry separately: a single mount over /home/vagrant would hide the image's own
# fdroidserver, which lives there.
mounts=()
for e in build config config.yml logs metadata repo srclibs tmp unsigned; do
  [ -e "$e" ] && mounts+=(-v "$PWD/$e:/home/vagrant/$e")
done
# The end markers print whatever happens: a failing run is the one whose log gets read.
set +e
docker run --rm "${mounts[@]}" -w /home/vagrant \
  registry.gitlab.com/fdroid/docker-executable-fdroidserver:master \
  build --verbose --test --refresh-scanner --on-server --no-tarball "$target"
status=$?
echo "exit: $status"
echo "dry run end: $(date +%H:%M:%S)"
exit $status
