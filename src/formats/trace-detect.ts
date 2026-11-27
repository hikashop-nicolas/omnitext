// Content checks for text traces, kept small: they run on every text file opened.

/** Whether a text sample clearly is a Chrome / Catapult JSON trace rather than other JSON. */
export function looksLikeChromeTrace(sample: string): boolean {
  if (/^\s*\{[\s\S]{0,4000}?"traceEvents"\s*:\s*\[/.test(sample)) return true;
  return /^\s*\[\s*\{/.test(sample) && /"ph"\s*:\s*"[A-Za-z]"/.test(sample) && /"ts"\s*:/.test(sample) && /"pid"\s*:/.test(sample);
}

/** Whether a text sample is a systrace / ftrace text dump or a systrace HTML page. */
export function looksLikeSystrace(sample: string): boolean {
  if (/^(?:TRACE:\s*)?# tracer: /m.test(sample.slice(0, 2000))) return true;
  return /<script[^>]*class="trace-data"/.test(sample) || /<title>[^<]*(?:Android System Trace|systrace)[^<]*<\/title>/i.test(sample);
}
