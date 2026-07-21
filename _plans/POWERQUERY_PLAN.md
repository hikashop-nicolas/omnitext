# Power Query in sheetedit: clean-room M engine + xlsx round trip

Goal: a workbook that uses Power Query can be opened in sheetedit, its queries LISTED and
READ, REFRESHED (for supported sources) with results written back into the sheet, and SAVED
so Excel still sees a valid, refreshable workbook. The engine is a new standalone library so
other consumers (Omnitext, future tools) get it for free.

## Decisions already made (owner-agreed)

- **Clean-room only.** No decompilation of Microsoft binaries, ever. Sources of truth:
  1. The public *Power Query M language specification* (grammar, evaluation model, types).
  2. The public function reference on Microsoft Learn (every Table./List./Text./... function).
  3. The documented **MS-QDEFF** spec (the DataMashup / query-definition file format).
  4. **Black-box oracle observations**: running real queries through Microsoft's own PQTest
     CLI (from the Microsoft.PowerQuery.SdkTools NuGet, driven the way vscode-powerquery-sdk
     drives it) and comparing outputs. Observing input/output is clean-room; reading the
     binary is not. PQTest is dev-machine-only tooling, never shipped or redistributed.
- **Dead ends confirmed**: PowerQueryNet and vscode-powerquery-sdk both delegate evaluation
  to the closed Mashup engine; powerquery-io is documentation extraction. There is no
  open-source M evaluator anywhere, so the engine is a from-scratch reimplementation.
- **Front-end reused**: @microsoft/powerquery-parser (MIT, TypeScript) for lex/parse -> AST.
  We only write the evaluator behind it.
- **Refresh scope**: sources that live in (or with) the workbook. External connectors
  (Web/Sql/OData/Folder/...) are preserved but not refreshable in the browser, by design
  (privacy-first, no server); refreshing those shows "external source, refresh in Excel".

## New library: `mlang`

github:hikashop-nicolas/mlang (MIT, public), usual family pattern (tsc build, dist built by
`prepare` on install, vitest, demo/ to Pages, consumed as a git dep). Name alternates if the
repo/npm name collides: `mquery-engine`, `pqlang`.

Modules:

- `src/values.ts` - the M value model: null, logical, number, text, date, time, datetime,
  datetimezone, duration, binary, list, record, table, function, type. Tables get a proper
  columnar-ish representation with column types. Errors are values that propagate
  (`try ... otherwise` catches them), matching the spec's error semantics.
- `src/interpret.ts` - tree-walking evaluator over the parser's AST: environments/closures,
  mutually-recursive lazy `let` bindings, `each`/`_` sugar, sections (Section1.m is a section
  document), operator semantics per spec (null propagation, type coercion tables).
- `src/stdlib/` - the library subset, one domain per file (table.ts, list.ts, text.ts,
  number.ts, date.ts, record.ts, type.ts, ...). Registry keyed by canonical name.
- `src/connectors.ts` - the host-connector interface. mlang itself only ships inline data
  sources (`#table`, Csv.Document, Json.Document, Xml.Tables, Binary.* over provided bytes);
  the HOST injects `Excel.CurrentWorkbook` (sheetedit will back it with its live workbook
  model). Unknown/external connectors evaluate to a typed "ExternalSource" error the UI can
  present cleanly.
- `src/qdeff.ts` - DataMashup codec per MS-QDEFF: base64 payload in the customXml item ->
  version header + length-prefixed parts -> inner zip -> `Formulas/Section1.m` (+ Permissions,
  Metadata). READ in phase 1; WRITE (editing M) is a later, optional phase - refresh alone
  never rewrites the blob.
- Explicitly NOT in mlang: any UI, any zip-of-the-workbook knowledge beyond qdeff, any
  network access.

### Standard library tiers

- **Tier 0 (spike, ~15)**: Table.SelectRows/SelectColumns/RemoveColumns/RenameColumns/
  TransformColumnTypes/AddColumn/Sort/FirstN, List.Sum/Count, Text.From, Number.From,
  Excel.CurrentWorkbook, #table, Record field access.
- **Tier 1 (everyday "Applied Steps", ~80-120)**: the rest of the common steps - Group,
  Join/Merge (Table.NestedJoin/ExpandTableColumn), Append, Distinct, Unpivot/Pivot, Fill,
  ReplaceValue, Split/Combine columns, index columns, the common List/Text/Number/Date
  functions, type functions, Csv/Json parsing options.
