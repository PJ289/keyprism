// Construye el bloque `.printable` con una o varias cápsulas en una
// cuadrícula — para ahorrar papel al crear/combinar varios secretos en la
// misma hoja. Deliberadamente NO incluye la combinación maestra: mezclarla
// con las cápsulas en el mismo papel rompería el modelo de dos factores
// (papel + combinación memorizada por separado).
import { DEFAULT_CHUNK_SIZE, splitIntoQrChunks } from "@keyprism/core";
import { el } from "../lib/dom.js";
import { renderQrToCanvas } from "../lib/qrRender.js";
import type { PrintableCapsule } from "../lib/printableCapsule.js";

function buildPrintItem(item: PrintableCapsule): HTMLElement {
  const qrHost = el("div", { class: "qr-grid" });
  const chunks =
    item.qrPayload.length > DEFAULT_CHUNK_SIZE
      ? splitIntoQrChunks(item.qrPayload)
      : [item.qrPayload];

  chunks.forEach((chunkText, i) => {
    const canvas = el("canvas", {});
    void renderQrToCanvas(canvas, chunkText);
    qrHost.append(
      el("figure", { class: "qr-item" }, [
        canvas,
        el("figcaption", {}, chunks.length > 1 ? [`Parte ${i + 1} de ${chunks.length}`] : ["Escanear con la app"]),
      ])
    );
  });

  return el("article", { class: "print-item" }, [
    el("p", { class: "print-item-label" }, [item.label || "(sin etiqueta)"]),
    qrHost,
    el("pre", { class: "print-payload" }, [item.printPayload]),
  ]);
}

/** Devuelve el `.printable` completo, listo para insertar en el DOM. */
export function buildPrintSheet(items: PrintableCapsule[]): HTMLElement {
  const grid = el(
    "div",
    { class: "print-sheet-grid" },
    items.map(buildPrintItem)
  );
  return el("div", { class: "printable" }, [grid]);
}
