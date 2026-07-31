// Which build of the app this is.
//
// Two peers must be running the same code before an edit keyed by position means the same
// thing on both sides: pdfedit reconstructs paragraphs heuristically, so "paragraph 3 of
// page 2" is only a shared name between peers whose pdfedit agrees. The app's commit pins
// every editor library through the lockfile, so one check covers all of them.
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
