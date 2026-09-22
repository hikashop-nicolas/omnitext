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
# Needs git, python3, perl, make, patch, gcc, curl, unzip, pkg-config, libatomic1, node, sha3sum
# (Debian: libdigest-sha3-perl), and for libass: cmake ragel libtool libtool-bin itstool python3-ply gettext
# autopoint automake autoconf m4 gperf licensecheck gawk. Locally, run it in a
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

# Download a source archive once and check it against the pinned checksum.
fetch() { # url sha256 -> prints the local path
  f="$WORK/dl/$(basename "$1")"
  mkdir -p "$WORK/dl"
  [ -f "$f" ] || curl -sSfL -o "$f" "$1"
  echo "$2  $f" | sha256sum -c --quiet >&2
  echo "$f"
}

# libarchive (reads 7z, RAR, xz, bz2...), following libarchive-wasm's lib/Dockerfile and
# lib/build.bash: static OpenSSL, zlib, bzip2 and xz, then libarchive, then its small C binding,
# on Emscripten 4.0.5. Installed into a prefix under work/ instead of /usr/local.
build_libarchive() {
  v="$(npm_version libarchive-wasm)"
  echo "libarchive 3.7.7 via libarchive-wasm $v"
  emsdk_use 4.0.5
  [ -d "$WORK/libarchive-wasm/.git" ] || git -c advice.detachedHead=false clone -q --depth 1 --branch "v$v" https://github.com/ofk/libarchive-wasm.git "$WORK/libarchive-wasm"
  P="$WORK/la-prefix" B="$WORK/la-build" LOG="$WORK/libarchive-build.log"
  rm -rf "$P" "$B" && mkdir -p "$P" "$B" && : > "$LOG"
  step() { "$@" >>"$LOG" 2>&1 || { tail -25 "$LOG"; exit 1; }; }

  cd "$B" && tar xf "$(fetch https://github.com/openssl/openssl/releases/download/openssl-3.4.1/openssl-3.4.1.tar.gz 002a2d6b30b58bf4bea46c43bdd96365aaf8daa6c428782aa4feee06da197df3)"
  cd openssl-3.4.1
  step emmake bash -c "./Configure no-asm no-deprecated no-dso no-ssl3 no-tests -static linux-generic32 --prefix=$P --libdir=lib"
  sed -i 's/CROSS_COMPILE=\/.*\/em/CROSS_COMPILE=/' Makefile
  step emmake make -j"$(nproc)"
  step emmake make install_sw

  cd "$B" && unzip -q "$(fetch https://github.com/madler/zlib/archive/v1.3.1.zip 50b24b47bf19e1f35d2a21ff36d2a366638cdf958219a66f30ce0861201760e6)"
  cd zlib-1.3.1 && step emconfigure ./configure --static --prefix="$P" && step emmake make -j"$(nproc)" && step emmake make install

  cd "$B" && tar xf "$(fetch https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269)"
  cd bzip2-1.0.8 && step make CC=emcc AR=emar RANLIB=emranlib libbz2.a && step make CC=emcc AR=emar RANLIB=emranlib PREFIX="$P" install

  cd "$B" && tar xf "$(fetch https://github.com/tukaani-project/xz/releases/download/v5.6.4/xz-5.6.4.tar.gz 269e3f2e512cbd3314849982014dc199a7b2148cf5c91cedc6db629acdf5e09b)"
  cd xz-5.6.4 && sed -i 's/defined(__wasm__)/0/' src/common/mythread.h
  step emconfigure ./configure --host=wasm32-unknown-emscripten --disable-assembler --enable-threads=no --enable-static=yes --disable-shared --enable-symbol-versions=no --prefix="$P"
  step emmake make -j"$(nproc)" && step emmake make install

  cd "$B" && unzip -q "$(fetch https://github.com/libarchive/libarchive/releases/download/v3.7.7/libarchive-3.7.7.zip 2fb3a5aef8e3d20b6c3f70265d04385045d4f5be098c5f969c60caaf9251b63a)"
  cd libarchive-3.7.7
  step env CPPFLAGS="-I$P/include" LDLIBS="-lz -lbz2 -lssl -lcrypto" LDFLAGS="-L$P/lib" emconfigure ./configure --host=wasm32-unknown-emscripten --prefix="$P" \
    --disable-shared --enable-static --enable-bsdtar=static --enable-bsdcat=static --enable-bsdcpio=static \
    --enable-posix-regex-lib=libc --disable-xattr --disable-acl \
    --without-lz4 --without-lzo2 --without-cng --without-nettle --without-xml2 --without-expat
  step env CPPFLAGS="-I$P/include" LDLIBS="-lz -lbz2 -lssl -lcrypto" LDFLAGS="-L$P/lib" emmake make -j"$(nproc)"
  step emmake make install

  cd "$WORK/libarchive-wasm/lib" && mkdir -p "$B/out"
  step emcc ./libarchive.c -I "$P/include" "$P/lib/libarchive.a" \
    "$P/lib/libz.a" "$P/lib/libbz2.a" "$P/lib/liblzma.a" "$P/lib/libssl.a" "$P/lib/libcrypto.a" \
    -o "$B/out/libarchive.js" \
    -s MODULARIZE=1 -s EXPORT_NAME=libarchive -s WASM=1 -s WASM_BIGINT=0 -O3 -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='["cwrap"]' -s EXPORTED_FUNCTIONS=@./exported_functions.json \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0
  cd "$ROOT"
  install_over "$B/out/libarchive.js" node_modules/libarchive-wasm/dist/libarchive.js
  install_over "$B/out/libarchive.wasm" node_modules/libarchive-wasm/dist/libarchive.wasm
}

