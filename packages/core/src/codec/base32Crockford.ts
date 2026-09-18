// Base32 de Crockford — para la transcripción manual impresa junto al QR.
// Excluye I, L, O, U para evitar confusiones al copiar a mano, y el
// decodificador es tolerante: acepta minúsculas y reinterpreta O→0, I/L→1.
// https://www.crockford.com/base32.html

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CHAR_TO_VALUE: Record<string, number> = Object.fromEntries(
  [...ALPHABET].map((c, i) => [c, i])
);

export function base32Encode(bytes: Uint8Array): string {
  let bitBuffer = 0;
  let bitCount = 0;
  let out = "";
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      out += ALPHABET[(bitBuffer >> bitCount) & 0x1f];
    }
  }
  if (bitCount > 0) {
    out += ALPHABET[(bitBuffer << (5 - bitCount)) & 0x1f];
  }
  return out;
}

export class Base32DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base32DecodeError";
  }
}

/** Normaliza una transcripción manual: mayúsculas, sin separadores, sin
 * ambigüedades típicas (O/0, I,L/1). */
export function normalizeForDecode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function base32Decode(text: string): Uint8Array {
  const clean = normalizeForDecode(text);
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = CHAR_TO_VALUE[ch];
    if (v === undefined) {
      throw new Base32DecodeError(`Carácter fuera del alfabeto Base32: "${ch}"`);
    }
    bitBuffer = (bitBuffer << 5) | v;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >> bitCount) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** Formatea en bloques (p. ej. "XKQ2-9F7T-...") para que sea más fácil de
 * leer/transcribir en papel. */
export function formatForPrint(base32: string, groupSize = 4): string {
  const groups: string[] = [];
  for (let i = 0; i < base32.length; i += groupSize) {
    groups.push(base32.slice(i, i + groupSize));
  }
  return groups.join("-");
}
