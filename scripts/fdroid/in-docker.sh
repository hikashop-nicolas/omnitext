#!/bin/sh
# Run build-wasm.sh in a clean Debian, the environment F-Droid's build servers use, so a local
# run proves what F-Droid will get. Arguments pass through (e.g. `in-docker.sh sqljs`).
# Needs `npm ci` done first; the repository, node_modules included, is mounted as is.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec docker run --rm -v "$ROOT:/repo" -w /repo debian:bookworm sh -c '
  apt-get -qq update >/dev/null &&
  apt-get -qq install -y --no-install-recommends git python3 make curl ca-certificates xz-utils bzip2 nodejs libdigest-sha3-perl libatomic1 unzip pkg-config patch gcc libc6-dev perl cmake ragel libtool itstool python3-ply gettext autopoint automake autoconf m4 gperf licensecheck gawk >/dev/null &&
  scripts/fdroid/build-wasm.sh "$@"' sh "$@"