# libass and its font stack (freetype, harfbuzz, fribidi, fontconfig, expat, brotli), through
# JavascriptSubtitlesOctopus at the version npm installed: its Makefile builds every dependency
# from the git submodules it pins, on Emscripten 2.0.34 (its Dockerfile's version).
build_libass() {
  v="$(npm_version @jellyfin/libass-wasm)"
  echo "libass via JavascriptSubtitlesOctopus $v"
  emsdk_use 2.0.34
  src="$WORK/JavascriptSubtitlesOctopus"
  [ -d "$src" ] || git -c advice.detachedHead=false clone -q --recurse-submodules --shallow-submodules --depth 1 --branch "v$v" https://github.com/jellyfin/JavascriptSubtitlesOctopus.git "$src"
  # Libraries first: the Makefile's phony all-src step can race them under -j (upstream builds
  # without -j), compiling the wrapper before libass is installed. Then only the worker: the full
  # `dist` also regenerates the licence notice, whose lint fails on Debian's newer licensecheck,
  # and the app keeps npm's COPYRIGHT anyway.
  (cd "$src" && make -j"$(nproc)" "$src/dist/libraries/lib/libass.a" && make -j"$(nproc)" dist/js/subtitles-octopus-worker.js) >"$WORK/libass-build.log" 2>&1 || { tail -25 "$WORK/libass-build.log"; exit 1; }
  for f in subtitles-octopus-worker.js subtitles-octopus-worker.wasm; do
    install_over "$src/dist/js/$f" "node_modules/@jellyfin/libass-wasm/dist/js/$f"
  done
}

# Put the npm files back (after a local run: a Play or web build must not pick up these).
build_restore() {
  echo "restore npm binaries"
  [ -d "$WORK/npm-originals" ] || return 0
  (cd "$WORK/npm-originals" && find . -type f) | while read -r f; do cp "$WORK/npm-originals/$f" "$ROOT/$f"; echo "  $f"; done
}

ALL="alac sqljs libav 7zip libarchive libass"
for target in ${*:-$ALL}; do
  "build_$target"
done
