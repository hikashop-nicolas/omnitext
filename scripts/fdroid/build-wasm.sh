#!/bin/sh
# Compile Omnitext's WebAssembly binaries from source, for the F-Droid build.
#
# F-Droid builds apps from source and refuses prebuilt binaries from npm. Every .wasm the app
# ships is rebuilt here from pinned upstream sources and written over the copy npm installed,
# so the build that follows packages our compile instead. The Play and web builds never run this.
#
# Each binary pins the Emscripten version its upstream uses, which is what makes the result
# byte-identical to the npm file: the script reports IDENTICAL or differs for each one.
#
# Run after `npm ci` and before `npm run build`, from the repository root:
#   scripts/fdroid/build-wasm.sh            # every binary
#   scripts/fdroid/build-wasm.sh sqljs      # just one
# Needs git, python3, make, patch, gcc, curl, unzip, pkg-config, libatomic1, node, and sha3sum (Debian: libdigest-sha3-perl). Locally, run it in a
# clean Debian through scripts/fdroid/in-docker.sh, which is what F-Droid's servers look like.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/scripts/fdroid/work"
EMSDK_TAG="5.0.0" # the emsdk checkout itself; it installs any compiler version below
mkdir -p "$WORK"
cd "$ROOT"
BASE_PATH="$PATH" # each emsdk_use starts from this, so versions do not stack

# Activate one Emscripten version, installing it on first use.
emsdk_use() {
  if [ ! -d "$WORK/emsdk" ]; then
    git -c advice.detachedHead=false clone -q --depth 1 --branch "$EMSDK_TAG" https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
  fi
  (cd "$WORK/emsdk" && ./emsdk install "$1" >/dev/null && ./emsdk activate "$1" >/dev/null)
  # emsdk_env.sh cannot locate itself when sourced from plain sh, so set what it would.
  export EMSDK="$WORK/emsdk" EM_CONFIG="$WORK/emsdk/.emscripten"
  PATH="$EMSDK/upstream/emscripten:$EMSDK:$(dirname "$(ls -d "$EMSDK"/node/*/bin/node | tail -1)"):$BASE_PATH"
  echo "  emcc $(emcc --version | head -1 | sed 's/.*) //')"
}

# Keep the npm file aside (once, under work/, never next to it: some folders ship whole),
# install ours over it, and say whether they match.
install_over() { # built-file npm-file
  orig="$WORK/npm-originals/$2"
  [ -f "$orig" ] || { mkdir -p "$(dirname "$orig")" && cp "$2" "$orig"; }
  cp "$1" "$2"
  if cmp -s "$2" "$orig"; then echo "  IDENTICAL $(basename "$2")"; else echo "  differs   $(basename "$2")"; fi
}

npm_version() { node -p "require('./node_modules/$1/package.json').version"; }

# ALAC decoder, mediaplay's build of Apple's reference sources (shipped inside the package).
build_alac() {
  echo "alac"
  emsdk_use 4.0.7
  src="$WORK/alac"
  rm -rf "$src" && cp -R node_modules/mediaplay/alac "$src" && rm -f "$src"/dist/*
  ALAC_EMCC=emcc sh "$src/build.sh" >/dev/null
  for f in alac.wasm alac.mjs; do install_over "$src/dist/$f" "node_modules/mediaplay/alac/dist/$f"; done
}

# sql.js, at the version npm installed. The app loads the browser glue with the generic wasm, so
# both builds are replaced together.
build_sqljs() {
  v="$(npm_version sql.js)"
  echo "sql.js $v"
  emsdk_use 5.0.0
  src="$WORK/sql.js"
  [ -d "$src" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch "v$v" https://github.com/sql-js/sql.js.git "$src"
  make -C "$src" dist/sql-wasm.js dist/sql-wasm-browser.js >/dev/null
  for f in sql-wasm.js sql-wasm.wasm sql-wasm-browser.js sql-wasm-browser.wasm; do
    install_over "$src/dist/$f" "node_modules/sql.js/dist/$f"
  done
}

# libav.js audio decoders (AC-3, E-AC-3, DTS, TrueHD), mediaplay's configuration: see
# node_modules/mediaplay/libav/NOTICE.md. The version comes from the file names it ships.
build_libav() {
  v="$(ls node_modules/mediaplay/libav/ | sed -n 's/^libav-\(.*\)-audio\.mjs$/\1/p')"
  echo "libav.js $v"
  emsdk_use 5.0.0
  src="$WORK/libav.js"
  [ -d "$src" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch "v$v" https://github.com/Yahweasel/libav.js.git "$src"
  (cd "$src/configs" && node mkconfig.js audio '["avcodec","decoder-eac3","decoder-ac3","parser-ac3","decoder-dca","parser-dca","decoder-truehd","decoder-mlp","parser-mlp"]')
  # From inside the checkout, not make -C: its Makefile installs to $(PWD)/build/inst, and -C
  # leaves PWD pointing at the caller (the library then lands outside and the link fails).
  (cd "$src" && PWD="$src" make -j"$(nproc)" build-audio) >"$WORK/libav-build.log" 2>&1 || { tail -20 "$WORK/libav-build.log"; exit 1; }
  for f in "libav-$v-audio.mjs" "libav-$v-audio.wasm.mjs" "libav-$v-audio.wasm.wasm"; do
    install_over "$src/dist/$f" "node_modules/mediaplay/libav/$f"
  done
}

ALL="alac sqljs libav"
for target in ${*:-$ALL}; do
  "build_$target"
done