- **Tier 2 (on demand)**: everything else, added when a real workbook needs it. The engine
  reports "unsupported function X" errors precisely so gaps are visible, never silent.
  Scope Tier 1 from REAL workbooks (owner's + public samples), not from the 700-function
  reference.

## Oracle & fidelity (the make-or-break)

- Dev-only harness (mlang `test/oracle/`, not shipped): drives PQTest on fixture inputs
  (`.xlsx` or inline data + an M expression) and stores expected outputs as JSON fixtures in
  the repo. Vitest compares mlang's evaluation to the fixtures - so CI needs no Microsoft
  tooling, only the committed fixtures.
- Every stdlib function lands with oracle fixtures covering: nulls, empty tables, type
  mismatches (error values), locale-sensitive formatting (dates/numbers), and ordering.
- Known-divergence ledger (`FIDELITY.md`): any place we knowingly differ (e.g. culture
  defaults) is written down, not discovered by users.

## sheetedit integration

- Query panel: lists queries from qdeff (name, load destination), shows the M read-only
  (plain <pre> first; syntax highlight via the parser later).
- Refresh: per-query + "refresh all". Pipeline: qdeff M -> mlang with the workbook-backed
  `Excel.CurrentWorkbook` -> result table -> write back into the query's load target: the
  QueryTable/table range cells, growing/shrinking the table ref (xl/tables/tableN.xml @ref,
  sheet dimension) when the row count changes; number formats/types mapped to cell kinds.
  The DataMashup blob, connections.xml and queryTables parts are NOT rewritten.
- External-source queries: listed, readable, refresh disabled with a clear message.
- mlang is a lazy import (same pattern as localml) so sheetedit's base bundle is unaffected.
- Round-trip acceptance test: open a real PQ workbook -> refresh -> save -> reopen in Excel:
  Excel shows the new values AND can still refresh the query itself.

## Phases (each independently verifiable)

0. **Spike / de-risk (do first, small)**: (a) confirm @microsoft/powerquery-parser bundles
   for the browser (no Node-only deps) and parses a real Section1.m; (b) qdeff READ of a real
   workbook; (c) minimal interpreter + Tier 0 running ONE real query
   (Excel.CurrentWorkbook -> filter/rename/type steps) inside the sheetedit demo, result
   written back; (d) PQTest harness producing its first fixtures on this same query.
   Exit criteria: the spike query round-trips and matches the oracle. If (a) fails, fall back
   to wrapping the parser behind a thin worker or vendoring; if PQTest won't run on macOS
   (.NET), run it in a small CI job or Windows VM - fixtures are committed either way.
1. **Engine core**: full value model, evaluation semantics per spec (lazy let, errors,
   operators, type coercion), section documents; parser AST fully mapped. Oracle fixtures for
   language semantics (not just stdlib).
2. **Stdlib Tier 1** with per-function oracle fixtures; FIDELITY.md started.
3. **sheetedit integration**: qdeff list + M viewer + refresh + write-back + save; the
   round-trip acceptance test in Cypress (fixture workbook committed).
4. **Omnitext**: bump sheetedit (mlang arrives transitively; pin directly like localml if a
   version skew appears). Verify in the deployed build.
5. **Later / optional**: M EDITING (rewrite Section1.m + re-frame the qdeff package per
   MS-QDEFF, validated by Excel reopening), ods equivalents, more connectors that stay local
   (e.g. user-picked local files via the host), syntax-highlighted editor via
   powerquery-language-services.

## Risks / honesty

- **Scale**: this is the family's biggest lib to date; Tier 1 + fidelity is multi-month at
  a steady pace. The tiered scope + precise "unsupported" errors keep it shippable early.
- **Semantics drift**: M's culture/locale behaviour, type coercion and error edge cases are
  where a reimplementation quietly diverges - hence oracle-first development and FIDELITY.md.
- **Write-back fidelity**: growing/shrinking QueryTable ranges without breaking Excel's
  table metadata is delicate; the acceptance test reopens in real Excel every time.
- **Parser coupling**: powerquery-parser's AST is versioned by Microsoft for their language
  services; pin the version and wrap it behind one adapter module so upgrades are contained.
- **Performance**: tree-walking + eager tables is fine for typical sheets; huge tables may
  need lazy/streaming table ops later (design values.ts so that's possible, don't build it
  yet).
- **Legal guardrail (standing rule for every contributor)**: spec + docs + black-box oracle
  only; no decompiled Mashup code, no bundled Microsoft binaries; PQTest stays a dev/CI
  tool.
