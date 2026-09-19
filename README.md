# Keyprism

Cifra claves de recuperación (BitLocker, claves privadas Passbolt, códigos
de respaldo 2FA...) en **cápsulas** imprimibles, descifrables offline con
una única **combinación maestra** memorizada. Todo el cálculo ocurre en el
dispositivo — no hay backend, no hay red, no hay servidor en ningún punto
del flujo.

## Por qué existe

Un cifrado real (Argon2id + XChaCha20-Poly1305) no se puede calcular a mano
con papel y lápiz de forma segura. "A mano" en este proyecto significa: sin
depender de un servidor, sin necesitar una app instalada de antemano, sin
conexión — pero el cálculo lo sigue haciendo código, ejecutado localmente.

## Modelo de amenaza

- **Protege contra**: alguien que encuentra/roba el papel impreso pero no
  conoce la combinación maestra (fuerza bruta offline encarecida por
  Argon2id); alguien que conoce o adivina la combinación pero no tiene el
  papel específico de una cápsula concreta (cada cápsula lleva su propia
  sal aleatoria — la combinación sola, sin el papel, no sirve para nada).
- **No protege contra**: malware/keylogger en el dispositivo en el momento
  de descifrar — es inherente a cualquier herramienta de descifrado local;
  usa un dispositivo limpio cuando puedas.
- **Fuera de alcance (v1)**: Shamir Secret Sharing (k-de-n papeles),
  rotación/re-cifrado masivo de la combinación maestra, cualquier
  sincronización o backup en la nube. El diseño es deliberadamente
  offline-first; estas son ideas evaluadas para una v2, no construidas.

## Arquitectura

```
packages/core/   TypeScript puro, sin DOM: formato de cápsula, wrapper
                 criptográfico (libsodium-wrappers-sumo), códecs
                 Base45/Base32, troceado multi-QR. Es el motor que
                 reutilizan tanto la PWA como el export standalone.
apps/web/        PWA (Vite): flujo de creación, flujo de descifrado
                 (cámara + pegar/subir), Service Worker offline, y el
                 exportador a un único .html autocontenido.
```

### Esquema criptográfico

- **AEAD**: XChaCha20-Poly1305 — nonce de 24 bytes, seguro con nonces
  aleatorios; una combinación incorrecta falla el tag de autenticación sin
  necesitar checksums adicionales.
- **KDF**: Argon2id vía `crypto_pwhash` — memory-hard, resistente a
  fuerza bruta con GPU/ASIC. Los parámetros de coste se guardan dentro de
  cada cápsula, así que subir el perfil por defecto en el futuro no rompe
  cápsulas ya emitidas.
- **Librería**: `libsodium-wrappers-sumo` (WASM, auditada). Se usa la
  variante *sumo* porque `crypto_pwhash` (Argon2id) no está incluido en el
  build mínimo de libsodium-wrappers.
- **Combinación maestra**: mnemonic tipo diceware/BIP39 en español (12
  palabras, ~128 bits) por defecto, o una frase propia con relleno
  automático de palabras aleatorias hasta cubrir un suelo de ~80 bits de
  entropía estimada. Ambos modos generan un código corto de verificación
  (no es un control de seguridad, solo detecta erratas de transcripción
  antes de lanzar el KDF).
- **Formato de cápsula**: versionado, con CRC16 de cola para detectar
  erratas de transcripción/escaneo antes de intentar descifrar. Ver
  cabecera de [`packages/core/src/capsule.ts`](packages/core/src/capsule.ts)
  para el layout binario exacto.

### Varios secretos en una misma hoja / importar cápsulas existentes

La vista "Crear" admite una lista de secretos en vez de uno solo: cada uno
tiene su propia etiqueta y su propia cápsula (salt/nonce propios), pero
todos comparten la **misma combinación maestra** introducida una vez en el
paso 2. Al crear, se genera una única hoja imprimible con el QR (o QRs, si
algún secreto necesita trocearse) y el respaldo en texto de cada cápsula
colocados en cuadrícula, para aprovechar el papel en vez de imprimir una
hoja por secreto.

También se puede **importar** una cápsula ya creada (pegando su código o
subiendo el `.txt` de respaldo) para combinarla en la misma hoja junto a
secretos nuevos — por ejemplo, si ya tenías impresa la cápsula de
BitLocker y ahora quieres añadir la de Passbolt en el mismo papel. Importar
no necesita la combinación maestra: la etiqueta va sin cifrar (autenticada
como AAD) dentro de la cápsula, así que se puede leer y volver a maquetar
sin descifrar el secreto. La combinación maestra deliberadamente **no** se
imprime nunca en la hoja (ni la de las cápsulas nuevas ni, por supuesto, la
de las importadas) — mezclarla con el papel rompería el modelo de dos
factores.

## Desarrollo

```bash
npm install          # instala todo el monorepo (workspaces npm)
npm test              # tests unitarios de packages/core (vitest)
npm run dev:web        # servidor de desarrollo de la PWA
npm run build:web      # build de producción de la PWA (con Service Worker)
```

