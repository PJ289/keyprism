// Escaneo de QR con la cámara del navegador (móvil o portátil), 100% en
// local: los fotogramas nunca salen del dispositivo, solo se procesan con
// jsQR (JS puro, sin red ni WASM) sobre un <canvas> oculto.
import jsQR from "jsqr";

/** Lado mayor del frame que se pasa a jsQR. Decodificar 1080p en cada
 * requestAnimationFrame satura el hilo principal en móvil y deja el
 * <video> en negro (el compositor no llega a pintar el preview). */
const MAX_SCAN_SIDE = 480;

const STREAM_ATTEMPTS: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: "environment" } } },
  { audio: false, video: { facingMode: "environment" } },
  { audio: false, video: true },
];

function friendlyCameraError(err: unknown): Error {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new Error(
      "Permiso de cámara denegado. En iPhone: Ajustes → Safari → Cámara. En Android: el candado de la barra de direcciones → Cámara."
    );
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new Error("Este dispositivo no expone ninguna cámara usable.");
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new Error("La cámara está ocupada por otra app. Ciérrala y vuelve a intentar.");
  }
  if (name === "SecurityError") {
    return new Error("El navegador bloquea la cámara fuera de HTTPS.");
  }
  return err instanceof Error ? err : new Error("No se pudo acceder a la cámara");
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("El visor de vídeo no pudo arrancar"));
    };
    const cleanup = (): void => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
  });
}

export function prepareVideoElement(video: HTMLVideoElement): void {
  // iOS Safari solo reproduce getUserMedia en línea si muted + playsinline
  // están en las *propiedades* del elemento (el atributo HTML no basta).
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("disablepictureinpicture", "");
}

async function requestCameraStream(): Promise<MediaStream> {
  let lastError: unknown;
  for (const constraints of STREAM_ATTEMPTS) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw friendlyCameraError(lastError);
}

export class CameraScanner {
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private frameSkip = 0;
  private lastDetected = "";
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

  /** `true` si el preview está en marcha. `false` si falló (ya avisó via onError). */
  async start(): Promise<boolean> {
    if (!window.isSecureContext) {
      this.onError?.(
        new Error(
          "El navegador solo deja usar la cámara en HTTPS (o localhost). Abre Keyprism por HTTPS o instala la PWA."
        )
      );
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onError?.(
        new Error(
          "Este navegador no expone la cámara. Prueba Safari/Chrome actualizado, o abre la app por HTTPS en vez de como archivo."
        )
      );
      return false;
    }

    prepareVideoElement(this.video);

    try {
      this.stream = await requestCameraStream();
      this.video.srcObject = this.stream;
      await waitForMetadata(this.video);
      // Tras el diálogo de permisos iOS pierde el "user gesture"; muted +
      // playsinline es lo que permite que play() siga funcionando.
      await this.video.play();
    } catch (err) {
      this.stop();
      this.onError?.(friendlyCameraError(err));
      return false;
    }

    this.tick();
    return true;
  }

  private readonly tick = (): void => {
    if (!this.stream) return;
    this.rafId = requestAnimationFrame(this.tick);

    if (this.video.readyState < this.video.HAVE_CURRENT_DATA) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;

    // Un frame de cada dos: deja margen al compositor para pintar el preview.
    this.frameSkip = (this.frameSkip + 1) % 2;
    if (this.frameSkip !== 0) return;

    const scale = Math.min(1, MAX_SCAN_SIDE / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(this.video, 0, 0, w, h);
    const frame = this.ctx.getImageData(0, 0, w, h);
    const code = jsQR(frame.data, frame.width, frame.height, {
      inversionAttempts: "dontInvert",
    });
    if (code?.data && code.data !== this.lastDetected) {
      this.lastDetected = code.data;
      this.onDetect(code.data);
    }
  };

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastDetected = "";
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}
