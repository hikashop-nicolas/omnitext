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
#   scripts/fdroid/build-wasm.sh restore    # put the npm files back after a local run
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

# 7-Zip (Omnitext only writes .7z with it), the way 7z-wasm builds it: 7-Zip 24.09 source, its
# emscripten patch and flags, Emscripten 4.0.10. Built WITHOUT RAR: 7-Zip's RAR code carries the
# unRAR licence, which F-Droid counts as non-free. Reading RAR goes through libarchive, whose RAR
# reader is its own BSD code, so nothing is lost; the output differs from npm for that reason.
SEVENZIP_SRC="https://github.com/ip7z/7zip/releases/download/24.09/7z2409-src.tar.xz"
SEVENZIP_SHA256="49c05169f49572c1128453579af1632a952409ced028259381dac30726b6133a"
build_7zip() {
  v="$(npm_version 7z-wasm)"
  echo "7-Zip 24.09 via 7z-wasm $v (no RAR)"
  emsdk_use 4.0.10
  [ -d "$WORK/7z-wasm" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch "v$v" https://github.com/use-strict/7z-wasm.git "$WORK/7z-wasm"
  tarball="$WORK/7z2409-src.tar.xz"
  [ -f "$tarball" ] || curl -sSfL -o "$tarball" "$SEVENZIP_SRC"
  echo "$SEVENZIP_SHA256  $tarball" | sha256sum -c --quiet
  src="$WORK/7zip" && rm -rf "$src" && mkdir -p "$src" && tar xJf "$tarball" -C "$src"
  # git apply copes with 7-Zip's CRLF sources (patch does not), but inside Omnitext's repository
  # it resolves paths against that repository and silently skips these: give it its own.
  (cd "$src" && git init -q && git apply --ignore-whitespace "$WORK/7z-wasm/7zz-emcc.patch")
  (
    cd "$src/CPP/7zip/Bundles/Alone2"
    # build-es6.env is in docker --env-file format (unquoted values with spaces): export by line.
    while IFS= read -r line; do [ -n "$line" ] && export "$line"; done < "$WORK/7z-wasm/build-es6.env"
    emmake make -j"$(nproc)" -f makefile.emcc DISABLE_RAR=1 >"$WORK/7zip-build.log" 2>&1 || { tail -20 "$WORK/7zip-build.log"; exit 1; }
  )
  install_over "$src/CPP/7zip/Bundles/Alone2/_o/7zz.js" node_modules/7z-wasm/7zz.es6.js
  install_over "$src/CPP/7zip/Bundles/Alone2/_o/7zz.wasm" node_modules/7z-wasm/7zz.wasm
}

# Put the npm files back (after a local run: a Play or web build must not pick up these).
build_restore() {
  echo "restore npm binaries"
  [ -d "$WORK/npm-originals" ] || return 0
  (cd "$WORK/npm-originals" && find . -type f) | while read -r f; do cp "$WORK/npm-originals/$f" "$ROOT/$f"; echo "  $f"; done
}

ALL="alac sqljs libav 7zip"
for target in ${*:-$ALL}; do
  "build_$target"
done
