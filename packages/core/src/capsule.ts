// Formato de "cápsula": el contenedor que se imprime/exporta para un
// secreto (clave BitLocker, clave privada Passbolt, códigos 2FA...).
//
// Layout binario v1 (todo big-endian):
//   [1B]  version            = 1
//   [4B]  opslimit           (parámetro Argon2id, guardado para no romper
//   [4B]  memlimit            cápsulas antiguas si cambia el perfil por defecto)
//   [16B] salt               (crypto_pwhash_SALTBYTES, única por cápsula)
//   [24B] nonce              (crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
//   [1B]  labelLen
//   [labelLen B] label       (UTF-8, en claro pero autenticado como AAD)
//   [resto] ciphertext       (incluye el tag de Poly1305 de 16B al final)
//
// Encima de estos bytes se añade un CRC16 (ver codec/crc16.ts) antes de
// codificar a Base45 (para QR) o Base32 de Crockford (para transcripción
// manual impresa).
import {
  KDF_PROFILES,
  KdfProfileName,
  aeadDecrypt,
  aeadEncrypt,
  deriveKey,
  generateNonce,
  generateSalt,
} from "./crypto.js";
import { appendCrc16, verifyAndStripCrc16 } from "./codec/crc16.js";
import { base45Decode, base45Encode } from "./codec/base45.js";
import { base32Decode, base32Encode, formatForPrint } from "./codec/base32Crockford.js";

const FORMAT_VERSION = 1;
const MAX_LABEL_BYTES = 255;

// Techo de parámetros Argon2id aceptados al decodificar una cápsula ajena.
// Los perfiles propios (ver KDF_PROFILES) usan como máximo opslimit=3,
// memlimit=256MiB ("high"); estos límites dejan margen para perfiles
// futuros más costosos sin permitir que una cápsula manipulada fuerce un
// derive con memoria/CPU arbitrarias (hallazgo de security-review: sin
// esto, un payload crafteado con memlimit≈4GiB puede agotar RAM/CPU del
// dispositivo que intenta descifrarlo).
const MAX_OPSLIMIT = 10;
const MAX_MEMLIMIT = 512 * 1024 * 1024; // 512 MiB
const MIN_MEMLIMIT = 8 * 1024; // crypto_pwhash_MEMLIMIT_MIN (libsodium)

export class CapsuleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapsuleFormatError";
  }
}

export interface CapsuleData {
  version: number;
  opslimit: number;
  memlimit: number;
  salt: Uint8Array;
  nonce: Uint8Array;
  label: string;
  ciphertext: Uint8Array;
}

export function encodeCapsule(data: CapsuleData): Uint8Array {
  const labelBytes = new TextEncoder().encode(data.label);
  if (labelBytes.length > MAX_LABEL_BYTES) {
    throw new CapsuleFormatError(
      `La etiqueta es demasiado larga (máx. ${MAX_LABEL_BYTES} bytes en UTF-8)`
    );
  }
  const headerLen = 1 + 4 + 4 + data.salt.length + data.nonce.length + 1;
  const out = new Uint8Array(headerLen + labelBytes.length + data.ciphertext.length);
  const view = new DataView(out.buffer);
  let offset = 0;
  out[offset] = data.version;
  offset += 1;
  view.setUint32(offset, data.opslimit, false);
  offset += 4;
  view.setUint32(offset, data.memlimit, false);
  offset += 4;
  out.set(data.salt, offset);
  offset += data.salt.length;
  out.set(data.nonce, offset);
  offset += data.nonce.length;
  out[offset] = labelBytes.length;
  offset += 1;
  out.set(labelBytes, offset);
  offset += labelBytes.length;
  out.set(data.ciphertext, offset);
  return out;
}

