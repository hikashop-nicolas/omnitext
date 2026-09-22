#!/usr/bin/env bash
# Signs the APK from an F-Droid dry run with the Omnitext release key, for the fdroid-<version>
# GitHub release (the recipe's Binaries). apksigner asks for the keystore password itself.
#   scripts/fdroid/sign-apk.sh <unsigned.apk> <version>
set -euo pipefail
in=$1 version=$2
out="$HOME/Downloads/omnitext-fdroid-$version.apk"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
tools=$(ls -d "$HOME"/Library/Android/sdk/build-tools/*/ | tail -1)
"$tools/zipalign" -c -P 16 4 "$in"
# --alignment-preserved: F-Droid compares its own build byte for byte, so signing must not move anything.
"$tools/apksigner" sign --alignment-preserved --ks "$HOME/.keys/omnitext-release.keystore" --out "$out" "$in"
"$tools/apksigner" verify --print-certs "$out" | grep SHA-256
echo "signed: $out"
