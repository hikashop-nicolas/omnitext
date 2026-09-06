import SevenZip from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";
import type { ArchiveEntry } from "./archive";

// Writing 7z archives, so a file edited from inside one can be saved back into it.
//
// This is 7-Zip itself compiled to wasm, rather than a hand-written encoder: the container
// is intricate and getting it subtly wrong produces an archive that other tools reject.
// It is LGPL (plus the unRAR restriction that forbids building a RAR compressor from it,
// which nothing here does), kept as its own lazily-loaded chunk and never bundled into the
// page. See public/7z/NOTICE.md.
//
// Reading stays with libarchive: it is already there, already lazy, and smaller.

let modPromise: Promise<Awaited<ReturnType<typeof SevenZip>>> | null = null;
function loadModule() {
  // Silenced: 7-Zip is a command-line program and chatters on stdout.
  if (!modPromise) {
    modPromise = SevenZip({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
  }
  return modPromise;
}

/** The bits of emscripten's FS this file uses. */
interface VirtualFs {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  chdir(path: string): void;
  cwd(): string;
}

/** Delete a directory and everything under it, if it is there at all. */
function rmrf(fs: VirtualFs, path: string): void {
  let names: string[];
  try {
    names = fs.readdir(path);
  } catch {
    return; // not there, which is the state we wanted
  }
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const child = `${path}/${name}`;
    if (fs.isDir(fs.stat(child).mode)) rmrf(fs, child);
    else fs.unlink(child);
  }
  fs.rmdir(path);
}

/** Create every parent directory of an entry path inside the module's virtual filesystem. */
function makeDirs(fs: VirtualFs, path: string): void {
  const parts = path.split("/").slice(0, -1);
  let sofar = "";
  for (const part of parts) {
    if (!part) continue;
    sofar += `/${part}`;
    try {
      fs.mkdir(sofar);
    } catch {
      /* already there */
    }
  }
}

/**
 * Pack entries into a .7z, compressed as 7-Zip would.
 *
 * Every entry is written into the module's in-memory filesystem and handed to the real
 * archiver, so the result is a genuine 7z rather than an approximation of one. Directory
 * entries are implied by the paths, as 7-Zip records them itself.
 */
export async function writeSevenZip(entries: ArchiveEntry[]): Promise<Uint8Array> {
  const sz = await loadModule();
  const out = "/out.7z";
  const work = "/work";
  rmrf(sz.FS, work); // a previous save's files must not end up in this archive
  sz.FS.mkdir(work);

  // Names are added relative to the working directory. Handing 7-Zip absolute paths instead
  // flattens anything in a subdirectory, so "src/data.json" came back as "data.json" or not
  // at all.
  const roots = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.replace(/^\.?\/+/, "");
    if (!name || name.endsWith("/")) continue; // directories follow from the paths
    const path = `${work}/${name}`;
    makeDirs(sz.FS, path);
    sz.FS.writeFile(path, entry.data);
    roots.add(name.split("/")[0]!);
  }
  if (roots.size === 0) throw new Error("7z: nothing to write");

  const cwd = sz.FS.cwd();
  sz.FS.chdir(work);
  try {
    // -mx=5 is 7-Zip's own default, said out loud because "fast" would quietly make every
    // save-back produce a bigger archive than the one it replaced.
    sz.callMain(["a", "-t7z", "-mx=5", "-bso0", "-bsp0", out, ...roots]);
  } finally {
    sz.FS.chdir(cwd);
  }

  const bytes = new Uint8Array(sz.FS.readFile(out));
  rmrf(sz.FS, work);
  try {
    sz.FS.unlink(out);
  } catch {
    /* nothing to clean up */
  }
  return bytes;
}
