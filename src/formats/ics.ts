import type { FormatDescriptor } from "../core/types";

// iCalendar (.ics): calendar events, rendered by the PIM viewer; raw text editing stays
// available via the text editor.
export const icsFormat: FormatDescriptor = {
  manifest: {
    kind: "format",
    id: "ics",
    extensions: [".ics", ".ical", ".ifb"],
    mimeTypes: ["text/calendar"],
    nativeEditor: "pimviewer",
    defaultEditor: "pimviewer",
  },
  detect: ({ sample }) => (/BEGIN:VCALENDAR/i.test(sample) ? 0.9 : 0),
  load: () => import("./pim.impl").then((m) => m.pimImpl),
};
