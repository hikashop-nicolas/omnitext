#!/bin/sh
# Make the installed macOS PWA offer itself in Finder's "Open with" recommendations.
#
# Chrome writes an app shim for an installed PWA and fills its CFBundleDocumentTypes from
# the manifest's file_handlers, but never sets CFBundleTypeRole. Launch Services reads a
# role-less claim as "viewer", and Finder's recommended list is the editors, so the app is
# only reachable under "All Applications". Adding the role is the whole fix.
#
# Chrome rewrites the shim when it updates or when the manifest changes, which undoes this;
# run it again. Usage: scripts/macos-editor-role.sh [path to the .app]

set -e

APP="${1:-}"
if [ -z "$APP" ]; then
  for dir in "$HOME/Applications/Chrome Apps.localized" "$HOME/Applications/Chrome Apps" "/Applications/Chrome Apps.localized"; do
    [ -d "$dir/Omnitext.app" ] && APP="$dir/Omnitext.app" && break
  done
fi
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "No installed Omnitext app found. Install the PWA first, or pass its path." >&2
  exit 1
fi

PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Support/lsregister

count=$($PB -c "Print CFBundleDocumentTypes" "$PLIST" 2>/dev/null | grep -c "^    Dict {" || true)
if [ "$count" = "0" ]; then
  echo "$APP declares no file types, so there is nothing to claim." >&2
  exit 1
fi

i=0
changed=0
while [ "$i" -lt "$count" ]; do
  if $PB -c "Print CFBundleDocumentTypes:$i:CFBundleTypeRole" "$PLIST" >/dev/null 2>&1; then
    $PB -c "Set CFBundleDocumentTypes:$i:CFBundleTypeRole Editor" "$PLIST"
  else
    $PB -c "Add CFBundleDocumentTypes:$i:CFBundleTypeRole string Editor" "$PLIST"
  fi
  changed=$((changed + 1))
  i=$((i + 1))
done

# The shim is ad-hoc signed, and editing its plist voids that; sign it again the same way,
# or macOS refuses to launch it. Then tell Launch Services to read the bundle afresh.
codesign --force --sign - "$APP" >/dev/null 2>&1
"$LSREGISTER" -f "$APP"

echo "Claimed $changed file type group(s) in $APP as an editor."
echo "Finder may need a moment, or a relaunch, to show it in Open with."
