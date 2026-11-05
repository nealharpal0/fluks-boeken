import { langsteVenster, parseTijdvakken } from "../lib/beschikbaarheid";
import { isHexKleur } from "../lib/kleur";
import { isGeldigeDatum } from "../lib/tijd";
import { type KlantConfig, type Tijdvakken, WEEKDAGEN } from "./schema";

export interface ConfigControle {
  fouten: string[];
  waarschuwingen: string[];
}

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

export function isGeldigEmail(e: string): boolean {
  return e.length <= 254 && EMAIL_RE.test(e);
}

function controleerVakken(naam: string, t: Tijdvakken | undefined, fouten: string[]): void {
  try {
    const vakken = parseTijdvakken(t);
    for (const [van, tot] of vakken) {
      if (tot <= van) fouten.push(`${naam}: eindtijd moet na begintijd liggen.`);
    }
    for (let i = 1; i < vakken.length; i++) {
      if (vakken[i]![0] < vakken[i - 1]![1]) fouten.push(`${naam}: tijdvakken overlappen elkaar.`);
    }
  } catch (e) {
    fouten.push(`${naam}: ${(e as Error).message}`);
  }
}

/** Controleert de inhoud van een configuratie. Fouten moeten opgelost worden; waarschuwingen zijn tips. */
export function valideerConfig(c: KlantConfig): ConfigControle {
  const fouten: string[] = [];
  const waarschuwingen: string[] = [];

  // Bedrijf
  if (!c.bedrijf?.naam?.trim()) fouten.push("bedrijf.naam is verplicht.");
  if (!c.bedrijf?.adres?.straat || !c.bedrijf?.adres?.plaats) fouten.push("bedrijf.adres (straat en plaats) is verplicht.");
  if (!isGeldigEmail(c.bedrijf?.email ?? "")) fouten.push("bedrijf.email is geen geldig e-mailadres.");
  if (c.bedrijf?.googleReviewUrl && !/^https:\/\//.test(c.bedrijf.googleReviewUrl)) {
    fouten.push("bedrijf.googleReviewUrl moet met https:// beginnen.");
  }
  if (c.bedrijf?.logo?.toLowerCase().endsWith(".svg") && !c.bedrijf.logoEmail) {
    waarschuwingen.push("bedrijf.logo is een SVG; stel ook bedrijf.logoEmail (PNG/JPG) in, want veel mailprogramma's tonen geen SVG.");
  }

  // Huisstijl
  if (!isHexKleur(c.huisstijl?.primaireKleur ?? "")) fouten.push('huisstijl.primaireKleur moet een hexkleur zijn, bijv. "#0f766e".');
  if (c.huisstijl?.accentKleur && !isHexKleur(c.huisstijl.accentKleur)) fouten.push("huisstijl.accentKleur moet een hexkleur zijn.");

  // Basis-URL
  if (!/^https:\/\/[^/]+(\/.*)?$/.test(c.basisUrl ?? "") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(c.basisUrl ?? "")) {
    fouten.push('basisUrl moet met https:// beginnen, bijv. "https://boeken.mijnbedrijf.nl".');
  }
  if (c.basisUrl?.endsWith("/")) fouten.push("basisUrl mag niet op een / eindigen.");

  // Tijdzone
  try {
    new Intl.DateTimeFormat("nl-NL", { timeZone: c.tijdzone ?? "Europe/Amsterdam" });
  } catch {
    fouten.push(`tijdzone "${c.tijdzone}" is onbekend.`);
  }

  // Behandelingen
  if (!c.behandelingen?.length) fouten.push("Er moet minstens één behandeling zijn.");
  const ids = new Set<string>();
  const venster = (() => {
    try {
      return langsteVenster(c);
    } catch {
      return 0;
    }
  })();
  for (const [i, b] of (c.behandelingen ?? []).entries()) {
    const naam = `behandelingen[${i}] (${b.naam ?? b.id ?? "?"})`;
    if (!ID_RE.test(b.id ?? "")) fouten.push(`${naam}: id mag alleen kleine letters, cijfers, - en _ bevatten.`);
    if (ids.has(b.id)) fouten.push(`${naam}: id "${b.id}" komt dubbel voor.`);
    ids.add(b.id);
    if (!b.naam?.trim()) fouten.push(`${naam}: naam is verplicht.`);
    if (!Number.isInteger(b.duurMinuten) || b.duurMinuten < 5 || b.duurMinuten > 1440) {
      fouten.push(`${naam}: duurMinuten moet een heel getal tussen 5 en 1440 zijn.`);
    } else if (venster > 0 && b.duurMinuten > venster) {
      waarschuwingen.push(`${naam}: duurt ${b.duurMinuten} minuten, maar het langste openingsvenster (na pauzes) is ${venster} minuten. Deze behandeling is dan nooit te boeken.`);
    }
    if (b.vanafPrijs !== undefined && (!(b.vanafPrijs >= 0) || b.vanafPrijs > 100000)) fouten.push(`${naam}: vanafPrijs is ongeldig.`);
    if (b.onderhoudNaWeken !== undefined && (!Number.isInteger(b.onderhoudNaWeken) || b.onderhoudNaWeken < 1 || b.onderhoudNaWeken > 156)) {
      fouten.push(`${naam}: onderhoudNaWeken moet een heel getal tussen 1 en 156 zijn.`);
    }
  }

  // Openingstijden, pauzes, uitzonderingen
  for (const dag of WEEKDAGEN) {
    if (!(dag in (c.openingstijden ?? {}))) fouten.push(`openingstijden.${dag} ontbreekt (gebruik null voor gesloten).`);
    else controleerVakken(`openingstijden.${dag}`, c.openingstijden[dag], fouten);
  }
  if (Array.isArray(c.pauzes)) controleerVakken("pauzes", c.pauzes, fouten);
  else if (c.pauzes) for (const [dag, p] of Object.entries(c.pauzes)) controleerVakken(`pauzes.${dag}`, p, fouten);
  for (const [datum, t] of Object.entries(c.uitzonderingen ?? {})) {
    if (!isGeldigeDatum(datum)) fouten.push(`uitzonderingen: "${datum}" is geen geldige datum (JJJJ-MM-DD).`);
    controleerVakken(`uitzonderingen.${datum}`, t, fouten);
  }

  // Planning
  const p = c.planning;
  if (!p) fouten.push("planning ontbreekt.");
  else {
    if (!Number.isInteger(p.tijdslotMinuten) || p.tijdslotMinuten < 5 || p.tijdslotMinuten > 240) fouten.push("planning.tijdslotMinuten moet tussen 5 en 240 liggen.");
    if (!Number.isInteger(p.bufferMinuten) || p.bufferMinuten < 0 || p.bufferMinuten > 240) fouten.push("planning.bufferMinuten moet tussen 0 en 240 liggen.");
    if (!Number.isInteger(p.capaciteit) || p.capaciteit < 1 || p.capaciteit > 50) fouten.push("planning.capaciteit moet tussen 1 en 50 liggen.");
    if (!(p.minimaalUrenVooraf >= 0)) fouten.push("planning.minimaalUrenVooraf moet 0 of meer zijn.");
    if (!Number.isInteger(p.maximaalDagenVooruit) || p.maximaalDagenVooruit < 1 || p.maximaalDagenVooruit > 365) fouten.push("planning.maximaalDagenVooruit moet tussen 1 en 365 liggen.");
    if (!(p.annulerenTotUrenVooraf >= 0)) fouten.push("planning.annulerenTotUrenVooraf moet 0 of meer zijn.");
  }

  // Formulier
  const f = c.formulier;
  if (f?.fotos?.aan && (!Number.isInteger(f.fotos.maxAantal) || f.fotos.maxAantal < 1 || f.fotos.maxAantal > 5)) {
    fouten.push("formulier.fotos.maxAantal moet tussen 1 en 5 liggen.");
  }
  const veldIds = new Set<string>();
  for (const v of f?.extraVelden ?? []) {
    if (!ID_RE.test(v.id)) fouten.push(`formulier.extraVelden: id "${v.id}" is ongeldig.`);
    if (veldIds.has(v.id)) fouten.push(`formulier.extraVelden: id "${v.id}" komt dubbel voor.`);
    veldIds.add(v.id);
    if (!v.label?.trim()) fouten.push(`formulier.extraVelden (${v.id}): label is verplicht.`);
  }

  // E-mail
  const e = c.email;
  if (!e) fouten.push("email ontbreekt.");
  else {
    if (!isGeldigEmail(e.afzenderAdres)) fouten.push("email.afzenderAdres is geen geldig e-mailadres.");
    if (!isGeldigEmail(e.beheerderAdres)) fouten.push("email.beheerderAdres is geen geldig e-mailadres.");
    if (e.antwoordAdres && !isGeldigEmail(e.antwoordAdres)) fouten.push("email.antwoordAdres is geen geldig e-mailadres.");
    if (e.smtp) {
      if (!e.smtp.host) fouten.push("email.smtp.host is verplicht.");
      if (!Number.isInteger(e.smtp.poort) || e.smtp.poort < 1 || e.smtp.poort > 65535) fouten.push("email.smtp.poort is ongeldig.");
      if (e.smtp.poort === 25) fouten.push("email.smtp.poort 25 is geblokkeerd bij Cloudflare; gebruik 465 (tls) of 587 (starttls).");
      if (!["tls", "starttls", "geen"].includes(e.smtp.beveiliging)) fouten.push('email.smtp.beveiliging moet "tls", "starttls" of "geen" zijn.');
      if (e.smtp.beveiliging === "geen") waarschuwingen.push("email.smtp.beveiliging is \"geen\": wachtwoorden en e-mails gaan dan onversleuteld over het internet.");
    } else {
      waarschuwingen.push("email.smtp is null: e-mails worden niet verstuurd, alleen gelogd in het beheer.");
    }
  }

  // Berichten
  const b = c.berichten;
  if (!b) fouten.push("berichten ontbreekt.");
  else {
    if (!(b.herinnering.urenVooraf >= 1 && b.herinnering.urenVooraf <= 168)) fouten.push("berichten.herinnering.urenVooraf moet tussen 1 en 168 liggen.");
    if (b.review.aan && !c.bedrijf?.googleReviewUrl) waarschuwingen.push("berichten.review staat aan, maar bedrijf.googleReviewUrl ontbreekt; er worden dan geen reviewverzoeken verstuurd.");
    if (!(b.review.urenNaAfloop >= 0)) fouten.push("berichten.review.urenNaAfloop moet 0 of meer zijn.");
    if (!(b.review.herinneringNaDagen >= 1)) fouten.push("berichten.review.herinneringNaDagen moet 1 of meer zijn.");
    if (!(b.review.nietVakerDanDagen >= 0)) fouten.push("berichten.review.nietVakerDanDagen moet 0 of meer zijn.");
    const seizoenIds = new Set<string>();
    for (const s of b.seizoen ?? []) {
      if (!ID_RE.test(s.id)) fouten.push(`berichten.seizoen: id "${s.id}" is ongeldig.`);
      if (seizoenIds.has(s.id)) fouten.push(`berichten.seizoen: id "${s.id}" komt dubbel voor.`);
      seizoenIds.add(s.id);
      if (!/^\d{2}-\d{2}$/.test(s.datum) || !isGeldigeDatum(`2024-${s.datum}`)) fouten.push(`berichten.seizoen (${s.id}): datum moet "MM-DD" zijn.`);
      if (!s.onderwerp?.trim() || !s.tekst?.trim()) fouten.push(`berichten.seizoen (${s.id}): onderwerp en tekst zijn verplicht.`);
    }
  }

  // Privacy
  if (!c.privacy) fouten.push("privacy ontbreekt.");
  else {
    if (!(c.privacy.fotosBewarenDagen >= 1)) fouten.push("privacy.fotosBewarenDagen moet 1 of meer zijn.");
    if (!(c.privacy.gegevensBewarenMaanden >= 1)) fouten.push("privacy.gegevensBewarenMaanden moet 1 of meer zijn.");
  }

  // Voorbeeldgegevens die nog vervangen moeten worden (.example is een gereserveerd voorbeelddomein).
  const voorbeeld = [
    ["basisUrl", c.basisUrl],
    ["bedrijf.email", c.bedrijf?.email],
    ["email.afzenderAdres", c.email?.afzenderAdres],
    ["email.beheerderAdres", c.email?.beheerderAdres],
    ["email.smtp.host", c.email?.smtp?.host],
  ].filter(([, v]) => typeof v === "string" && /\.example(\/|:|$)/i.test(v));
  if (voorbeeld.length) {
    waarschuwingen.push(`Deze instellingen bevatten nog voorbeeldgegevens (.example): ${voorbeeld.map(([k]) => k).join(", ")}.`);
  }
  if (c.bedrijf?.googleReviewUrl?.includes("VOORBEELD")) waarschuwingen.push("bedrijf.googleReviewUrl is nog de voorbeeldlink.");

  return { fouten, waarschuwingen };
}
