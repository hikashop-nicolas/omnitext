import type { FormatDescriptor } from "../core/types";

// 3D model files: opened read-only in the three.js model viewer. Treated as bytes (STL,
// PLY, GLB are binary; OBJ and glTF are text but the viewer decodes bytes uniformly).
export const model3dFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "model3d",
    extensions: [".stl", ".ply", ".obj", ".glb", ".gltf"],
    mimeTypes: ["model/gltf-binary", "model/gltf+json", "model/stl", "model/obj"],
    binary: true,
    nativeEditor: "model3dviewer",
    defaultEditor: "model3dviewer",
    soleEditor: true,
  },
  detect: () => 0, // routed by extension
  // .stl is shared with Spruce subtitles: a model unless it opens like one (timecode, $ directive, // comment).
  sniffBytes: (head) => !/^(\d{2}:\d{2}:\d{2}:\d{2},|\$|\/\/)/.test(String.fromCharCode(...head.subarray(0, 12))),
  load: () => import("./model3d.impl").then((m) => m.model3dImpl),
};
