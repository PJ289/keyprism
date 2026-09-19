// Una fila de la lista "Secretos a proteger": o bien un secreto nuevo
// (textarea/archivo + etiqueta, pendiente de cifrar con la combinación
// compartida del lote) o una cápsula ya cifrada que el usuario importó
// para combinarla en la misma hoja de impresión.
import { el, formField, orDivider } from "../lib/dom.js";
import { createStatusMessage } from "./statusMessage.js";
import type { PrintableCapsule } from "../lib/printableCapsule.js";

export interface NewBatchItem {
  id: number;
  kind: "new";
  element: HTMLElement;
  secretBytes: Uint8Array | null;
  labelInput: HTMLInputElement;
}

export interface ImportedBatchItem {
  id: number;
  kind: "imported";
  element: HTMLElement;
  printable: PrintableCapsule;
}

export type BatchItem = NewBatchItem | ImportedBatchItem;

function removeButton(onRemove: () => void): HTMLElement {
  return el("button", { class: "icon-btn", title: "Quitar de la hoja", onclick: onRemove }, ["✕"]);
}

export function createNewBatchItem(
  id: number,
  onChange: () => void,
  onRemove: (id: number) => void
): NewBatchItem {
  const status = createStatusMessage();
  const labelInput = el("input", {
    type: "text",
    placeholder: "ej. «BitLocker - Portátil trabajo»",
  }) as HTMLInputElement;

  const textarea = el("textarea", {
    rows: "3",
    placeholder: "Pega aquí el secreto: clave de recuperación, código 2FA, clave privada armored...",
    oninput: (e: Event) => {
      const value = (e.target as HTMLTextAreaElement).value;
      if (value.length > 0) {
        item.secretBytes = new TextEncoder().encode(value);
        status.set("success", `Texto cargado (${item.secretBytes.length} bytes).`);
        (fileInput as HTMLInputElement).value = "";
      } else if (!(fileInput as HTMLInputElement).files?.length) {
        item.secretBytes = null;
        status.clear();
      }
      onChange();
    },
  });

  const fileInput = el("input", {
    type: "file",
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      item.secretBytes = new Uint8Array(await file.arrayBuffer());
      status.set("success", `Archivo "${file.name}" cargado (${item.secretBytes.length} bytes).`);
      (textarea as HTMLTextAreaElement).value = "";
      onChange();
    },
  });

  const item: NewBatchItem = {
    id,
    kind: "new",
    secretBytes: null,
    labelInput,
    element: el("div", { class: "batch-item" }, [
      el("div", { class: "batch-item-header" }, [
        el("span", { class: "batch-item-title" }, ["🔑 Secreto nuevo"]),
        removeButton(() => onRemove(id)),
      ]),
      formField("Etiqueta (opcional)", labelInput),
      formField("Secreto", textarea),
      orDivider(),
      formField("O sube un archivo", fileInput),
      status.element,
    ]),
  };

  return item;
}

export function createImportedBatchItem(
  id: number,
  printable: PrintableCapsule,
  onRemove: (id: number) => void
): ImportedBatchItem {
  return {
    id,
    kind: "imported",
    printable,
    element: el("div", { class: "batch-item batch-item--imported" }, [
      el("div", { class: "batch-item-header" }, [
        el("span", { class: "batch-item-title" }, ["📥 Cápsula importada"]),
        removeButton(() => onRemove(id)),
      ]),
      el("p", { class: "field-hint" }, [
        `Etiqueta: ${printable.label || "(sin etiqueta)"} — ya cifrada, se incluye tal cual en la hoja.`,
      ]),
    ]),
  };
}
