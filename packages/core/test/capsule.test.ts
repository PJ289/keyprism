import { describe, expect, it } from "vitest";
import {
  createCapsule,
  decodeCapsule,
  encodeCapsule,
  openCapsuleFromBytes,
  openCapsuleFromPrintPayload,
  openCapsuleFromQrPayload,
  decodeQrPayload,
  CapsuleFormatError,
} from "../src/capsule.js";
import { WrongCombinationError } from "../src/crypto.js";
import { Crc16MismatchError } from "../src/codec/crc16.js";
import { splitIntoQrChunks, QrChunkCollector } from "../src/codec/qrChunk.js";

const SECRET = new TextEncoder().encode(
  "48111-222333-444555-666777-888999-000111"
); // ejemplo forma clave BitLocker
const COMBO = "correcto caballo batería grapa";

describe("capsule end-to-end", () => {
  it("crea y abre una cápsula vía QR (Base45) con la combinación correcta", async () => {
    const capsule = await createCapsule({
      secret: SECRET,
      combination: COMBO,
      label: "BitLocker - Portátil trabajo",
    });
    const opened = await openCapsuleFromQrPayload(capsule.qrPayload, COMBO);
    expect(opened).toEqual(SECRET);
  });

  it("crea y abre una cápsula vía transcripción manual (Base32) con la combinación correcta", async () => {
    const capsule = await createCapsule({
      secret: SECRET,
      combination: COMBO,
      label: "BitLocker - Portátil trabajo",
    });
    const opened = await openCapsuleFromPrintPayload(capsule.printPayload, COMBO);
    expect(opened).toEqual(SECRET);
  });

  it("rechaza una combinación incorrecta", async () => {
    const capsule = await createCapsule({ secret: SECRET, combination: COMBO });
    await expect(
      openCapsuleFromQrPayload(capsule.qrPayload, "combinación equivocada")
    ).rejects.toBeInstanceOf(WrongCombinationError);
  });

  it("detecta una errata de transcripción vía CRC antes de intentar descifrar", async () => {
    const capsule = await createCapsule({ secret: SECRET, combination: COMBO });
    const corrupted = capsule.printPayload.replace("-", "").slice(1); // desalinea el texto
    await expect(
      openCapsuleFromPrintPayload(corrupted, COMBO)
    ).rejects.toBeInstanceOf(Crc16MismatchError);
  });

  it("round-trip binario encode/decode preserva todos los campos", async () => {
    const capsule = await createCapsule({
      secret: SECRET,
      combination: COMBO,
      label: "Passbolt - clave privada",
    });
    const reencoded = encodeCapsule(capsule.data);
    expect(reencoded).toEqual(capsule.rawBytes);
    const decoded = decodeCapsule(reencoded);
    expect(decoded.label).toBe("Passbolt - clave privada");
    expect(decoded.salt).toEqual(capsule.data.salt);
    expect(decoded.nonce).toEqual(capsule.data.nonce);
  });

  it("regresión (security-review): rechaza opslimit/memlimit fuera de rango en vez de lanzar Argon2id con parámetros arbitrarios", () => {
    const base = {
      version: 1,
      salt: new Uint8Array(16),
      nonce: new Uint8Array(24),
      label: "",
      ciphertext: new Uint8Array(16),
    };
    // memlimit≈4GiB crafteado a mano: sin el techo, esto forzaría un
    // derive Argon2id con memoria/CPU arbitrarias en cuanto alguien pulsa
    // "Descifrar" sobre un QR/código ajeno.
    expect(() =>
      decodeCapsule(encodeCapsule({ ...base, opslimit: 2, memlimit: 0xffffffff }))
    ).toThrow(CapsuleFormatError);
    expect(() =>
      decodeCapsule(encodeCapsule({ ...base, opslimit: 999, memlimit: 64 * 1024 * 1024 }))
    ).toThrow(CapsuleFormatError);
    // Los perfiles legítimos (standard/high) siguen aceptándose.
    expect(() =>
      decodeCapsule(encodeCapsule({ ...base, opslimit: 3, memlimit: 256 * 1024 * 1024 }))
    ).not.toThrow();
  });

  it("rechaza una versión de formato desconocida", () => {
    const capsule = encodeCapsule({
      version: 99,
      opslimit: 2,
      memlimit: 1,
      salt: new Uint8Array(16),
      nonce: new Uint8Array(24),
      label: "",
      ciphertext: new Uint8Array(16),
    });
    expect(() => decodeCapsule(capsule)).toThrow(CapsuleFormatError);
  });

  it("secretos grandes (varios KB) se pueden trocear en múltiples QR y reensamblarse", async () => {
    const bigSecret = new TextEncoder().encode(
      "-----BEGIN PGP PRIVATE KEY BLOCK-----\n" + "A".repeat(3000) + "\n-----END PGP PRIVATE KEY BLOCK-----"
    );
    const capsule = await createCapsule({
      secret: bigSecret,
      combination: COMBO,
      label: "Passbolt - clave privada",
    });
    const chunks = splitIntoQrChunks(capsule.qrPayload, 500);
    expect(chunks.length).toBeGreaterThan(1);

    const collector = new QrChunkCollector();
    for (const c of chunks) collector.add(c);
    expect(collector.isComplete()).toBe(true);

    const reassembled = collector.assemble();
    const opened = await openCapsuleFromBytes(
      decodeQrPayload(reassembled),
      COMBO
    );
    expect(opened).toEqual(bigSecret);
  });

  it("dos cápsulas del mismo secreto+combinación producen sal/ciphertext distintos (sal única)", async () => {
    const c1 = await createCapsule({ secret: SECRET, combination: COMBO });
    const c2 = await createCapsule({ secret: SECRET, combination: COMBO });
    expect(c1.data.salt).not.toEqual(c2.data.salt);
    expect(c1.qrPayload).not.toEqual(c2.qrPayload);
  });
});
