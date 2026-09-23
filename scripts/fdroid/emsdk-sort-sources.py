#!/usr/bin/env python3
"""Make an old Emscripten build its system libraries in a fixed order.

Emscripten before 3.x collects musl's sources with os.walk and iglob, so the libc it caches,
and the layout of everything linked against it, follow the filesystem's directory order and
differ from one machine to the next. Upstream sorted these lists later for the same reason;
this applies that to the toolchain the libass build pins.

Takes the path of tools/system_libs.py. Exits 0 when it patched the file (the toolchain cache
then has to be rebuilt), 1 when there was nothing to do.
"""
import sys

MARK = "# sorted for reproducibility\n"
EDITS = [
    ("  return [f for f in files if os.path.basename(f) not in excludes]\n",
     "  return sorted(f for f in files if os.path.basename(f) not in excludes)\n"),
    ("    for dirpath, dirnames, filenames in os.walk(musl_srcdir):\n",
     "    for dirpath, dirnames, filenames in os.walk(musl_srcdir):\n"
     "      dirnames.sort()\n"
     "      filenames.sort()\n"),
    ('def create_lib(libname, inputs):\n  """Create a library from a set of input objects."""\n',
     'def create_lib(libname, inputs):\n  """Create a library from a set of input objects."""\n'
     "  inputs = sorted(inputs, key=os.path.basename)\n"),
]

path = sys.argv[1]
source = open(path).read()
if MARK in source:
    sys.exit(1)
patched = source
for old, new in EDITS:
    patched = patched.replace(old, new)
if patched == source:
    sys.exit(1)
open(path, "w").write(MARK + patched)
