#!/bin/sh
# Builds the PDF engine (PdfCraft's Rust engine as wasm, through craftbridge) into vendor/craftbridge, at the
# commit in craftbridge.rev. Needs git, a Rust toolchain with the wasm32-unknown-unknown target, and
# wasm-bindgen-cli (INSTALL_WASM_BINDGEN=1 installs the one the engine asks for); binaryen's wasm-opt is optional.
# Then build Omnitext with CRAFTBRIDGE_DIR=$PWD/vendor/craftbridge, or it keeps the classic PDF editor.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
rev=$(tr -d '[:space:]' < "$here/craftbridge.rev")
dir="$here/vendor/craftbridge"
if [ ! -d "$dir/.git" ]; then
  git clone --quiet https://github.com/hikashop-nicolas/craftbridge.git "$dir"
fi
git -C "$dir" fetch --quiet origin
git -C "$dir" checkout --quiet --detach "$rev"
sh "$dir/scripts/build-wasm.sh"
