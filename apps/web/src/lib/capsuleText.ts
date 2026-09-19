// Decodifica el texto de una cápsula pegado/subido, sin saber a priori si
// es la transcripción manual (Base32) o el payload de QR ya reensamblado
// (Base45). Compartido entre el flujo de descifrado (Opción B: pegar
// código) y el de importar una cápsula existente para combinarla en una
// misma hoja al crear.
import { decodePrintPayload, decodeQrPayload } from "@keyprism/core";

export function decodeAnyPayload(text: string): Uint8Array {
  const errors: string[] = [];
  try {
    return decodePrintPayload(text);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  try {
    return decodeQrPayload(text);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  throw new Error(
    "No se reconoce el formato del código (ni Base32 ni Base45). Revisa que esté completo."
  );
}