Build del export standalone (un único `.html` para el USB de emergencia):

```bash
cd apps/web && npm run build:standalone
# genera apps/web/dist-standalone/index.html
```

### Smoke tests con navegador real (Playwright)

No forman parte de `npm test` (requieren un navegador Chromium instalado
vía `npx playwright install chromium` y, según el caso, un servidor
levantado). Verifican en runtime real cosas que el typecheck/vitest no
cubren: carga del WASM de libsodium, generación/lectura de QR, y el
requisito de "cero peticiones de red" del export standalone.

```bash
cd apps/web
npm run build && npm run preview -- --port 4173 &   # para e2e-smoke*.mjs
node e2e-smoke.mjs         # flujo crear→descifrar (un secreto)
node e2e-smoke-batch.mjs   # lote de varios secretos, importar cápsula, aislamiento de impresión

npm run build:standalone
node e2e-smoke-file.mjs   # abre dist-standalone/index.html vía file://

npm run build && npm run preview -- --port 4174 &   # para el test offline
node e2e-smoke-pwa-offline.mjs   # confirma que el Service Worker cachea todo
```

## Kit físico de emergencia (USB + papeles, sin PC)

El export standalone (`dist-standalone/index.html`) está pensado para
guardarse en un USB junto a las cápsulas impresas, y poder abrirse **sin
ordenador**, conectando el USB directamente a un móvil:

- **Android**: la mayoría soporta USB-OTG (USB-C directo en móviles
  modernos, o USB-A + adaptador OTG en más antiguos) — no es universal,
  valida con el dispositivo real. Si el móvil tiene ranura microSD, una
  copia ahí evita depender de OTG.
- **iPhone**: USB-C directo en iPhone 15+; modelos anteriores necesitan el
  adaptador Lightning-a-USB de Apple. Al abrir el `.html` desde Archivos,
  iOS suele usar Quick Look (WebView limitado) en vez de Safari a pantalla
  completa — funciona porque el archivo es 100% autocontenido, pero es el
  eslabón menos fiable de los cuatro sistemas y debe probarse en el
  iPhone real.
- **Recomendación de kit**: pincho USB dual USB-C + USB-A como pieza
  principal, más adaptador OTG y/o Lightning guardados en el mismo sobre
  que las papeletas impresas; copia adicional en microSD si aplica;
  formatear en exFAT (compatibilidad universal).
- **Validación obligatoria**: prueba una vez la apertura real del `.html`
  en el móvil de repuesto concreto antes de dar el kit de emergencia por
  completo — es el punto de fallo más silencioso si no se comprueba de
  antemano.
- **Por qué funciona sin red**: el binario WASM de libsodium va embebido
  directamente en el JavaScript del build (no se hace ningún `fetch` de un
  `.wasm` aparte), así que abrir el archivo vía `file://` — con o sin
  conexión — funciona igual que servido por HTTP. Esto está verificado
  automáticamente en `e2e-smoke-file.mjs` (navega con la red del contexto
  del navegador completamente deshabilitada y confirma cero peticiones de
  red).
- Descartado para v1 (evaluado, no construido): imprimir la app entera
  como secuencia de QR para no depender de ningún USB — el bundle actual
  (~735 KB) exigiría demasiados QR para ser práctico. Revisable en v2 si
  interesa un fallback 100% papel sin USB.

## Revisión de seguridad

Se realizó una revisión de seguridad de `packages/core` y `apps/web`
centrada en el uso de primitivas criptográficas, generación de
aleatoriedad y manejo de secretos en la UI. Conclusión: **diseño
criptográfico correcto** (Argon2id/XChaCha20-Poly1305, nonces/sales
aleatorios, sin XSS por inyección de HTML). Encontró 2 hallazgos medios de
denegación de servicio local al procesar QRs/cápsulas no confiables
(número de trozos y parámetros Argon2id sin techo) — **ya corregidos**, con
tests de regresión en `packages/core/test/`.

## Limitaciones conocidas / trabajo futuro

- El bundle de la PWA (~735 KB, ~263 KB gzip) es grande porque
  `libsodium-wrappers-sumo` incluye toda la superficie de libsodium, no
  solo Argon2id + XChaCha20-Poly1305. Se podría reducir con un build WASM
  a medida, pero no es prioritario para un uso puntual (crear/descifrar
  unas pocas cápsulas), no una app de uso continuo.
- El KDF (Argon2id) corre en el hilo principal — para el perfil "estándar"
  es rápido (~cientos de ms), pero el perfil "alta" podría notarse como un
  breve bloqueo de la UI. Pendiente: mover a un Web Worker si se nota en
  dispositivos de gama baja.
- Iconos del manifest son un SVG placeholder — falta un PNG real para
  mejor compatibilidad con "Añadir a pantalla de inicio" en Android/iOS
  más antiguos.
- Ideas evaluadas y explícitamente diferidas: Shamir Secret Sharing
  (k-de-n papeles), modos de combinación maestra alternativos
  (frase-plantilla tipo historia, secuencia de emojis), rotación de la
  combinación maestra.

## Licencia

[MIT](LICENSE)
