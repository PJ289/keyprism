// CRC-16/CCITT-FALSE sobre los bytes crudos de la cápsula. No es un
// mecanismo de seguridad (no protege contra manipulación deliberada — para
// eso ya está el tag de Poly1305 del AEAD) sino una comprobación barata de
// transcripción: detecta una errata al escribir/escanear el código *antes*
// de lanzar el KDF (Argon2id, ~1s), para poder avisar "revisa el código"
// en vez de un ambiguo "combinación incorrecta" tras la espera.

export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

export function appendCrc16(bytes: Uint8Array): Uint8Array {
  const crc = crc16(bytes);
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes, 0);
  out[bytes.length] = (crc >> 8) & 0xff;
  out[bytes.length + 1] = crc & 0xff;
  return out;
}

export class Crc16MismatchError extends Error {
  constructor() {
    super(
      "El código no coincide con su comprobación de integridad (probable errata al escribir/escanear, o código incompleto)"
    );
    this.name = "Crc16MismatchError";
  }
}

/** Verifica y separa el CRC de cola. Lanza si no coincide o si es demasiado corto. */
export function verifyAndStripCrc16(bytesWithCrc: Uint8Array): Uint8Array {
  if (bytesWithCrc.length < 2) {
    throw new Crc16MismatchError();
  }
  const payload = bytesWithCrc.slice(0, -2);
  const expected = crc16(payload);
  const actualHigh = bytesWithCrc[bytesWithCrc.length - 2]!;
  const actualLow = bytesWithCrc[bytesWithCrc.length - 1]!;
  const actual = (actualHigh << 8) | actualLow;
  if (actual !== expected) {
    throw new Crc16MismatchError();
  }
  return payload;
}
