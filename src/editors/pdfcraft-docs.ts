import type { EditCall, HiddenInfo } from "craftbridge/pdf";
import { t } from "../i18n";
import { formDialog, type Field } from "./pdfcraft-tools";

// Dialogs for what applies to the whole document. Each one asks and returns the edit to make (or null),
// so the editor commits it the way it commits any edit, shared session included.

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

async function picture(file: unknown): Promise<{ name: string; bytes: Uint8Array } | undefined> {
  return file instanceof File ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
}

const pageScope = (): Field => ({
  key: "pages",
  label: t("pdfcraft.wmPages"),
  kind: "select",
  value: "all",
  options: [
    ["all", t("pdfcraft.pagesAll")],
    ["this", t("pdfcraft.pagesThis")],
  ],
});

const pagesOf = (scope: unknown, page: number): number[] | undefined => (scope === "this" ? [page] : undefined);

const button = { ok: () => t("pdfcraft.ok"), cancel: () => t("pdfcraft.cancel") };

export async function watermarkDialog(root: HTMLElement, page: number): Promise<EditCall | null> {
  const v = await formDialog(root, {
    title: t("pdfcraft.moreWatermark"),
    ok: button.ok(),
    cancel: button.cancel(),
    fields: [
      { key: "text", label: t("pdfcraft.wmText"), kind: "text", value: "" },
      { key: "picture", label: t("pdfcraft.wmPicture"), kind: "file", accept: "image/*" },
      { key: "size", label: t("pdfcraft.wmSize"), kind: "number", value: 0, min: 0, max: 400 },
      { key: "color", label: t("pdfcraft.wmColor"), kind: "color", value: "#999999" },
      { key: "opacity", label: t("pdfcraft.wmOpacity"), kind: "number", value: 50, min: 0, max: 100 },
      { key: "rotation", label: t("pdfcraft.wmRotation"), kind: "number", value: 45, min: -360, max: 360 },
      { key: "behind", label: t("pdfcraft.wmBehind"), kind: "check", value: false },
      pageScope(),
      { key: "remove", label: t("pdfcraft.markRemove"), kind: "check", value: false },
    ],
    validate: (x) => (x.remove || String(x.text).trim() || x.picture ? null : t("pdfcraft.wmNeed")),
  });
  if (!v) return null;
  if (v.remove) return { op: "removeMarks", kind: "watermark" };
  return {
    op: "addWatermark",
    spec: { text: String(v.text), size: Number(v.size), color: rgb(String(v.color)), opacity: Number(v.opacity) / 100, rotation: Number(v.rotation), behind: !!v.behind, pages: pagesOf(v.pages, page) },
    picture: await picture(v.picture),
  };
}

export async function headerFooterDialog(root: HTMLElement, page: number): Promise<EditCall | null> {
  const keys = ["hl", "hc", "hr", "fl", "fc", "fr"] as const;
  const labels = ["hfHeaderLeft", "hfHeaderCentre", "hfHeaderRight", "hfFooterLeft", "hfFooterCentre", "hfFooterRight"];
  const v = await formDialog(root, {
    title: t("pdfcraft.moreHeader"),
    ok: button.ok(),
    cancel: button.cancel(),
    note: t("pdfcraft.hfNote"),
    fields: [
      ...keys.map((key, i): Field => ({ key, label: t(`pdfcraft.${labels[i]}`), kind: "text", value: key === "fc" ? "<<1>> / <<n>>" : "" })),
      { key: "size", label: t("pdfcraft.hfSize"), kind: "number", value: 10, min: 4, max: 72 },
      { key: "color", label: t("pdfcraft.wmColor"), kind: "color", value: "#000000" },
      { key: "shrink", label: t("pdfcraft.hfShrink"), kind: "check", value: false },
      pageScope(),
      { key: "remove", label: t("pdfcraft.markRemove"), kind: "check", value: false },
    ],
    validate: (x) => (x.remove || keys.some((k) => String(x[k]).trim()) ? null : t("pdfcraft.hfNeed")),
  });
  if (!v) return null;
  if (v.remove) return { op: "removeMarks", kind: "headerFooter" };
  const text = keys.map((k) => String(v[k])) as [string, string, string, string, string, string];
  return { op: "addHeaderFooter", spec: { text, size: Number(v.size), color: rgb(String(v.color)), shrink: !!v.shrink, pages: pagesOf(v.pages, page) } };
}

export async function backgroundDialog(root: HTMLElement, page: number): Promise<EditCall | null> {
  const v = await formDialog(root, {
    title: t("pdfcraft.moreBackground"),
    ok: button.ok(),
    cancel: button.cancel(),
    fields: [
      { key: "color", label: t("pdfcraft.wmColor"), kind: "color", value: "#ffffd9" },
      { key: "picture", label: t("pdfcraft.bgPicture"), kind: "file", accept: "image/*" },
      { key: "opacity", label: t("pdfcraft.wmOpacity"), kind: "number", value: 100, min: 0, max: 100 },
      pageScope(),
      { key: "remove", label: t("pdfcraft.markRemove"), kind: "check", value: false },
    ],
  });
  if (!v) return null;
  if (v.remove) return { op: "removeMarks", kind: "background" };
  return { op: "addBackground", spec: { color: rgb(String(v.color)), opacity: Number(v.opacity) / 100, pages: pagesOf(v.pages, page) }, picture: await picture(v.picture) };
}

const HIDDEN_LABELS: Record<string, string> = {
  metadata: "hiddenMetadata",
  attachments: "hiddenAttachments",
  comments: "hiddenComments",
  formFields: "hiddenFormFields",
  hiddenText: "hiddenHiddenText",
  hiddenLayers: "hiddenHiddenLayers",
  bookmarks: "hiddenBookmarks",
  links: "hiddenLinks",
  privateData: "hiddenPrivate",
};

export async function hiddenDialog(root: HTMLElement, info: HiddenInfo[]): Promise<EditCall | null> {
  const found = info.filter((i) => i.count > 0 && HIDDEN_LABELS[i.id]);
  if (!found.length) {
    await formDialog(root, { title: t("pdfcraft.hiddenTitle"), ok: button.ok(), cancel: button.cancel(), fields: [], note: t("pdfcraft.hiddenNone") });
    return null;
  }
  const v = await formDialog(root, {
    title: t("pdfcraft.hiddenTitle"),
    ok: t("pdfcraft.hiddenRemove"),
    cancel: button.cancel(),
    note: t("pdfcraft.hiddenNote"),
    fields: found.map((i): Field => ({ key: i.id, label: `${t(`pdfcraft.${HIDDEN_LABELS[i.id]}`)} (${i.count})`, kind: "check", value: false })),
    validate: (x) => (found.some((i) => x[i.id]) ? null : t("pdfcraft.hiddenChoose")),
  });
  return v ? { op: "removeHidden", ids: found.filter((i) => v[i.id]).map((i) => i.id) } : null;
}
