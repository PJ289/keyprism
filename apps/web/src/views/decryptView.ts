// Flujo "Descifrar": cámara (QR, posiblemente en varios trozos), pegar/subir
// texto (Base45 o Base32), o combinación con verificación de errata opcional.
import {
  CapsuleFormatError,
  Crc16MismatchError,
  QrChunkCollector,
  QrChunkError,
  WrongCombinationError,
  decodePrintPayload,
  decodeQrPayload,
  openCapsuleFromBytes,
  verifyChecksumDisplay,
} from "@keyprism/core";
import { el, clear, stepCard, formField, orDivider } from "../lib/dom.js";
import { CameraScanner } from "../lib/cameraScanner.js";
import { createStatusMessage } from "../components/statusMessage.js";

const AUTO_CLEAR_MS = 30_000;

function decodeAnyPayload(text: string): Uint8Array {
  const errors: string[] = [];
  try {
    return decodePrintPayload(text);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  try {
    return decodeQrPayload(text);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  throw new Error(
    "No se reconoce el formato del código (ni Base32 ni Base45). Revisa que esté completo."
  );
}

function friendlyError(err: unknown): string {
  if (err instanceof WrongCombinationError) {
    return "Combinación incorrecta, o la cápsula no coincide con esta combinación.";
  }
  if (err instanceof Crc16MismatchError) {
    return "El código tiene una errata o está incompleto — revisa la transcripción o vuelve a escanear.";
  }
  if (err instanceof CapsuleFormatError || err instanceof QrChunkError) {
    return `Formato de cápsula no reconocido: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function renderDecryptView(container: HTMLElement): void {
  clear(container);

  let assembledBytes: Uint8Array | null = null;
  let scanner: CameraScanner | null = null;
  let collector = new QrChunkCollector();

  const scanStatus = createStatusMessage();
  const video = el("video", { autoplay: "true", muted: "true", playsinline: "true", class: "scanner-video" });
  const scannerFrame = el("div", { class: "scanner-frame hidden" });
  const scannerWrap = el("div", { class: "scanner-wrap" }, [video, scannerFrame]);

  const startBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        collector = new QrChunkCollector();
        scanStatus.set("info", "Solicitando acceso a la cámara...");
        scanner = new CameraScanner(
          video as HTMLVideoElement,
          (text) => {
            try {
              const isNew = collector.add(text);
              if (isNew) {
                scanStatus.set(
                  "info",
                  collector.totalExpected
                    ? `Escaneados ${collector.scannedCount} de ${collector.totalExpected}.`
                    : "Código leído."
                );
              }
              if (collector.isComplete()) {
                assembledBytes = decodeQrPayload(collector.assemble());
                scanStatus.set("success", "¡Cápsula completa! Introduce la combinación y pulsa Descifrar.");
                stopScanning();
              }
            } catch (err) {
              scanStatus.set("error", friendlyError(err));
            }
          },
          (err) => {
            scanStatus.set("error", `No se pudo acceder a la cámara: ${err.message}`);
          }
        );
        await scanner.start();
        scannerFrame.classList.remove("hidden");
        scanStatus.set("info", "Cámara activa — apunta al QR.");
      },
    },
    ["📷 Iniciar cámara"]
  );

  function stopScanning(): void {
    scanner?.stop();
    scanner = null;
    scannerFrame.classList.add("hidden");
  }

  const stopBtn = el(
    "button",
    {
      onclick: () => {
        stopScanning();
        scanStatus.set("info", "Cámara detenida.");
      },
    },
    ["⏹️ Detener cámara"]
  );

  const scanCard = stepCard(
    "A",
    "Escanear QR con la cámara",
    [scannerWrap, el("div", { class: "actions" }, [startBtn, stopBtn]), scanStatus.element]
  );

  // --- Pegar / subir texto ---------------------------------------------------
  const pasteStatus = createStatusMessage();
  const pasteArea = el("textarea", {
    rows: "4",
    placeholder: "Pega aquí el código (del QR o el texto impreso de respaldo)",
    oninput: (e: Event) => {
      const value = (e.target as HTMLTextAreaElement).value.trim();
      if (!value) {
        assembledBytes = null;
        pasteStatus.clear();
        return;
      }
      try {
        assembledBytes = decodeAnyPayload(value);
        pasteStatus.set("success", "Código leído correctamente.");
      } catch (err) {
        assembledBytes = null;
        pasteStatus.set("error", friendlyError(err));
      }
    },
  });

  const pasteFileInput = el("input", {
    type: "file",
    accept: ".txt",
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      (pasteArea as HTMLTextAreaElement).value = text;
      try {
        assembledBytes = decodeAnyPayload(text.trim());
        pasteStatus.set("success", "Código leído correctamente.");
      } catch (err) {
        assembledBytes = null;
        pasteStatus.set("error", friendlyError(err));
      }
    },
  });

  const pasteCard = stepCard("B", "Pegar código o subir archivo de texto", [
    formField("Código de la cápsula", pasteArea),
    orDivider(),
    formField("O sube un .txt con el código", pasteFileInput),
    pasteStatus.element,
  ]);

  // --- Combinación + checksum opcional --------------------------------------
  const comboInput = el("input", { type: "password", placeholder: "Combinación maestra" });
  const toggleComboBtn = el(
    "button",
    {
      onclick: () => {
        const input = comboInput as HTMLInputElement;
        input.type = input.type === "password" ? "text" : "password";
        toggleComboBtn.textContent = input.type === "password" ? "👁️ Mostrar" : "🙈 Ocultar";
      },
    },
    ["👁️ Mostrar"]
  );
  const checksumInput = el("input", {
    type: "text",
    placeholder: "4 caracteres, ej. XJ4K",
  });
  const checksumStatus = createStatusMessage();
  const verifyBtn = el(
    "button",
    {
      onclick: async () => {
        const combo = (comboInput as HTMLInputElement).value;
        const check = (checksumInput as HTMLInputElement).value;
        if (!combo || !check) return;
        const ok = await verifyChecksumDisplay(combo, check);
        checksumStatus.set(
          ok ? "success" : "warning",
          ok
            ? "Coincide — probablemente sin erratas."
            : "No coincide — revisa la combinación tecleada (esto no es una comprobación de seguridad, solo detecta erratas)."
        );
      },
    },
    ["🔎 Verificar antes de descifrar"]
  );

  const comboCard = stepCard("C", "Combinación maestra", [
    el("div", { class: "actions actions--input" }, [formField("Combinación", comboInput), toggleComboBtn]),
    formField("Código de verificación (opcional)", checksumInput, "Si lo anotaste al crear la cápsula, compruébalo antes de lanzar el descifrado."),
    verifyBtn,
    checksumStatus.element,
  ]);

  // --- Descifrar --------------------------------------------------------
  const resultBox = el("div", { class: "card result hidden" });
  const decryptStatus = createStatusMessage();

  const decryptBtn = el(
    "button",
    {
      class: "primary",
      onclick: async () => {
        const combo = (comboInput as HTMLInputElement).value;
        if (!assembledBytes || !combo) {
          decryptStatus.set("warning", "Falta el código y/o la combinación.");
          return;
        }
        decryptBtn.setAttribute("disabled", "");
        decryptStatus.set("info", "Derivando clave (Argon2id)...");
        try {
          const secret = await openCapsuleFromBytes(assembledBytes, combo);
          showSecret(secret);
          decryptStatus.clear();
        } catch (err) {
          decryptStatus.set("error", friendlyError(err));
        } finally {
          decryptBtn.removeAttribute("disabled");
        }
      },
    },
    ["🔓 Descifrar"]
  );

  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  function showSecret(secret: Uint8Array): void {
    clear(resultBox);
    resultBox.classList.remove("hidden");
    let text: string | null = null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(secret);
    } catch {
      text = null;
    }

    const output = el("textarea", { rows: "6", readonly: "true" }, [text ?? "(datos binarios, usa «Descargar»)"]);
    const copyBtn = el(
      "button",
      {
        onclick: async () => {
          if (text) await navigator.clipboard.writeText(text);
        },
      },
      ["📋 Copiar"]
    );
    const downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(secret)]));
    const downloadLink = el("a", { href: downloadUrl, download: "keyprism-secreto.bin" }, ["⬇️ Descargar como archivo"]);
    const clearNotice = el("p", { class: "status status--info" }, [
      `Se limpiará de la pantalla en ${AUTO_CLEAR_MS / 1000}s por seguridad.`,
    ]);

    resultBox.append(
      el("div", { class: "card-header" }, [
        el("span", { class: "step-badge step-badge--done" }, ["✓"]),
        el("h3", { class: "card-title" }, ["Secreto descifrado"]),
      ]),
      el("div", { class: "card-body" }, [output, el("div", { class: "actions" }, [copyBtn, downloadLink]), clearNotice])
    );
    resultBox.scrollIntoView({ behavior: "smooth", block: "start" });

    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clear(resultBox);
      resultBox.append(
        el("div", { class: "card-body" }, [
          el("p", { class: "status status--info" }, ["Secreto limpiado de la pantalla."]),
        ])
      );
      URL.revokeObjectURL(downloadUrl);
    }, AUTO_CLEAR_MS);
  }

  const decryptCard = stepCard("✓", "Descifrar", [decryptBtn, decryptStatus.element]);

  container.append(
    el("h2", { class: "view-title" }, ["🔓 Descifrar"]),
    scanCard,
    pasteCard,
    comboCard,
    decryptCard,
    resultBox
  );
}
