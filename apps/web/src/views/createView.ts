// Flujo "Crear cápsula": entrada del secreto, generación/medición de la
// combinación maestra, y salida imprimible (QR + texto Base32).
import {
  KDF_PROFILES,
  type KdfProfileName,
  type MasterCombination,
  buildCustomCombination,
  createCapsule,
  estimateCustomPhraseEntropyBits,
  generateDicewareCombination,
  splitIntoQrChunks,
  DEFAULT_CHUNK_SIZE,
} from "@keyprism/core";
import { el, clear, stepCard, formField, orDivider } from "../lib/dom.js";
import { renderQrToCanvas } from "../lib/qrRender.js";
import { createEntropyMeter } from "../components/entropyMeter.js";
import { createStatusMessage } from "../components/statusMessage.js";

export function renderCreateView(container: HTMLElement): void {
  clear(container);

  let secretBytes: Uint8Array | null = null;
  let combo: MasterCombination | null = null;
  let profile: KdfProfileName = "standard";

  const secretStatus = createStatusMessage();
  const comboBox = el("div", { class: "combo-box hidden" });
  const resultSection = el("section", { class: "card result hidden" });
  const createStatus = createStatusMessage();
  const createBtn = el(
    "button",
    { class: "primary", disabled: true, onclick: () => void handleCreate() },
    ["🔒 Crear cápsula"]
  );

  function updateCreateBtn(): void {
    createBtn.toggleAttribute("disabled", !(secretBytes && combo));
  }

  // --- Paso 1: secreto + etiqueta -------------------------------------------
  const textarea = el("textarea", {
    rows: "5",
    placeholder:
      "Pega aquí el secreto: clave de recuperación BitLocker, códigos 2FA, clave privada Passbolt (armored)...",
    oninput: (e: Event) => {
      const value = (e.target as HTMLTextAreaElement).value;
      if (value.length > 0) {
        secretBytes = new TextEncoder().encode(value);
        secretStatus.set("success", `Texto cargado (${secretBytes.length} bytes).`);
        (fileInput as HTMLInputElement).value = "";
      } else if (!(fileInput as HTMLInputElement).files?.length) {
        secretBytes = null;
        secretStatus.clear();
      }
      updateCreateBtn();
    },
  });

  const fileInput = el("input", {
    type: "file",
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      secretBytes = new Uint8Array(await file.arrayBuffer());
      secretStatus.set("success", `Archivo "${file.name}" cargado (${secretBytes.length} bytes).`);
      (textarea as HTMLTextAreaElement).value = "";
      updateCreateBtn();
    },
  });

  const labelInput = el("input", {
    type: "text",
    placeholder: "ej. «BitLocker - Portátil trabajo»",
  });

  const secretCard = stepCard(1, "Secreto a proteger", [
    formField("Pega el secreto", textarea),
    orDivider(),
    formField("Sube un archivo en su lugar", fileInput),
    secretStatus.element,
    formField("Etiqueta (opcional)", labelInput, "Para reconocer la cápsula de un vistazo entre varias."),
  ]);

  // --- Paso 2: combinación maestra ------------------------------------------
  function showCombo(c: MasterCombination): void {
    combo = c;
    clear(comboBox);
    comboBox.classList.remove("hidden");
    const meter = createEntropyMeter();
    meter.update(c.estimatedBits);
    comboBox.append(
      el("p", { class: "combo-label" }, [
        c.mode === "diceware" ? "🎲 Combinación generada (diceware):" : "✍️ Combinación (frase propia + relleno):",
      ]),
      el("code", { class: "combo-text" }, [c.combination]),
      meter.element,
      el("p", { class: "field-hint" }, [
        "Código de verificación (opcional, anótalo aparte para detectar erratas al descifrar): ",
        el("code", {}, [c.checksumDisplay]),
      ]),
      el("p", { class: "status status--warning" }, [
        "⚠️ Memoriza o guarda esta combinación en un lugar seguro AHORA. No se guarda en ningún sitio — si recargas la página, se pierde.",
      ])
    );
    updateCreateBtn();
  }

  const generateBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        generateBtn.setAttribute("disabled", "");
        try {
          showCombo(await generateDicewareCombination());
        } finally {
          generateBtn.removeAttribute("disabled");
        }
      },
    },
    ["🎲 Generar combinación diceware (recomendado)"]
  );

  // Medidor de entropía EN VIVO mientras se escribe la frase propia, antes
  // de decidir usarla — así se ve al instante si hace falta relleno.
  const livePhraseMeter = createEntropyMeter();
  const customPhraseInput = el("input", {
    type: "text",
    placeholder: "Escribe una frase propia con significado para ti",
    oninput: (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      livePhraseMeter.update(estimateCustomPhraseEntropyBits(value));
    },
  });
  const useCustomBtn = el(
    "button",
    {
      onclick: async () => {
        const phrase = (customPhraseInput as HTMLInputElement).value.trim();
        if (!phrase) return;
        showCombo(await buildCustomCombination(phrase));
      },
    },
    ["✍️ Usar esta frase (con relleno automático si hace falta)"]
  );

  const comboCard = stepCard(2, "Combinación maestra", [
    generateBtn,
    orDivider(),
    formField("O escribe una frase propia", customPhraseInput),
    livePhraseMeter.element,
    useCustomBtn,
    comboBox,
  ]);

  // --- Paso 3: coste del KDF + crear -----------------------------------------
  const profileSelect = el(
    "select",
    {
      onchange: (e: Event) => {
        profile = (e.target as HTMLSelectElement).value as KdfProfileName;
      },
    },
    [
      el("option", { value: "standard" }, ["Estándar (~1s, recomendado)"]),
      el("option", { value: "high" }, ["Alta (~1-2s, más margen frente a hardware dedicado)"]),
    ]
  );
  void KDF_PROFILES; // referenciado solo para el <select>; los valores reales viven en core

  async function handleCreate(): Promise<void> {
    if (!secretBytes || !combo) return;
    createBtn.setAttribute("disabled", "");
    createStatus.set("info", "Derivando clave (Argon2id)...");
    try {
      const capsule = await createCapsule({
        secret: secretBytes,
        combination: combo.combination,
        label: (labelInput as HTMLInputElement).value.trim(),
        profile,
      });
      renderResult(capsule);
      createStatus.clear();
    } catch (err) {
      createStatus.set(
        "error",
        `Error al crear la cápsula: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      createBtn.removeAttribute("disabled");
    }
  }

  const costCard = stepCard(3, "Coste del descifrado", [
    formField(
      "Perfil Argon2id",
      profileSelect,
      "Cuanto más alto, más caro se le hace a un atacante probar combinaciones — y algo más lento para ti también."
    ),
    createBtn,
    createStatus.element,
  ]);

  function renderResult(capsule: Awaited<ReturnType<typeof createCapsule>>): void {
    clear(resultSection);
    resultSection.classList.remove("hidden");

    const qrHost = el("div", { class: "qr-grid" });
    const chunks =
      capsule.qrPayload.length > DEFAULT_CHUNK_SIZE
        ? splitIntoQrChunks(capsule.qrPayload)
        : [capsule.qrPayload];

    chunks.forEach((chunkText, i) => {
      const canvas = el("canvas", {});
      void renderQrToCanvas(canvas, chunkText);
      qrHost.append(
        el("figure", { class: "qr-item" }, [
          canvas,
          el("figcaption", {}, chunks.length > 1 ? [`Parte ${i + 1} de ${chunks.length}`] : ["Escanear con la app"]),
        ])
      );
    });

    resultSection.append(
      el("div", { class: "card-header" }, [
        el("span", { class: "step-badge step-badge--done" }, ["✓"]),
        el("h3", { class: "card-title" }, ["Cápsula creada"]),
      ]),
      el("div", { class: "card-body" }, [
        el("p", { class: "status status--warning" }, [
          "Imprime esta página o guarda el texto de abajo junto a tus otros papeles importantes. Este secreto no queda guardado en ningún sitio.",
        ]),
        el("div", { class: "printable" }, [
          el("p", {}, [`Etiqueta: ${capsule.data.label || "(sin etiqueta)"}`]),
          qrHost,
          el("p", { class: "combo-label" }, ["Respaldo en texto (si no se puede escanear el QR):"]),
          el("pre", { class: "print-payload" }, [capsule.printPayload]),
        ]),
        el("button", { class: "primary", onclick: () => window.print() }, ["🖨️ Imprimir / guardar como PDF"]),
      ])
    );
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  container.append(
    el("h2", { class: "view-title" }, ["📦 Crear cápsula"]),
    secretCard,
    comboCard,
    costCard,
    resultSection
  );
}
