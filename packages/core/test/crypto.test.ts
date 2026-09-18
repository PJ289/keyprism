import { describe, expect, it } from "vitest";
import {
  KDF_PROFILES,
  WrongCombinationError,
  aeadDecrypt,
  aeadEncrypt,
  deriveKey,
  generateNonce,
  generateSalt,
} from "../src/crypto.js";

describe("crypto wrapper", () => {
  it("deriva la misma clave para la misma combinación+sal, y distinta si cambia cualquiera", async () => {
    const salt = await generateSalt();
    const k1 = await deriveKey("combinación de prueba", salt, KDF_PROFILES.standard);
    const k2 = await deriveKey("combinación de prueba", salt, KDF_PROFILES.standard);
    expect(k1).toEqual(k2);

    const salt2 = await generateSalt();
    const k3 = await deriveKey("combinación de prueba", salt2, KDF_PROFILES.standard);
    expect(k3).not.toEqual(k1);

    const k4 = await deriveKey("otra combinación", salt, KDF_PROFILES.standard);
    expect(k4).not.toEqual(k1);
  });

  it("cifra y descifra correctamente con la clave/nonce/aad correctos", async () => {
    const salt = await generateSalt();
    const nonce = await generateNonce();
    const key = await deriveKey("mi combinación", salt, KDF_PROFILES.standard);
    const plaintext = new TextEncoder().encode("48111-222333-444555-666777-888999-000111");
    const aad = new TextEncoder().encode("BitLocker - Portátil");

    const ciphertext = await aeadEncrypt(key, nonce, plaintext, aad);
    const decrypted = await aeadDecrypt(key, nonce, ciphertext, aad);
    expect(decrypted).toEqual(plaintext);
  });

  it("falla con WrongCombinationError si la clave derivada no coincide", async () => {
    const salt = await generateSalt();
    const nonce = await generateNonce();
    const rightKey = await deriveKey("combinación correcta", salt, KDF_PROFILES.standard);
    const wrongKey = await deriveKey("combinación incorrecta", salt, KDF_PROFILES.standard);
    const plaintext = new TextEncoder().encode("secreto");
    const aad = new Uint8Array();

    const ciphertext = await aeadEncrypt(rightKey, nonce, plaintext, aad);
    await expect(aeadDecrypt(wrongKey, nonce, ciphertext, aad)).rejects.toBeInstanceOf(
      WrongCombinationError
    );
  });

  it("falla si el AAD (etiqueta) no coincide, aunque la clave sea correcta", async () => {
    const salt = await generateSalt();
    const nonce = await generateNonce();
    const key = await deriveKey("combinación", salt, KDF_PROFILES.standard);
    const plaintext = new TextEncoder().encode("secreto");

    const ciphertext = await aeadEncrypt(key, nonce, plaintext, new TextEncoder().encode("label-a"));
    await expect(
      aeadDecrypt(key, nonce, ciphertext, new TextEncoder().encode("label-b"))
    ).rejects.toBeInstanceOf(WrongCombinationError);
  });

  it("falla si el ciphertext fue manipulado (integridad Poly1305)", async () => {
    const salt = await generateSalt();
    const nonce = await generateNonce();
    const key = await deriveKey("combinación", salt, KDF_PROFILES.standard);
    const plaintext = new TextEncoder().encode("secreto");
    const aad = new Uint8Array();

    const ciphertext = await aeadEncrypt(key, nonce, plaintext, aad);
    const tampered = ciphertext.slice();
    tampered[0]! ^= 0xff;
    await expect(aeadDecrypt(key, nonce, tampered, aad)).rejects.toBeInstanceOf(
      WrongCombinationError
    );
  });
});
