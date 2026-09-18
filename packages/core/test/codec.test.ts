import { describe, expect, it } from "vitest";
import { base45Decode, base45Encode } from "../src/codec/base45.js";
import {
  base32Decode,
  base32Encode,
  formatForPrint,
  normalizeForDecode,
} from "../src/codec/base32Crockford.js";
import { appendCrc16, crc16, verifyAndStripCrc16, Crc16MismatchError } from "../src/codec/crc16.js";
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNKS,
  QrChunkCollector,
  QrChunkError,
  parseQrChunk,
  splitIntoQrChunks,
} from "../src/codec/qrChunk.js";

function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

describe("base45", () => {
  it("codifica y decodifica round-trip para varias longitudes", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 17, 100, 257]) {
      const bytes = randomBytes(len);
      const encoded = base45Encode(bytes);
      const decoded = base45Decode(encoded);
      expect(decoded).toEqual(bytes);
    }
  });

  it("coincide con vectores de ejemplo conocidos de RFC 9285", () => {
    expect(base45Encode(new TextEncoder().encode("AB"))).toBe("BB8");
    expect(base45Encode(new TextEncoder().encode("Hello!!"))).toBe(
      "%69 VD92EX0"
    );
    expect(base45Decode("BB8")).toEqual(new TextEncoder().encode("AB"));
  });

  it("rechaza caracteres fuera de alfabeto", () => {
    expect(() => base45Decode("é€é")).toThrow();
  });

  it("regresión: el espacio es un carácter de datos válido, no whitespace a recortar", () => {
    // bytes (0, 36) codifican exactamente a " 00" (espacio como primer
    // carácter). Un `.trim()` ingenuo se comería el espacio y corrompería
    // el payload — ver commit que arregló este bug real.
    expect(base45Encode(new Uint8Array([0, 36]))).toBe(" 00");
    expect(base45Decode(" 00")).toEqual(new Uint8Array([0, 36]));
    expect(base45Decode("\n 00\n")).toEqual(new Uint8Array([0, 36]));
  });
});

describe("base32 crockford", () => {
  it("codifica y decodifica round-trip para varias longitudes", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 33, 100]) {
      const bytes = randomBytes(len);
      const encoded = base32Encode(bytes);
      const decoded = base32Decode(encoded);
      expect(decoded).toEqual(bytes);
    }
  });

  it("es tolerante a minúsculas, separadores y ambigüedades O/I/L", () => {
    const bytes = randomBytes(10);
    const encoded = base32Encode(bytes);
    const printed = formatForPrint(encoded, 4);
    // Simula errores comunes de transcripción manual.
    const messy = printed
      .toLowerCase()
      .replace(/0/g, "o")
      .replace(/1/g, "i");
    expect(normalizeForDecode(messy).length).toBeGreaterThan(0);
    expect(base32Decode(messy)).toEqual(bytes);
  });

  it("rechaza caracteres fuera de alfabeto", () => {
    expect(() => base32Decode("U")).toThrow(); // U está excluida a propósito
  });
});

describe("crc16", () => {
  it("detecta una errata de un solo carácter", () => {
    const original = randomBytes(50);
    const withCrc = appendCrc16(original);
    expect(verifyAndStripCrc16(withCrc)).toEqual(original);

    const corrupted = withCrc.slice();
    corrupted[10] ^= 0x01;
    expect(() => verifyAndStripCrc16(corrupted)).toThrow(Crc16MismatchError);
  });

  it("es determinista", () => {
    const bytes = new TextEncoder().encode("keyprism");
    expect(crc16(bytes)).toBe(crc16(bytes));
  });
});

describe("qr chunking", () => {
  it("trocea y reensambla un payload largo en cualquier orden de escaneo", () => {
    const payload = base45Encode(randomBytes(3000));
    const chunks = splitIntoQrChunks(payload, 500);
    expect(chunks.length).toBeGreaterThan(1);

    const collector = new QrChunkCollector();
    const shuffled = [...chunks].reverse();
    for (const c of shuffled) collector.add(c);

    expect(collector.isComplete()).toBe(true);
    expect(collector.assemble()).toBe(payload);
  });

  it("un solo trozo cuando el payload cabe en el tamaño por defecto", () => {
    const payload = base45Encode(randomBytes(100));
    const chunks = splitIntoQrChunks(payload, DEFAULT_CHUNK_SIZE);
    expect(chunks).toHaveLength(1);
    expect(parseQrChunk(chunks[0]!)).toEqual({
      index: 1,
      total: 1,
      payload,
    });
  });

  it("reporta qué trozos faltan todavía", () => {
    const payload = base45Encode(randomBytes(2000));
    const chunks = splitIntoQrChunks(payload, 500);
    const collector = new QrChunkCollector();
    collector.add(chunks[0]!);
    expect(collector.isComplete()).toBe(false);
    expect(collector.missingIndexes()).toEqual(
      chunks.slice(1).map((_, i) => i + 2)
    );
  });

  it("regresión: un trozo cuyo payload empieza/termina en espacio no se corrompe", () => {
    // Mismo bug que en base45Decode pero a nivel de cabecera de trozo: un
    // `.trim()` sobre el trozo completo se comía un espacio real del payload.
    const chunks = splitIntoQrChunks(" 00X 00", 3); // fuerza cortes en los espacios
    const collector = new QrChunkCollector();
    for (const c of chunks) collector.add(c);
    expect(collector.assemble()).toBe(" 00X 00");
  });

  it("rechaza un QR que no es de Keyprism", () => {
    expect(() => parseQrChunk("https://example.com")).toThrow(QrChunkError);
  });

  it("regresión (security-review): rechaza un `total` de trozos absurdo en vez de colgarse iterando", () => {
    // Sin este límite, `KP1:1:50000000:x` hacía que isComplete()/missingIndexes()
    // iterasen decenas de millones de veces en cada frame de cámara escaneado.
    expect(() => parseQrChunk("KP1:1:50000000:x")).toThrow(QrChunkError);
    expect(() => parseQrChunk(`KP1:1:${MAX_CHUNKS + 1}:x`)).toThrow(QrChunkError);
    expect(parseQrChunk(`KP1:1:${MAX_CHUNKS}:x`)).toEqual({
      index: 1,
      total: MAX_CHUNKS,
      payload: "x",
    });
  });

  it("rechaza mezclar trozos de dos cápsulas distintas", () => {
    const a = splitIntoQrChunks(base45Encode(randomBytes(2000)), 500);
    const b = splitIntoQrChunks(base45Encode(randomBytes(3000)), 500);
    const collector = new QrChunkCollector();
    collector.add(a[0]!);
    expect(() => collector.add(b[0]!)).toThrow(QrChunkError);
  });
});
