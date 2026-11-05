/** Kleurhulpjes: zorgen dat tekst op de huisstijlkleur altijd goed leesbaar is (WCAG). */

export function isHexKleur(k: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(k);
}

function naarRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function naarHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function luminantie(hex: string): number {
  const [r, g, b] = naarRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminantie(a), luminantie(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Wit of (bijna) zwart, afhankelijk van wat het best leesbaar is op deze achtergrond. */
export function tekstKleurOp(achtergrond: string): string {
  return contrast(achtergrond, "#ffffff") >= contrast(achtergrond, "#111827") ? "#ffffff" : "#111827";
}

/** Mengt een kleur met zwart (factor > 0) of wit (factor < 0). */
export function verdonker(hex: string, factor: number): string {
  const rgb = naarRgb(hex);
  const doel = factor >= 0 ? 0 : 255;
  const f = Math.abs(factor);
  return naarHex(rgb.map((v) => v + (doel - v) * f) as [number, number, number]);
}

/**
 * Een variant van de kleur die als tekst/rand op een witte achtergrond
 * minstens 4,5:1 contrast heeft (bijv. voor links).
 */
export function leesbaarOpWit(hex: string): string {
  let k = hex;
  for (let i = 0; i < 20 && contrast(k, "#ffffff") < 4.5; i++) k = verdonker(k, 0.1);
  return k;
}