export function decodeCapsule(bytes: Uint8Array): CapsuleData {
  const SALT_LEN = 16;
  const NONCE_LEN = 24;
  const MIN_LEN = 1 + 4 + 4 + SALT_LEN + NONCE_LEN + 1;
  if (bytes.length < MIN_LEN) {
    throw new CapsuleFormatError("Datos de cápsula incompletos o truncados");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const version = bytes[offset]!;
  offset += 1;
  if (version !== FORMAT_VERSION) {
    throw new CapsuleFormatError(
      `Versión de cápsula no soportada: ${version} (esperada: ${FORMAT_VERSION})`
    );
  }
  const opslimit = view.getUint32(offset, false);
  offset += 4;
  const memlimit = view.getUint32(offset, false);
  offset += 4;
  if (opslimit < 1 || opslimit > MAX_OPSLIMIT) {
    throw new CapsuleFormatError(
      `Parámetro opslimit fuera de rango (${opslimit}) — cápsula no reconocida o manipulada`
    );
  }
  if (memlimit < MIN_MEMLIMIT || memlimit > MAX_MEMLIMIT) {
    throw new CapsuleFormatError(
      `Parámetro memlimit fuera de rango (${memlimit}) — cápsula no reconocida o manipulada`
    );
  }
  const salt = bytes.slice(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const nonce = bytes.slice(offset, offset + NONCE_LEN);
  offset += NONCE_LEN;
  const labelLen = bytes[offset]!;
  offset += 1;
  if (offset + labelLen > bytes.length) {
    throw new CapsuleFormatError("Etiqueta truncada en la cápsula");
  }
  const label = new TextDecoder().decode(bytes.slice(offset, offset + labelLen));
  offset += labelLen;
  const ciphertext = bytes.slice(offset);
  if (ciphertext.length < 16) {
    throw new CapsuleFormatError("Cápsula sin datos cifrados suficientes");
  }
  return { version, opslimit, memlimit, salt, nonce, label, ciphertext };
}

export interface CreateCapsuleOptions {
  secret: Uint8Array;
  combination: string;
  label?: string;
  profile?: KdfProfileName;
}

export interface CreatedCapsule {
  data: CapsuleData;
  /** Bytes crudos (sin CRC), útil para tests/depuración. */
  rawBytes: Uint8Array;
  /** Texto Base45 con CRC — para codificar en QR (posiblemente troceado). */
  qrPayload: string;
  /** Texto Base32 de Crockford con CRC, formateado en bloques — para
   * imprimir como respaldo transcribible a mano. */
  printPayload: string;
}

export async function createCapsule(
  opts: CreateCapsuleOptions
): Promise<CreatedCapsule> {
  const profile = KDF_PROFILES[opts.profile ?? "standard"];
  const salt = await generateSalt();
  const nonce = await generateNonce();
  const key = await deriveKey(opts.combination, salt, profile);
  const label = opts.label ?? "";
  const aad = new TextEncoder().encode(label);
  const ciphertext = await aeadEncrypt(key, nonce, opts.secret, aad);
  const data: CapsuleData = {
    version: FORMAT_VERSION,
    opslimit: profile.opslimit,
    memlimit: profile.memlimit,
    salt,
    nonce,
    label,
    ciphertext,
  };
  const rawBytes = encodeCapsule(data);
  const withCrc = appendCrc16(rawBytes);
  return {
    data,
    rawBytes,
    qrPayload: base45Encode(withCrc),
    printPayload: formatForPrint(base32Encode(withCrc)),
  };
}

/**
 * Descifra a partir de los bytes crudos ya reensamblados/decodificados
 * (sin CRC). Lanza `WrongCombinationError` (de crypto.ts) si la
 * combinación no es correcta.
 */
export async function openCapsuleFromBytes(
  rawBytes: Uint8Array,
  combination: string
): Promise<Uint8Array> {
  const data = decodeCapsule(rawBytes);
  const key = await deriveKey(combination, data.salt, {
    opslimit: data.opslimit,
    memlimit: data.memlimit,
  });
  const aad = new TextEncoder().encode(data.label);
  return aeadDecrypt(key, data.nonce, data.ciphertext, aad);
}

/** Decodifica un texto Base45 (QR, ya reensamblado si venía en varios
 * trozos) verificando el CRC antes de intentar descifrar. */
export function decodeQrPayload(qrPayload: string): Uint8Array {
  return verifyAndStripCrc16(base45Decode(qrPayload));
}

/** Decodifica un texto Base32 (transcripción manual) verificando el CRC
 * antes de intentar descifrar. */
export function decodePrintPayload(printPayload: string): Uint8Array {
  return verifyAndStripCrc16(base32Decode(printPayload));
}

export async function openCapsuleFromQrPayload(
  qrPayload: string,
  combination: string
): Promise<Uint8Array> {
  return openCapsuleFromBytes(decodeQrPayload(qrPayload), combination);
}

export async function openCapsuleFromPrintPayload(
  printPayload: string,
  combination: string
): Promise<Uint8Array> {
  return openCapsuleFromBytes(decodePrintPayload(printPayload), combination);
}
