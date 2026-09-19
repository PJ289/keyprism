// Lee un QR de una foto (cámara nativa o galería). No usa getUserMedia,
// así que funciona al abrir el HTML standalone por file:// — el navegador
// no puede dar permiso de cámara en vivo a un archivo, pero sí puede
// devolver una imagen que el usuario acaba de disparar con la app nativa.
import jsQR from "jsqr";

const SCAN_SIDES = [1280, 800, 480];

function decodeAtWidth(source: CanvasImageSource, srcW: number, srcH: number, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h);
  const code = jsQR(frame.data, frame.width, frame.height, {
    inversionAttempts: "attemptBoth",
  });
  return code?.data ?? null;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("No se pudo abrir la imagen"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeQrFromImageFile(file: Blob): Promise<string> {
  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error("La imagen está vacía o no se pudo leer.");
  }
  for (const side of SCAN_SIDES) {
    const text = decodeAtWidth(img, srcW, srcH, side);
    if (text) return text;
  }
  throw new Error("No se encontró un QR en la foto. Acerca el código hasta que llene el encuadre y vuelve a disparar.");
}
