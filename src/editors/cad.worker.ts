// Reads DXF and DWG files off the main thread, for the CAD viewer.
//
// Parsing a drawing and building its scene takes seconds on a large file, and on the main
// thread that is a frozen page: no spinner, no scroll, nothing to say the app is alive.
// cadview does the work; this only makes it a worker.
//
// The entry point is cadview's own rather than DxfViewer.SetupWorker(), which would pull
// the WebGL renderer in here to run code that never draws.
import "cadview/src/worker.js";
