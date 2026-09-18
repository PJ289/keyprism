import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2022",
  },
  plugins: [
    VitePWA({
      // Usamos el manifest.webmanifest ya escrito a mano en public/ (con el
      // <link rel="manifest"> en index.html) en vez de que el plugin genere
      // uno nuevo — así hay una sola fuente de verdad para nombre/iconos.
      manifest: false,
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        // Precachea absolutamente todo el build (JS/CSS/WASM embebido en el
        // JS, HTML, iconos, manifest) para que, tras la primera carga, la
        // app funcione permanentemente offline — es justo el requisito de
        // "PWA instalable 100% cliente" del plan.
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
        // Sin esto, una recarga offline de la SPA no se sirve desde caché
        // (solo los assets estáticos individuales quedarían cacheados, no
        // la navegación de documento en sí).
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
