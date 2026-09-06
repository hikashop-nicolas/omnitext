# Archive fixtures

Small archives for `libarchive.test.ts`, which covers the formats fflate cannot read.
Each holds the same two files, so a test can assert the same contents whatever the
container:

```
note.txt      "hello from an archive\n"
src/data.json '{"n":1}\n'
```

| File | What it exercises |
| --- | --- |
| `sample.7z` | 7z, several entries including one in a subdirectory |
| `sample.tar.xz` | a tar wrapped in xz: entry names come from the tar inside |
| `sample.tar.bz2` | the same for bzip2 |
| `note.txt.xz` | a bare xz of a single file, which carries no name of its own |
| `note.txt.bz2` | the same for bzip2 |

Regenerate with `xz`, `bzip2`, `tar` and any `7za` (the 7z one was made with the binary
from the `7zip-bin` npm package, since macOS ships no 7z tool):

```sh
mkdir -p fx/src && printf 'hello from an archive\n' > fx/note.txt && printf '{"n":1}\n' > fx/src/data.json
cd fx
7za a ../sample.7z note.txt src
tar -cf - note.txt src | xz -9   > ../sample.tar.xz
tar -cf - note.txt src | bzip2 -9 > ../sample.tar.bz2
xz -9 -c note.txt    > ../note.txt.xz
bzip2 -9 -c note.txt > ../note.txt.bz2
```

**There is deliberately no RAR fixture.** RAR extraction is free, but *creating* one needs
the proprietary `rar` tool, and no free encoder exists. So the RAR path is covered as far
as it honestly can be, by its signature, and the extraction itself is not. Adding a real
`.rar` here later would close that gap.
