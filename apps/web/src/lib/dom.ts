// Helper mínimo para construir DOM sin `innerHTML` — importante en una app
// que maneja secretos: evita cualquier riesgo de que un secreto/etiqueta
// con caracteres especiales se interprete como HTML.
type Attrs = Record<string, string | boolean | ((ev: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") {
      node.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
    } else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Formatea bits de entropía con un juicio orientativo en texto. */
export function describeEntropy(bits: number): string {
  if (bits >= 100) return `${bits.toFixed(0)} bits — muy sólida`;
  if (bits >= 80) return `${bits.toFixed(0)} bits — adecuada`;
  return `${bits.toFixed(0)} bits — débil`;
}

/** Tarjeta con cabecera numerada (o con letra: "A", "B"...) — unidad visual
 * base de los flujos de crear/descifrar, en vez de un muro de campos
 * sueltos uno detrás de otro. */
export function stepCard(
  badge: string | number,
  title: string,
  children: (Node | string)[]
): HTMLElement {
  return el("section", { class: "card" }, [
    el("div", { class: "card-header" }, [
      el("span", { class: "step-badge" }, [String(badge)]),
      el("h3", { class: "card-title" }, [title]),
    ]),
    el("div", { class: "card-body" }, children),
  ]);
}

let fieldIdCounter = 0;

/** Empareja una etiqueta visible (y accesible, con `for`/`id` real) con un
 * input/textarea/select, en vez de depender solo del `placeholder`. */
export function formField(
  labelText: string,
  input: HTMLElement,
  hint?: string
): HTMLElement {
  if (!input.id) {
    input.id = `field-${++fieldIdCounter}`;
  }
  const children: (Node | string)[] = [
    el("label", { for: input.id, class: "field-label" }, [labelText]),
    input,
  ];
  if (hint) {
    children.push(el("p", { class: "field-hint" }, [hint]));
  }
  return el("div", { class: "field" }, children);
}

/** Separador "— o —" entre dos formas alternativas de hacer lo mismo. */
export function orDivider(text = "o"): HTMLElement {
  return el("div", { class: "divider" }, [text]);
}
