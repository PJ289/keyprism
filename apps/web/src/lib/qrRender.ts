// Renderizado de QR. Envuelto en un módulo propio para que el resto de la
// app no dependa directamente de la librería `qrcode`.
import QRCode from "qrcode";

const QR_OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  scale: 6,
};

export async function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string
): Promise<void> {
  await QRCode.toCanvas(canvas, text, QR_OPTIONS);
}
