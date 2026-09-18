// Generación de la "combinación maestra": la frase que el usuario memoriza
// y reutiliza para todas sus cápsulas (cada cápsula tiene su propia sal, así
// que la combinación sola no basta sin el papel — ver README).
//
// Dos modos:
//  - "diceware": mnemonic tipo BIP39 (12 palabras, ~128 bits, wordlist en
//    español) — el checksum de errata viene integrado en el propio esquema
//    (la última palabra codifica un checksum de la entropía).
//  - "custom": frase propia del usuario, con relleno automático de palabras
//    aleatorias si no llega a un suelo mínimo de entropía estimada, más un
//    checksum corto (no es un mecanismo de seguridad, solo detecta erratas
//    de transcripción antes de lanzar el KDF).
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist as spanishWordlist } from "@scure/bip39/wordlists/spanish";
import { ensureSodiumReady } from "./crypto.js";
import { base32Encode, formatForPrint } from "./codec/base32Crockford.js";

export const ENTROPY_FLOOR_BITS = 80;
const BITS_PER_WORDLIST_WORD = Math.log2(spanishWordlist.length);

export type ComboMode = "diceware" | "custom";

export interface MasterCombination {
  /** Texto exacto a introducir al descifrar (con espacios simples). */
  combination: string;
  mode: ComboMode;
  /** Estimación de bits de entropía. Exacta en modo diceware (deriva de la
   * entropía real del mnemonic); orientativa en modo custom (heurística). */
  estimatedBits: number;
  /** Código corto (4 caracteres) para detectar erratas al reintroducir la
   * combinación, antes de lanzar el KDF. No es un mecanismo de seguridad. */
  checksumDisplay: string;
}

/**
 * Modo por defecto: mnemonic tipo diceware/BIP39, 12 palabras (~128 bits) —
 * mismo rigor que una seed phrase de un monedero cripto, con checksum de
 * errata integrado en el propio esquema.
 */
export async function generateDicewareCombination(): Promise<MasterCombination> {
  const combination = generateMnemonic(spanishWordlist, 128);
  return {
    combination,
    mode: "diceware",
    estimatedBits: 128,
    checksumDisplay: await computeChecksumDisplay(combination),
  };
}

/** Comprueba el checksum integrado del mnemonic (detecta erratas/palabras
 * cambiadas de orden sin necesitar red ni el resto de la cápsula). */
export function isValidDicewareCombination(combination: string): boolean {
  return validateMnemonic(combination.trim().toLowerCase(), spanishWordlist);
}

/**
 * Estimación heurística y aproximada de la entropía de una frase escrita a
 * mano: tamaño de alfabeto usado × longitud. No modela ataques de
 * diccionario ni patrones habituales (no sustituye a algo como zxcvbn) —
 * solo decide cuántas palabras aleatorias de relleno hacen falta.
 */
export function estimateCustomPhraseEntropyBits(phrase: string): number {
  const trimmed = phrase.trim();
  if (trimmed.length === 0) return 0;
  let charsetSize = 0;
  if (/[a-záéíóúñü]/i.test(trimmed)) charsetSize += 26;
  if (/[A-ZÁÉÍÓÚÑÜ]/.test(trimmed)) charsetSize += 26;
  if (/[0-9]/.test(trimmed)) charsetSize += 10;
  if (/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ\s]/.test(trimmed)) charsetSize += 33;
  charsetSize = Math.max(charsetSize, 2);
  return trimmed.length * Math.log2(charsetSize);
}

async function randomWords(count: number): Promise<string[]> {
  const words: string[] = [];
  const listSize = spanishWordlist.length;
  // Rejection sampling para evitar sesgo de módulo con crypto.getRandomValues.
  const maxUnbiased = Math.floor(0x100000000 / listSize) * listSize;
  const buf = new Uint32Array(1);
  for (let i = 0; i < count; i++) {
    let r: number;
    do {
      crypto.getRandomValues(buf);
      r = buf[0]!;
    } while (r >= maxUnbiased);
    words.push(spanishWordlist[r % listSize]!);
  }
  return words;
}

/**
 * Combinación con una frase propia + relleno automático de palabras
 * aleatorias hasta cubrir `ENTROPY_FLOOR_BITS`, para no depender de que el
 * usuario juzgue bien si su frase "se siente" suficientemente segura.
 */
export async function buildCustomCombination(
  phrase: string
): Promise<MasterCombination> {
  const baseBits = estimateCustomPhraseEntropyBits(phrase);
  let combination = phrase.trim();
  let estimatedBits = baseBits;
  if (baseBits < ENTROPY_FLOOR_BITS) {
    const missingBits = ENTROPY_FLOOR_BITS - baseBits;
    const paddingWordCount = Math.max(
      1,
      Math.ceil(missingBits / BITS_PER_WORDLIST_WORD)
    );
    const padding = await randomWords(paddingWordCount);
    combination = `${combination} ${padding.join(" ")}`.trim();
    estimatedBits = baseBits + paddingWordCount * BITS_PER_WORDLIST_WORD;
  }
  return {
    combination,
    mode: "custom",
    estimatedBits,
    checksumDisplay: await computeChecksumDisplay(combination),
  };
}

async function computeChecksumDisplay(combination: string): Promise<string> {
  const s = await ensureSodiumReady();
  const digest = s.crypto_generichash(2, combination.normalize("NFC"), null);
  return formatForPrint(base32Encode(digest), 4);
}

/** Para uso en la UI de descifrado: confirma si lo que se acaba de teclear
 * coincide con el checksum mostrado al crear la cápsula, antes de lanzar el
 * KDF caro. */
export async function verifyChecksumDisplay(
  combination: string,
  checksumDisplay: string
): Promise<boolean> {
  const expected = await computeChecksumDisplay(combination);
  return expected === checksumDisplay.trim().toUpperCase();
}
