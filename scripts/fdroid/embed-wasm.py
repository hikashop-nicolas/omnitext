#!/usr/bin/env python3
"""Put a freshly built .wasm back into the JavaScript file that carries it as base64.

Several npm packages ship their WebAssembly as a base64 string inside a .js rather than as a
.wasm beside it, which is how they escaped build-wasm.sh for so long. Rebuilding them means
replacing that one string: everything else in the file is the package's own JavaScript and
stays as it is.

    embed-wasm.py <built.wasm> <js-file-with-the-string> <output.js>
"""
import base64
import re
import sys

wasm_path, js_path, out_path = sys.argv[1:4]

wasm = open(wasm_path, "rb").read()
if wasm[:4] != b"\0asm":
    sys.exit(f"{wasm_path} is not WebAssembly (magic {wasm[:4]!r})")
encoded = base64.b64encode(wasm).decode("ascii")

source = open(js_path, encoding="utf8").read()
# The longest base64-looking run in the file is the binary; anything shorter is ordinary code.
runs = [m for m in re.finditer(r"[A-Za-z0-9+/]{500,}={0,2}", source)]
if not runs:
    sys.exit(f"no embedded binary found in {js_path}")
longest = max(runs, key=lambda m: len(m.group(0)))
old = longest.group(0)
if base64.b64decode(old + "=" * (-len(old) % 4))[:4] != b"\0asm":
    sys.exit(f"the longest string in {js_path} is not WebAssembly; refusing to replace it")

out = source[: longest.start()] + encoded + source[longest.end() :]
open(out_path, "w", encoding="utf8").write(out)
same = "identical to" if encoded == old else "differs from"
print(f"  embedded {len(wasm) / 1024:.0f} KB, {same} the shipped binary")
