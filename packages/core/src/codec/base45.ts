// Base45 (RFC 9285) — más denso que Base64 cuando se codifica en el modo
// "alphanumeric" de un QR (el mismo truco que usa el certificado COVID de
// la UE). Se usa para el payload que va dentro del QR.

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const CHAR_TO_VALUE: Record<string, number> = Object.fromEntries(
  [...ALPHABET].map((c, i) => [c, i])
);

export function base45Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    const n = (bytes[i]! << 8) | bytes[i + 1]!;
    const c = n % 45;
    const d = Math.floor(n / 45) % 45;
    const e = Math.floor(n / 2025);
    out += ALPHABET[c]! + ALPHABET[d]! + ALPHABET[e]!;
  }
  if (i < bytes.length) {
    const n = bytes[i]!;
    const c = n % 45;
    const d = Math.floor(n / 45);
    out += ALPHABET[c]! + ALPHABET[d]!;
  }
  return out;
}

export class Base45DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base45DecodeError";
  }
}

export function base45Decode(text: string): Uint8Array {
  // OJO: no usar `.trim()` — el espacio " " es un carácter válido del
  // alfabeto Base45 (puede ser el primer o último símbolo de datos
  // reales), así que recortarlo a ciegas corrompería el payload. Solo se
  // eliminan saltos de línea, que nunca forman parte del alfabeto y sí
  // pueden colarse al copiar/pegar o venir de una cabecera multilínea.
  const clean = text.replace(/[\r\n]/g, "").toUpperCase();
  const values: number[] = [];
  for (const ch of clean) {
    const v = CHAR_TO_VALUE[ch];
    if (v === undefined) {
      throw new Base45DecodeError(`Carácter fuera del alfabeto Base45: "${ch}"`);
    }
    values.push(v);
  }
  if (values.length % 3 === 1) {
    throw new Base45DecodeError(
      "Longitud de texto Base45 inválida (sobra 1 carácter)"
    );
  }
  const out: number[] = [];
  let i = 0;
  for (; i + 3 <= values.length; i += 3) {
    const n = values[i]! + values[i + 1]! * 45 + values[i + 2]! * 45 * 45;
    if (n > 0xffff) {
      throw new Base45DecodeError("Grupo Base45 fuera de rango");
    }
    out.push((n >> 8) & 0xff, n & 0xff);
  }
  if (i < values.length) {
    const n = values[i]! + values[i + 1]! * 45;
    if (n > 0xff) {
      throw new Base45DecodeError("Grupo Base45 final fuera de rango");
    }
    out.push(n);
  }
  return new Uint8Array(out);
}
