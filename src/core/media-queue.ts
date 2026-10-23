// The mediaplay side of a queue: turning handed-over files or a playlist file into entries, and
// describing the playing queue to the app. What the app and the editor pass each other lives in
// media-handoff.ts, which does not import the player.

import { pickFolderFiles, relativePath, type ActiveQueue, type HandedFile } from "./media-handoff";
import {
  entriesFromFiles,
  entriesFromPlaylist,
  fileFinder,
  parsePlaylist,
  playlistFromEntries,
  playlistKind,
  sortMedia,
  writeM3u,
  type PlaylistHandle,
  type QueueEntry,
} from "mediaplay";

/** The queue as the app asks for it: the M3U8 text and a name to save it under. */
export function activeQueueOf(handle: PlaylistHandle): ActiveQueue {
  return {
    length: () => handle.getQueue().length,
    toM3u: () => writeM3u(playlistFromEntries(handle.getQueue())),
    suggestedName: () => {
      const first = handle.getQueue()[0]?.source ?? "";
      const folder = first.includes("/") && !first.startsWith("/") && !/^(\.\.|[a-z]:)/i.test(first) ? first.split("/")[0] : "";
      return `${folder || "playlist"}.m3u8`;
    },
  };
}

/** The queue for a playlist file and the files it can be resolved against. */
export async function queueFromPlaylistFile(file: File, among: readonly HandedFile[]): Promise<QueueEntry[]> {
  const items = parsePlaylist(await file.text(), file.name);
  return entriesFromPlaylist(items, fileFinder([...among], relativePath(file)));
}

export { entriesFromFiles, pickFolderFiles, playlistKind, sortMedia };
