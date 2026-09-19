// Troceado de un payload Base45 en varios códigos QR cuando no cabe en uno
// solo (p. ej. una clave privada Passbolt armored de varios KB). Cada trozo
// lleva una cabecera con índice/total para poder reensamblarse en cualquier
// orden de escaneo.

const HEADER_PREFIX = "KP1";
const HEADER_RE = /^KP1:(\d+):(\d+):([\s\S]*)$/;

/** Tamaño por defecto de cada trozo de texto Base45 (antes de la cabecera).
 * ~800 caracteres alfanuméricos es razonable para un QR denso pero legible
 * con nivel de corrección de errores medio-alto. */
export const DEFAULT_CHUNK_SIZE = 800;

/**
 * Techo de trozos aceptados al parsear un QR ajeno/no confiable. Con
 * DEFAULT_CHUNK_SIZE=800, 500 trozos cubren ~400.000 caracteres — muy por
 * encima de cualquier secreto real (una clave Passbolt armored ronda 1-3KB).
 * Sin este límite, un QR malicioso con un `total` enorme (ej. "KP1:1:50000000:x")
 * puede colgar la pestaña al iterar sobre `total` en cada frame de cámara
 * (hallazgo de security-review).
 */
export const MAX_CHUNKS = 500;

export function splitIntoQrChunks(
  base45Payload: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): string[] {
  if (chunkSize <= 0) {
    throw new RangeError("chunkSize debe ser mayor que 0");
  }
  const total = Math.max(1, Math.ceil(base45Payload.length / chunkSize));
  const chunks: string[] = [];
  for (let i = 0; i < total; i++) {
    const slice = base45Payload.slice(i * chunkSize, (i + 1) * chunkSize);
    chunks.push(`${HEADER_PREFIX}:${i + 1}:${total}:${slice}`);
  }
  return chunks;
}

export class QrChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrChunkError";
  }
}

export interface ParsedQrChunk {
  index: number;
  total: number;
  payload: string;
}

export function parseQrChunk(raw: string): ParsedQrChunk {
  // OJO: no usar `.trim()` — igual que en base45Decode, el espacio puede
  // ser parte legítima del payload Base45 de este trozo (p. ej. su último
  // carácter), y recortarlo a ciegas truncaría datos reales. Solo se
  // limpian saltos de línea de posibles artefactos de copiar/pegar.
  const match = HEADER_RE.exec(raw.replace(/[\r\n]/g, ""));
  if (!match) {
    throw new QrChunkError(
      "Este código QR no tiene el formato esperado de Keyprism"
    );
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  const payload = match[3] ?? "";
  if (total < 1 || total > MAX_CHUNKS) {
    throw new QrChunkError(
      `Número de trozos fuera de rango (máx. ${MAX_CHUNKS}) — QR no reconocido o manipulado`
    );
  }
  if (index < 1 || index > total) {
    throw new QrChunkError("Índice de trozo de QR fuera de rango");
  }
  return { index, total, payload };
}

/**
 * Acumula trozos escaneados en cualquier orden (útil para la cámara del
 * móvil: cada `add()` es un escaneo). Cuando `isComplete()` es true,
 * `assemble()` devuelve el payload Base45 original.
 */
export class QrChunkCollector {
  private readonly chunks = new Map<number, string>();
  private total: number | null = null;

  /** Devuelve true si el trozo era nuevo y válido (para dar feedback en UI). */
  add(raw: string): boolean {
    // La mayoría de cápsulas caben en un solo QR y se imprimen *sin*
    // cabecera KP1 (solo se trocea a partir de DEFAULT_CHUNK_SIZE). Si
    // exigimos la cabecera, el escáner móvil rechaza el caso normal.
    const cleaned = raw.replace(/[\r\n]/g, "");
    let parsed: ParsedQrChunk;
    try {
      parsed = parseQrChunk(cleaned);
    } catch (err) {
      if (!(err instanceof QrChunkError)) throw err;
      if (this.total !== null && this.total !== 1) {
        throw new QrChunkError(
          "Este QR no encaja con los trozos ya escaneados — ¿es de otra cápsula?"
        );
      }
      parsed = { index: 1, total: 1, payload: cleaned };
    }
    if (this.total === null) {
      this.total = parsed.total;
    } else if (this.total !== parsed.total) {
      throw new QrChunkError(
        "Este QR pertenece a otra cápsula distinta (total de trozos no coincide)"
      );
    }
    const isNew = !this.chunks.has(parsed.index);
    this.chunks.set(parsed.index, parsed.payload);
    return isNew;
  }

  get totalExpected(): number | null {
    return this.total;
  }

  get scannedCount(): number {
    return this.chunks.size;
  }

  missingIndexes(): number[] {
    if (this.total === null) return [];
    const missing: number[] = [];
    for (let i = 1; i <= this.total; i++) {
      if (!this.chunks.has(i)) missing.push(i);
    }
    return missing;
  }

  isComplete(): boolean {
    // Comparación de tamaños en vez de materializar `missingIndexes()` en
    // el camino caliente (se llama tras cada frame de cámara escaneado).
    return this.total !== null && this.chunks.size === this.total;
  }

  assemble(): string {
    if (!this.isComplete() || this.total === null) {
      throw new QrChunkError("Todavía faltan trozos por escanear");
    }
    let out = "";
    for (let i = 1; i <= this.total; i++) {
      out += this.chunks.get(i)!;
    }
    return out;
  }
}
