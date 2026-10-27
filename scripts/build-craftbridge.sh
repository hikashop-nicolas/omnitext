#!/bin/sh
# Builds the PDF engine (PdfCraft's Rust engine as wasm, through craftbridge) into vendor/craftbridge, at the
# commit in craftbridge.rev. Needs git, a Rust toolchain with the wasm32-unknown-unknown target, and
# wasm-bindgen-cli (INSTALL_WASM_BINDGEN=1 installs the one the engine asks for); binaryen's wasm-opt is optional.
# Then build Omnitext with CRAFTBRIDGE_DIR=$PWD/vendor/craftbridge (a build refuses to go on without the engine).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
rev=$(tr -d '[:space:]' < "$here/craftbridge.rev")
dir="$here/vendor/craftbridge"
# A folder that already holds build output (a CI cache) is not a clone yet: start the repository in place.
if [ ! -d "$dir/.git" ]; then
  git init --quiet "$dir"
  git -C "$dir" remote add origin https://github.com/hikashop-nicolas/craftbridge.git
fi
git -C "$dir" fetch --quiet origin "$rev"
git -C "$dir" checkout --quiet --detach "$rev"
sh "$dir/scripts/build-wasm.sh"
