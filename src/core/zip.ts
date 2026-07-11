// Promise wrappers over fflate's asynchronous codec. The async functions run deflate /
// inflate on a Web Worker (fflate spins one up internally), so compressing or extracting a
// large archive on save/open no longer blocks the main thread. The synchronous fflate calls
// stay in use for the tiny fixed-size payloads (blank templates) where a worker is not worth
// its startup cost.
import { gunzip, gzip, unzip, zip, type AsyncZippable, type Unzipped } from "fflate";

export function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => zip(files, (err, data) => (err ? reject(err) : resolve(data))));
}

export function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(bytes, (err, data) => (err ? reject(err) : resolve(data))));
}

export function gzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gzip(bytes, (err, data) => (err ? reject(err) : resolve(data))));
}

export function gunzipAsync(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => gunzip(bytes, (err, data) => (err ? reject(err) : resolve(data))));
}
