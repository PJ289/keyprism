// Escaneo de QR con la cámara del navegador (móvil o portátil), 100% en
// local: los fotogramas nunca salen del dispositivo, solo se procesan con
// jsQR (JS puro, sin red ni WASM) sobre un <canvas> oculto.
import jsQR from "jsqr";

export class CameraScanner {
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly onDetect: (text: string) => void,
    private readonly onError?: (err: Error) => void
  ) {
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("No se pudo crear el contexto 2D para el escáner");
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      this.onError?.(
        err instanceof Error
          ? err
          : new Error("No se pudo acceder a la cámara")
      );
      return;
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "true");
    await this.video.play();
    this.tick();
  }

  private readonly tick = (): void => {
    if (!this.stream) return;
    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code?.data) {
        this.onDetect(code.data);
      }
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
