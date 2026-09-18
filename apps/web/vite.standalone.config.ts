// Build alternativo: un único archivo HTML autocontenido (JS+CSS inline,
// sin peticiones de red en tiempo de ejecución) para el USB de emergencia
// — ver "Kit físico de emergencia" en el plan. No incluye el plugin PWA
// (un Service Worker no tiene sentido al abrir el archivo vía `file://`
// desde un USB, y podría incluso fallar/advertir en ese contexto).
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist-standalone",
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
  },
  plugins: [viteSingleFile()],
});
