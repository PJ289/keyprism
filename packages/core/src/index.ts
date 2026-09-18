export {
  KDF_PROFILES,
  ensureSodiumReady,
  WrongCombinationError,
  type KdfParams,
  type KdfProfileName,
} from "./crypto.js";

export {
  createCapsule,
  encodeCapsule,
  decodeCapsule,
  openCapsuleFromBytes,
  openCapsuleFromQrPayload,
  openCapsuleFromPrintPayload,
  decodeQrPayload,
  decodePrintPayload,
  CapsuleFormatError,
  type CapsuleData,
  type CreateCapsuleOptions,
  type CreatedCapsule,
} from "./capsule.js";

export {
  generateDicewareCombination,
  isValidDicewareCombination,
  buildCustomCombination,
  estimateCustomPhraseEntropyBits,
  verifyChecksumDisplay,
  ENTROPY_FLOOR_BITS,
  type MasterCombination,
  type ComboMode,
} from "./combo.js";

export { base45Encode, base45Decode, Base45DecodeError } from "./codec/base45.js";
export {
  base32Encode,
  base32Decode,
  formatForPrint,
  normalizeForDecode,
  Base32DecodeError,
} from "./codec/base32Crockford.js";
export { crc16, appendCrc16, verifyAndStripCrc16, Crc16MismatchError } from "./codec/crc16.js";
export {
  splitIntoQrChunks,
  parseQrChunk,
  QrChunkCollector,
  QrChunkError,
  DEFAULT_CHUNK_SIZE,
  type ParsedQrChunk,
} from "./codec/qrChunk.js";
