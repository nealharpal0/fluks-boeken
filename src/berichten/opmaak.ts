/**
 * Opmaak van e-mails. Een bericht wordt opgebouwd uit eenvoudige blokken en
 * daaruit maken we zowel een HTML-versie (met huisstijl, werkt in Gmail,
 * Outlook en Apple Mail) als een platte-tekstversie.
 */
import type { KlantConfig } from "../config/schema";
import { leesbaarOpWit, tekstKleurOp } from "../lib/kleur";

export type Blok =
  | { soort: "alinea"; tekst: string }
  | { soort: "knop"; tekst: string; url: string }
  | { soort: "link"; tekst: string; url: string }
  | { soort: "gegevens"; rijen: [string, string][] }
  | { soort: "klein"; tekst: string };

export interface BerichtInhoud {
  onderwerp: string;
  html: string;
  tekst: string;
}

export interface Opmaak {
  titel: string;
  blokken: Blok[];
  /** Link om af te melden (alleen bij niet-noodzakelijke berichten). */
  afmeldUrl?: string;
  /** Uitleg onderaan waarom iemand dit bericht krijgt. */
  voetnoot?: string;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute URL voor afbeeldingen in e-mails. */
export function absoluteUrl(basisUrl: string, pad: string): string {
  return /^https?:\/\//.test(pad) ? pad : `${basisUrl}${pad.startsWith("/") ? "" : "/"}${pad}`;
}

/** Splits tekst op lege regels in alinea's; enkele regeleinden blijven behouden. */
export function alineas(tekst: string): Blok[] {
  return tekst
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ soort: "alinea" as const, tekst: t }));
}

const LETTER = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function regels(t: string): string {
  return esc(t).replace(/\n/g, "<br>");
}

function blokHtml(b: Blok, kleur: string, knopTekst: string, linkKleur: string): string {
  switch (b.soort) {
    case "alinea":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1f2937;">${regels(b.tekst)}</p>`;
    case "klein":
      return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#6b7280;">${regels(b.tekst)}</p>`;
    case "link":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;"><a href="${esc(b.url)}" style="color:${linkKleur};text-decoration:underline;">${esc(b.tekst)}</a></p>`;
    case "knop":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td style="border-radius:8px;background:${kleur};" bgcolor="${kleur}">
<a href="${esc(b.url)}" style="display:inline-block;padding:13px 22px;font-family:${LETTER};font-size:16px;font-weight:600;color:${knopTekst};text-decoration:none;border-radius:8px;">${esc(b.tekst)}</a>
</td></tr></table>`;
    case "gegevens":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 20px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
${b.rijen
  .map(
    ([k, v]) => `<tr><td style="padding:10px 14px;font-size:14px;color:#6b7280;vertical-align:top;width:38%;">${esc(k)}</td><td style="padding:10px 14px;font-size:15px;color:#111827;font-weight:600;vertical-align:top;">${regels(v)}</td></tr>`,
  )
  .join("\n")}
</table>`;
  }
}

function blokTekst(b: Blok): string {
  switch (b.soort) {
    case "alinea":
    case "klein":
      return b.tekst;
    case "knop":
    case "link":
      return `${b.tekst}:\n${b.url}`;
    case "gegevens":
      return b.rijen.map(([k, v]) => `${k}: ${v.replace(/\n/g, ", ")}`).join("\n");
  }
}

export function maakBericht(config: KlantConfig, basisUrl: string, onderwerp: string, o: Opmaak): BerichtInhoud {
  const kleur = config.huisstijl.primaireKleur;
  const knopTekst = tekstKleurOp(kleur);
  const linkKleur = leesbaarOpWit(kleur);
  const b = config.bedrijf;
  const afsluiting = config.berichten.afsluiting ?? `Met vriendelijke groet,\n${b.naam}`;
  const adres = `${b.adres.straat}, ${b.adres.postcode} ${b.adres.plaats}`;
  const contact = [b.telefoon, b.email].filter(Boolean).join(" · ");

  const kop = b.logoEmail
    ? `<img src="${esc(absoluteUrl(basisUrl, b.logoEmail))}" alt="${esc(b.naam)}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0;">`
    : `<span style="font-size:22px;font-weight:700;color:${linkKleur};">${esc(b.naam)}</span>`;

  const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(onderwerp)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.titel)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${LETTER};">
<tr><td style="height:6px;background:${kleur};font-size:0;line-height:0;" bgcolor="${kleur}">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px;">${kop}</td></tr>
<tr><td style="padding:8px 28px 8px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#111827;">${esc(o.titel)}</h1>
${o.blokken.map((x) => blokHtml(x, kleur, knopTekst, linkKleur)).join("\n")}
<p style="margin:8px 0 24px;font-size:16px;line-height:1.55;color:#1f2937;">${regels(afsluiting)}</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280;">
<strong style="color:#374151;">${esc(b.naam)}</strong><br>${esc(adres)}${contact ? `<br>${esc(contact)}` : ""}
${o.voetnoot ? `<br><br>${regels(o.voetnoot)}` : ""}
${o.afmeldUrl ? `<br><a href="${esc(o.afmeldUrl)}" style="color:#6b7280;text-decoration:underline;">Afmelden voor deze berichten</a>` : ""}
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const tekst = [
    o.titel,
    "",
    ...o.blokken.map((x) => blokTekst(x) + "\n"),
    afsluiting,
    "",
    "--",
    b.naam,
    adres,
    contact,
    ...(o.voetnoot ? ["", o.voetnoot] : []),
    ...(o.afmeldUrl ? ["", `Afmelden voor deze berichten: ${o.afmeldUrl}`] : []),
  ]
    .filter((r) => r !== undefined)
    .join("\n");

  return { onderwerp, html, tekst };
}
