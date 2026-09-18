// Medidor de entropía con barra de color dinámica. Se usa tanto en vivo
// (mientras el usuario escribe una frase propia) como para mostrar el
// resultado final de una combinación ya generada/aceptada.
import { el } from "../lib/dom.js";

/** Mismo nivel que el mnemonic diceware (12 palabras BIP39) — referencia
 * de "entropía sólida" para el extremo verde de la barra. */
const STRONG_BITS = 128;
/** Suelo mínimo aceptado (ver ENTROPY_FLOOR_BITS en @keyprism/core). */
const FLOOR_BITS = 80;

function judgement(bits: number): string {
  if (bits < 40) return "muy débil";
  if (bits < FLOOR_BITS) return "débil — se rellenará automáticamente";
  if (bits < STRONG_BITS) return "adecuada";
  return "muy sólida";
}

function colorForBits(bits: number): string {
  // Gradiente continuo rojo → amarillo → verde según nos acercamos a
  // STRONG_BITS. clamp a [0, STRONG_BITS] para que no siga subiendo el
  // matiz indefinidamente con frases muy largas.
  const clamped = Math.max(0, Math.min(bits, STRONG_BITS));
  const hue = (clamped / STRONG_BITS) * 130; // 0 = rojo, 130 = verde
  return `hsl(${hue.toFixed(0)}, 75%, 50%)`;
}

export interface EntropyMeter {
  element: HTMLElement;
  update(bits: number): void;
}

export function createEntropyMeter(): EntropyMeter {
  const fill = el("div", { class: "entropy-meter__fill" });
  const track = el("div", { class: "entropy-meter__track" }, [fill]);
  const bitsLabel = el("span", {}, ["0 bits"]);
  const wordLabel = el("span", {}, ["—"]);
  const labels = el("div", { class: "entropy-meter__label" }, [bitsLabel, wordLabel]);
  const element = el("div", { class: "entropy-meter" }, [track, labels]);

  function update(bits: number): void {
    const pct = Math.max(3, Math.min(100, (bits / STRONG_BITS) * 100));
    fill.style.width = `${pct}%`;
    fill.style.backgroundColor = colorForBits(bits);
    bitsLabel.textContent = `${Math.round(bits)} bits`;
    wordLabel.textContent = judgement(bits);
  }

  update(0);
  return { element, update };
}
