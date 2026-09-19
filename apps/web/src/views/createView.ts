// Flujo "Crear cápsula(s)": una lista de secretos (uno o varios) más,
// opcionalmente, cápsulas ya cifradas importadas para combinarlas en la
// misma hoja; una única combinación maestra compartida para los secretos
// nuevos; y una hoja de impresión con el QR + respaldo de cada cápsula
// colocados juntos para aprovechar el papel.
import {
  KDF_PROFILES,
  type KdfProfileName,
  type MasterCombination,
  buildCustomCombination,
  createCapsule,
  estimateCustomPhraseEntropyBits,
  generateDicewareCombination,
} from "@keyprism/core";
import { el, clear, stepCard, formField, orDivider } from "../lib/dom.js";
import { createEntropyMeter } from "../components/entropyMeter.js";
import { createStatusMessage } from "../components/statusMessage.js";
import {
  createImportedBatchItem,
  createNewBatchItem,
  type BatchItem,
  type ImportedBatchItem,
  type NewBatchItem,
} from "../components/batchItem.js";
import { buildPrintSheet } from "../components/printSheet.js";
import { fromCreatedCapsule, importCapsuleFromText, type PrintableCapsule } from "../lib/printableCapsule.js";

export function renderCreateView(container: HTMLElement): void {
  clear(container);

  let combo: MasterCombination | null = null;
  let profile: KdfProfileName = "standard";
  let nextItemId = 1;
  const items: BatchItem[] = [];

  const resultSection = el("section", { class: "card result hidden" });
  const createStatus = createStatusMessage();
  const createBtn = el(
    "button",
    { class: "primary", disabled: true, onclick: () => void handleCreate() },
    ["🔒 Crear cápsula(s)"]
  );

  function hasNewSecret(): boolean {
    return items.some((i): i is NewBatchItem => i.kind === "new" && i.secretBytes !== null);
  }
  function hasImported(): boolean {
    return items.some((i) => i.kind === "imported");
  }
  function updateCreateBtn(): void {
    const ready = (hasNewSecret() ? combo !== null : true) && (hasNewSecret() || hasImported());
    createBtn.toggleAttribute("disabled", !ready);
  }

  // --- Paso 1: lista de secretos (uno o varios) + importar existentes -------
  const itemsHost = el("div", { class: "batch-list" });

  function removeItem(id: number): void {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    items[idx]!.element.remove();
    items.splice(idx, 1);
    updateCreateBtn();
  }

  function addNewItemRow(): void {
    const item = createNewBatchItem(nextItemId++, updateCreateBtn, removeItem);
    items.push(item);
    itemsHost.append(item.element);
    updateCreateBtn();
  }

  function addImportedItem(printable: PrintableCapsule): void {
    const item: ImportedBatchItem = createImportedBatchItem(nextItemId++, printable, removeItem);
    items.push(item);
    itemsHost.append(item.element);
    updateCreateBtn();
  }

  let pendingImport: PrintableCapsule | null = null;
  const importStatus = createStatusMessage();

  function tryDecodeImport(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      pendingImport = null;
      importStatus.clear();
      return;
    }
    try {
      pendingImport = importCapsuleFromText(trimmed);
      importStatus.set("success", `Código reconocido — etiqueta: "${pendingImport.label || "(sin etiqueta)"}".`);
    } catch (err) {
      pendingImport = null;
      importStatus.set("error", err instanceof Error ? err.message : String(err));
    }
  }

  const importTextarea = el("textarea", {
    rows: "3",
    placeholder: "Pega aquí el código (Base32 o Base45) de una cápsula ya creada",
    oninput: (e: Event) => tryDecodeImport((e.target as HTMLTextAreaElement).value),
  });

  const importFileInput = el("input", {
    type: "file",
    accept: ".txt",
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      (importTextarea as HTMLTextAreaElement).value = text;
      tryDecodeImport(text);
    },
  });

  function resetImportPanel(): void {
    (importTextarea as HTMLTextAreaElement).value = "";
    (importFileInput as HTMLInputElement).value = "";
    pendingImport = null;
    importStatus.clear();
  }

  function toggleImportPanel(show: boolean): void {
    importPanel.classList.toggle("hidden", !show);
    if (!show) resetImportPanel();
  }

  const importPanel = el("div", { class: "import-panel hidden" }, [
    formField(
      "Código de la cápsula",
      importTextarea,
      "No hace falta la combinación maestra para importarla: la etiqueta va sin cifrar."
    ),
    orDivider(),
    formField("O sube un archivo .txt", importFileInput),
    el("div", { class: "actions" }, [
      el(
        "button",
        {
          class: "primary",
          onclick: () => {
            if (!pendingImport) return;
            addImportedItem(pendingImport);
            toggleImportPanel(false);
          },
        },
        ["➕ Añadir a la hoja"]
      ),
      el("button", { onclick: () => toggleImportPanel(false) }, ["Cancelar"]),
    ]),
    importStatus.element,
  ]);

  const secretCard = stepCard(1, "Secretos a proteger", [
    el("p", { class: "field-hint" }, [
      "Añade uno o varios secretos — todos se cifrarán con la misma combinación maestra y se imprimirán juntos en la misma hoja. También puedes importar una cápsula ya creada para combinarla sin repetir papel.",
    ]),
    itemsHost,
    el("div", { class: "actions" }, [
      el("button", { onclick: addNewItemRow }, ["➕ Añadir otro secreto"]),
      el("button", { onclick: () => toggleImportPanel(true) }, ["📥 Importar cápsula existente"]),
    ]),
    importPanel,
  ]);

  addNewItemRow(); // arranca con una fila vacía, como el flujo de un solo secreto

  // --- Paso 2: combinación maestra (compartida por todo el lote) -----------
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
        "⚠️ Memoriza o guarda esta combinación en un lugar seguro AHORA, por separado de las cápsulas impresas. No se guarda en ningún sitio — si recargas la página, se pierde.",
      ])
    );
    updateCreateBtn();
  }

  const comboBox = el("div", { class: "combo-box hidden" });

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
    el("p", { class: "field-hint" }, [
      "Una sola combinación para todos los secretos nuevos de esta hoja (cada cápsula lleva además su propia sal aleatoria).",
    ]),
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
    const newItems = items.filter(
      (i): i is NewBatchItem => i.kind === "new" && i.secretBytes !== null
    );
    const importedItems = items.filter((i): i is ImportedBatchItem => i.kind === "imported");
    if (newItems.length === 0 && importedItems.length === 0) return;
    if (newItems.length > 0 && !combo) return;

    createBtn.setAttribute("disabled", "");
    try {
      const printables: PrintableCapsule[] = [];
      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i]!;
        createStatus.set(
          "info",
          newItems.length > 1
            ? `Derivando clave ${i + 1} de ${newItems.length} (Argon2id)...`
            : "Derivando clave (Argon2id)..."
        );
        const created = await createCapsule({
          secret: item.secretBytes!,
          combination: combo!.combination,
          label: item.labelInput.value.trim(),
          profile,
        });
        printables.push(fromCreatedCapsule(created));
      }
      for (const item of importedItems) {
        printables.push(item.printable);
      }
      renderResult(printables);
      createStatus.clear();
    } catch (err) {
      createStatus.set(
        "error",
        `Error al crear la hoja: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      createBtn.removeAttribute("disabled");
    }
  }

  const costCard = stepCard(3, "Coste del descifrado", [
    formField(
      "Perfil Argon2id",
      profileSelect,
      "Cuanto más alto, más caro se le hace a un atacante probar combinaciones — y algo más lento para ti también. Se aplica a los secretos nuevos de esta hoja."
    ),
    createBtn,
    createStatus.element,
  ]);

  function renderResult(printables: PrintableCapsule[]): void {
    clear(resultSection);
    resultSection.classList.remove("hidden");
    const sheet = buildPrintSheet(printables);

    resultSection.append(
      el("div", { class: "card-header" }, [
        el("span", { class: "step-badge step-badge--done" }, ["✓"]),
        el("h3", { class: "card-title" }, [
          printables.length > 1 ? `Hoja creada (${printables.length} cápsulas)` : "Cápsula creada",
        ]),
      ]),
      el("div", { class: "card-body" }, [
        el("p", { class: "status status--warning" }, [
          "Imprime esta página o guarda el texto de cada cápsula junto a tus otros papeles importantes. Ningún secreto queda guardado en ningún sitio — y la combinación maestra NUNCA debe guardarse junto a este papel.",
        ]),
        sheet,
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
