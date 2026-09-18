import { describe, expect, it } from "vitest";
import {
  ENTROPY_FLOOR_BITS,
  buildCustomCombination,
  estimateCustomPhraseEntropyBits,
  generateDicewareCombination,
  isValidDicewareCombination,
  verifyChecksumDisplay,
} from "../src/combo.js";

describe("combinación maestra — modo diceware", () => {
  it("genera 12 palabras válidas (mnemonic BIP39 en español, ~128 bits)", async () => {
    const combo = await generateDicewareCombination();
    expect(combo.combination.split(" ")).toHaveLength(12);
    expect(combo.estimatedBits).toBe(128);
    expect(isValidDicewareCombination(combo.combination)).toBe(true);
  });

  it("detecta una palabra cambiada como checksum inválido", async () => {
    const combo = await generateDicewareCombination();
    const words = combo.combination.split(" ");
    words[0] = words[0] === "abaco" ? "abdomen" : "abaco";
    expect(isValidDicewareCombination(words.join(" "))).toBe(false);
  });

  it("dos generaciones no producen la misma frase (fuente aleatoria real)", async () => {
    const a = await generateDicewareCombination();
    const b = await generateDicewareCombination();
    expect(a.combination).not.toBe(b.combination);
  });
});

describe("combinación maestra — modo custom con relleno", () => {
  it("no añade relleno si la frase ya supera el suelo de entropía", async () => {
    const longPhrase = "Xk9#mQ2!vL7$wR4@zT8&pN1*sJ6%";
    const bits = estimateCustomPhraseEntropyBits(longPhrase);
    expect(bits).toBeGreaterThanOrEqual(ENTROPY_FLOOR_BITS);
    const combo = await buildCustomCombination(longPhrase);
    expect(combo.combination).toBe(longPhrase);
  });

  it("añade palabras de relleno si la frase es débil, hasta cubrir el suelo", async () => {
    const weakPhrase = "hola";
    const combo = await buildCustomCombination(weakPhrase);
    expect(combo.combination.startsWith(weakPhrase)).toBe(true);
    expect(combo.combination.split(" ").length).toBeGreaterThan(1);
    expect(combo.estimatedBits).toBeGreaterThanOrEqual(ENTROPY_FLOOR_BITS);
  });

  it("el relleno es aleatorio entre llamadas", async () => {
    const a = await buildCustomCombination("hola");
    const b = await buildCustomCombination("hola");
    expect(a.combination).not.toBe(b.combination);
  });
});

describe("checksum de erratas (no es control de seguridad, solo UX)", () => {
  it("valida correctamente la propia combinación", async () => {
    const combo = await buildCustomCombination("mi frase personal de prueba");
    expect(
      await verifyChecksumDisplay(combo.combination, combo.checksumDisplay)
    ).toBe(true);
  });

  it("detecta una errata de un solo carácter", async () => {
    const combo = await buildCustomCombination("mi frase personal de prueba");
    const typo = combo.combination.slice(0, -1) + "X";
    expect(await verifyChecksumDisplay(typo, combo.checksumDisplay)).toBe(false);
  });
});
