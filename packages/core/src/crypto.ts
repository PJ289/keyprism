// Wrapper fino sobre libsodium: única pieza del código que toca primitivas
// criptográficas directamente. Todo lo demás (formato de cápsula, códecs,
// UI) pasa por aquí en vez de llamar a libsodium directamente.
//
// KDF: Argon2id (crypto_pwhash) — resistente a fuerza bruta con GPU/ASIC.
// AEAD: XChaCha20-Poly1305 (nonce de 24 bytes, seguro con nonces aleatorios;
// da integridad "gratis": una combinación incorrecta falla el tag de
// autenticación sin necesitar checksums adicionales).
// Nota: usamos la variante "sumo" porque `crypto_pwhash` (Argon2id) no está
// incluido en el build mínimo de libsodium-wrappers, solo en sumo.
import sodium from "libsodium-wrappers-sumo";

export interface KdfParams {
  /** crypto_pwhash opslimit (coste de CPU) */
  opslimit: number;
  /** crypto_pwhash memlimit en bytes (coste de memoria) */
  memlimit: number;
}

/**
 * Perfiles de coste del KDF. Se guardan los valores concretos (no solo el
 * id de perfil) dentro de cada cápsula, así que estos perfiles solo afectan
 * a cápsulas nuevas — subir el coste por defecto en el futuro no rompe
 * cápsulas ya emitidas.
 */
export const KDF_PROFILES = {
  /** Objetivo: <1s en un móvil/PC de gama media. Perfil por defecto. */
  standard: { opslimit: 2, memlimit: 64 * 1024 * 1024 } as KdfParams,
  /** Objetivo: ~1-2s, más margen frente a ataques con hardware dedicado. */
  high: { opslimit: 3, memlimit: 256 * 1024 * 1024 } as KdfParams,
} satisfies Record<string, KdfParams>;

export type KdfProfileName = keyof typeof KDF_PROFILES;

export class WrongCombinationError extends Error {
  constructor() {
    super(
      "Combinación incorrecta o datos de la cápsula dañados/incompletos"
    );
    this.name = "WrongCombinationError";
  }
}

let readyPromise: Promise<typeof sodium> | null = null;

/** Garantiza que el módulo WASM/asm.js de libsodium está inicializado. */
export async function ensureSodiumReady(): Promise<typeof sodium> {
  if (!readyPromise) {
    readyPromise = sodium.ready.then(() => sodium);
  }
  return readyPromise;
}

export async function generateSalt(): Promise<Uint8Array> {
  const s = await ensureSodiumReady();
  return s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
}

export async function generateNonce(): Promise<Uint8Array> {
  const s = await ensureSodiumReady();
  return s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
}

export const SALT_BYTES_EXPECTED = 16;
export const NONCE_BYTES_EXPECTED = 24;
export const KEY_BYTES = 32;

/**
 * Deriva una clave simétrica de 32 bytes a partir de la combinación maestra
 * (texto) y una sal única por cápsula, usando Argon2id.
 */
export async function deriveKey(
  combination: string,
  salt: Uint8Array,
  params: KdfParams
): Promise<Uint8Array> {
  const s = await ensureSodiumReady();
  const normalized = combination.normalize("NFC");
  return s.crypto_pwhash(
    KEY_BYTES,
    normalized,
    salt,
    params.opslimit,
    params.memlimit,
    s.crypto_pwhash_ALG_ARGON2ID13
  );
}

/**
 * Cifra `plaintext` con XChaCha20-Poly1305. `aad` (datos autenticados no
 * cifrados, p. ej. la etiqueta del secreto) se autentica pero no se oculta.
 * Devuelve ciphertext con el tag de Poly1305 anexado (formato "combined").
 */
export async function aeadEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const s = await ensureSodiumReady();
  return s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key
  );
}

/**
 * Descifra y verifica. Lanza `WrongCombinationError` si la clave derivada
 * es incorrecta o los datos están corruptos/incompletos — libsodium no
 * distingue ambos casos (es la propiedad de seguridad deseada: no dar
 * pistas de por qué falló).
 */
export async function aeadDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const s = await ensureSodiumReady();
  try {
    return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      key
    );
  } catch {
    throw new WrongCombinationError();
  }
}
