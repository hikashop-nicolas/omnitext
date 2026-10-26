# Walletview plan: a viewer library for wallet passes and cards

Status: draft, 2026-10-26. Nothing created yet (no repo, no code).

## Why

Omnitext opens BoardingPass.pkpass as hex. No web library reads a .pkpass (the npm packages
passkit-generator and @walletpass/pass-js only create passes). A small public MIT library fills
that gap, and Omnitext wraps it the way it wraps mediaplay and imageview.

## Name

walletview (repo hikashop-nicolas/walletview, MIT). Decided by the owner 2026-10-26, together with
including the health card.

## Formats

| Format | What it is | In scope | Notes |
|---|---|---|---|
| .pkpass | Zip: pass.json, images, per-language pass.strings, manifest, signature | v1 | Apple Wallet. Five pass styles: boardingPass, eventTicket, coupon, storeCard, generic |
| .pkpasses | Zip of several .pkpass files | v1 | Same renderer, one card per pass. iOS only imports it from Safari or Mail, but a file on a phone is plausible |
| IATA boarding pass barcode text | Fixed-width BCBP string, often in a pass's barcode message | v1.1 | Decode it to show passenger-independent fields (route, flight, seat, class). Candidate libs: npm bcbp (v6 standard), or our own parser (about 100 lines) |
| .smart-health-card | JSON with a verifiableCredential array of JWS strings | v1.2 | Payload is raw-deflated JSON (FHIR). Fits fflate. Verifying the signature needs the issuer's key over the network, so show it as unverified |
| Google Wallet | No file a user holds: a signed JWT behind a pay.google.com/gp/v/save/ link | v1.3 | Read the JWT payload (generic, flight, event, loyalty, offer objects) from a pasted link or a .txt/.jwt file. Shown as unverified. A class is often referenced by id only, so we render what the payload carries |
| Samsung Wallet | Same idea: a JWT in the cdata of an a.swallet.link/atw/ link | v1.3 | Card types and attribute tables not yet read (the Wallet Cards page of the Samsung developer site). Phase 0 reads them |
| EU COVID certificate (HC1 text) | base45, zlib, CBOR, COSE | No | Needs CBOR, little use today |
| .ics, .vcf | Calendar and contacts | Already done | Handled by the PIM viewer |

Facts on .pkpasses and the health card come from web search results, so phase 0 checks them
against the specs and a real sample before relying on them.

## Design

- Library, DOM only: a function taking bytes and a container, returning a handle with dispose().
  No knowledge of Omnitext. Themes through CSS variables with sensible defaults.
- Reads zips with fflate. Barcodes with bwip-js, loaded only when a pass has one (QR, PDF417,
  Aztec, Code128). Falls back to showing the barcode text if drawing fails.
- A pass renders with its own colours (backgroundColor, foregroundColor, labelColor), logo, header,
  primary, secondary and auxiliary fields, barcode, then back fields. Sized for a phone first.
- Translations: pick the lproj folder matching the browser language, else en, else the raw keys.
- Untrusted input: file names inside the zip are never used as paths, images become blob URLs,
  all text goes through textContent, zip size and entry count are capped.
- No signature verification. The pass is shown as is, with a small "not verified" note.
- Read only. Adding to a wallet app is out of scope.
- One internal card model (title, colours, logo, header, field groups, barcodes, back fields).
  Each format has a reader that fills it, and one renderer draws it. Adding a format never
  touches the renderer.
- Google and Samsung readers decode the JWT payload only. They never check the signature (no
  keys, no network) and say so on the card. Real files of these kinds are rare, because both
  wallets hand out links, not files; the value is a pasted link or a saved one. Google Wallet
  also opens .pkpass itself, so .pkpass stays the main case on Android.

## Phases

0. Spec check (half a day). Read the Apple pass spec, confirm .pkpasses and .smart-health-card
   layouts, pick the BCBP parser. Build a synthetic sample set: one fake pass per style, with
   invented names, plus one .pkpasses. The owner's real boarding pass stays out of the repo; it is
   used only for local checks.
1. Repo and skeleton. Create the public MIT repo, set the GitHub watch subscription right away,
   CI with tests, build to dist, demo page.
2. pkpass and pkpasses viewer, with tests on the synthetic set and the local real pass.
   Gate: all five styles render in Chrome at 390 px wide without horizontal scroll, light and dark.
3. Omnitext integration. Format descriptors for .pkpass and .pkpasses (binary, extension
   detection, soleEditor like KMZ), a thin read-only editor, git dependency pinned in the
   lockfile, a test in the format registry. Gate: the real pass on the connected phone, through the
   file manager's Open with.
4. Commit and push both repos (Conventional Commits, no AI trailer). Add a line to the Omnitext
   changelog for the next release.
5. v1.1 BCBP decoding, v1.2 health card, v1.3 Google and Samsung link readers, each its own
   release and Omnitext bump. For v1.3 Omnitext also needs a way in: a .txt or .url file holding
   a save link, detected by its prefix.

## Risks

- Odd passes in the wild: missing images, passes with no barcode, several barcodes, right-to-left
  text, very long back fields. The synthetic set must cover them.
- bwip-js size. It is lazy, so only pass files pay for it. Measure it, and fall back to a smaller
  QR-only library if it is too heavy for the APK.
- Accessibility: the card needs real text, labelled fields and sufficient contrast against the
  pass's own colours; its own commit.
- F-Droid: no native build step. bwip-js and fflate are plain npm packages, so the recipe is
  unaffected. Check before the release.

## Open questions for the owner

1. For v1.3, is reading a pasted or saved Google or Samsung link worth it, or do we wait until a
   real file turns up?
