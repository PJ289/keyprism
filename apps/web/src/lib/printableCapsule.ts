// Representación unificada de "algo que va en la hoja de impresión": tanto
// una cápsula recién cifrada en esta sesión como una cápsula ya cifrada
// anteriormente que el usuario importa para combinarla en la misma hoja
// (ahorrar papel imprimiendo varios secretos juntos). Importar NO necesita
// la combinación maestra: la etiqueta va en claro (AAD autenticada) dentro
// de la cápsula, así que se puede leer sin descifrar el secreto — solo se
// verifica el CRC para detectar un código incompleto/con errata.
import {
  type CreatedCapsule,
  appendCrc16,
  base32Encode,
  base45Encode,
  decodeCapsule,
  formatForPrint,
} from "@keyprism/core";
import { decodeAnyPayload } from "./capsuleText.js";

export interface PrintableCapsule {
  id: number;
  label: string;
  qrPayload: string;
  printPayload: string;
  source: "new" | "imported";
}

let idCounter = 0;

export function fromCreatedCapsule(created: CreatedCapsule): PrintableCapsule {
  return {
    id: ++idCounter,
    label: created.data.label,
    qrPayload: created.qrPayload,
    printPayload: created.printPayload,
    source: "new",
  };
}

/** Lanza si el texto no se reconoce como cápsula (formato o CRC). */
export function importCapsuleFromText(text: string): PrintableCapsule {
  const rawBytes = decodeAnyPayload(text);
  const { label } = decodeCapsule(rawBytes); // valida versión/parámetros también
  const withCrc = appendCrc16(rawBytes);
  return {
    id: ++idCounter,
    label,
    qrPayload: base45Encode(withCrc),
    printPayload: formatForPrint(base32Encode(withCrc)),
    source: "imported",
  };
}
