/**
 * Tijdrekening.
 *
 * Alle bedrijfstijden worden opgeslagen als lokale tijd van het bedrijf in het
 * formaat "JJJJ-MM-DDTUU:MM" (een "Moment"). Zulke teksten sorteren en
 * vergelijken correct als gewone strings, ook in SQLite. Alleen voor de
 * iCal-feed rekenen we om naar UTC.
 */

/** "JJJJ-MM-DD" */
export type Datum = string;
/** "JJJJ-MM-DDTUU:MM" (lokale tijd van het bedrijf) */
export type Moment = string;

const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOMENT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIJD_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isGeldigeDatum(d: string): boolean {
  const m = DATUM_RE.exec(d);
  if (!m) return false;
  const [j, mnd, dag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(j, mnd - 1, dag));
  return dt.getUTCFullYear() === j && dt.getUTCMonth() === mnd - 1 && dt.getUTCDate() === dag;
}

export function isGeldigeTijd(t: string): boolean {
  return TIJD_RE.test(t);
}

export function isGeldigMoment(m: string): boolean {
  const r = MOMENT_RE.exec(m);
  return !!r && isGeldigeDatum(m.slice(0, 10)) && isGeldigeTijd(m.slice(11));
}

/** "09:30" -> 570. "24:00" is toegestaan als einde van de dag. */
export function naarMinuten(tijd: string): number {
  if (tijd === "24:00") return 1440;
  const m = TIJD_RE.exec(tijd);
  if (!m) throw new Error(`Ongeldige tijd: "${tijd}" (verwacht UU:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 570 -> "09:30" */
export function vanMinuten(min: number): string {
  const u = Math.floor(min / 60);
  const m = min % 60;
  return `${String(u).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function naarUtcMs(m: Moment): number {
  const r = MOMENT_RE.exec(m);
  if (!r) throw new Error(`Ongeldig moment: "${m}"`);
  return Date.UTC(Number(r[1]), Number(r[2]) - 1, Number(r[3]), Number(r[4]), Number(r[5]));
}

function vanUtcMs(ms: number): Moment {
  return new Date(ms).toISOString().slice(0, 16);
}

export function maakMoment(datum: Datum, minuten: number): Moment {
  return vanUtcMs(Date.UTC(
    Number(datum.slice(0, 4)),
    Number(datum.slice(5, 7)) - 1,
    Number(datum.slice(8, 10)),
  ) + minuten * 60_000);
}

export function datumVan(m: Moment): Datum {
  return m.slice(0, 10);
}

export function tijdVan(m: Moment): string {
  return m.slice(11, 16);
}

/** Minuten sinds middernacht van de eigen datum. */
export function minutenVan(m: Moment): number {
  return naarMinuten(tijdVan(m));
}

/** Telt minuten op bij een lokaal moment (zonder zomertijdcorrectie; dat is voor afspraken niet nodig). */
export function plusMinuten(m: Moment, minuten: number): Moment {
  return vanUtcMs(naarUtcMs(m) + minuten * 60_000);
}

export function plusUren(m: Moment, uren: number): Moment {
  return plusMinuten(m, uren * 60);
}

export function plusDagen(d: Datum, dagen: number): Datum {
  return vanUtcMs(naarUtcMs(`${d}T00:00`) + dagen * 86_400_000).slice(0, 10);
}

/** Verschil in minuten (b - a). */
export function minutenTussen(a: Moment, b: Moment): number {
  return Math.round((naarUtcMs(b) - naarUtcMs(a)) / 60_000);
}

/** 0 = maandag ... 6 = zondag */
export function weekdagIndex(d: Datum): number {
  const dag = new Date(naarUtcMs(`${d}T00:00`)).getUTCDay(); // 0 = zondag
  return (dag + 6) % 7;
}

/** Maandag van de week waarin `d` valt. */
export function maandagVan(d: Datum): Datum {
  return plusDagen(d, -weekdagIndex(d));
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tijdzone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tijdzone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tijdzone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tijdzone, f);
  }
  return f;
}

function delen(datum: Date, tijdzone: string): Record<string, number> {
  const uit: Record<string, number> = {};
  for (const p of formatter(tijdzone).formatToParts(datum)) {
    if (p.type !== "literal") uit[p.type] = Number(p.value);
  }
  return uit;
}

/** Huidige lokale tijd in de tijdzone van het bedrijf, als Moment. */
export function nuLokaal(tijdzone: string, nu: Date = new Date()): Moment {
  const p = delen(nu, tijdzone);
  const uur = p.hour === 24 ? 0 : p.hour!;
  return vanUtcMs(Date.UTC(p.year!, p.month! - 1, p.day!, uur, p.minute!));
}

/** Verschil tussen lokale tijd en UTC op een bepaald tijdstip, in minuten. */
function offsetMinuten(utcMs: number, tijdzone: string): number {
  const p = delen(new Date(utcMs), tijdzone);
  const uur = p.hour === 24 ? 0 : p.hour!;
  const lokaal = Date.UTC(p.year!, p.month! - 1, p.day!, uur, p.minute!, p.second!);
  return Math.round((lokaal - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** Zet een lokaal moment om naar een echte (UTC) Date, rekening houdend met zomertijd. */
export function lokaalNaarUtc(m: Moment, tijdzone: string): Date {
  const gok = naarUtcMs(m);
  let ms = gok - offsetMinuten(gok, tijdzone) * 60_000;
  // Tweede ronde voor momenten vlak rond de zomertijdwissel.
  ms = gok - offsetMinuten(ms, tijdzone) * 60_000;
  return new Date(ms);
}

// ---------- Nederlandse weergave ----------

export const DAGNAMEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
export const DAGNAMEN_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
export const MAANDNAMEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];
export const MAANDNAMEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "dinsdag 3 november 2026" */
export function formatDatumLang(d: Datum, metJaar = true): string {
  const dag = Number(d.slice(8, 10));
  const maand = MAANDNAMEN[Number(d.slice(5, 7)) - 1];
  return `${DAGNAMEN[weekdagIndex(d)]} ${dag} ${maand}${metJaar ? ` ${d.slice(0, 4)}` : ""}`;
}

/** "di 3 nov" */
export function formatDatumKort(d: Datum): string {
  return `${DAGNAMEN_KORT[weekdagIndex(d)]} ${Number(d.slice(8, 10))} ${MAANDNAMEN_KORT[Number(d.slice(5, 7)) - 1]}`;
}

/** "dinsdag 3 november 2026 om 10:30" */
export function formatMomentLang(m: Moment): string {
  return `${formatDatumLang(datumVan(m))} om ${tijdVan(m)}`;
}

/** "1 uur", "45 minuten", "2,5 uur", "1 uur en 15 minuten" */
export function formatDuur(minuten: number): string {
  if (minuten < 60) return `${minuten} minuten`;
  const uren = Math.floor(minuten / 60);
  const rest = minuten % 60;
  if (rest === 0) return `${uren} uur`;
  if (rest === 30) return `${uren},5 uur`;
  return `${uren} uur en ${rest} minuten`;
}

// ---------- Feestdagen ----------

/** Paaszondag volgens het (anonieme) Gregoriaanse algoritme. */
export function paaszondag(jaar: number): Datum {
  const a = jaar % 19;
  const b = Math.floor(jaar / 100);
  const c = jaar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jaar}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
}

/** Officiële Nederlandse feestdagen waarop de meeste bedrijven dicht zijn. */
export function feestdagen(jaar: number): Map<Datum, string> {
  const pasen = paaszondag(jaar);
  // Koningsdag: 27 april, of 26 april als 27 april op zondag valt.
  let koningsdag = `${jaar}-04-27`;
  if (weekdagIndex(koningsdag) === 6) koningsdag = `${jaar}-04-26`;
  return new Map<Datum, string>([
    [`${jaar}-01-01`, "Nieuwjaarsdag"],
    [pasen, "Eerste paasdag"],
    [plusDagen(pasen, 1), "Tweede paasdag"],
    [koningsdag, "Koningsdag"],
    [plusDagen(pasen, 39), "Hemelvaartsdag"],
    [plusDagen(pasen, 49), "Eerste pinksterdag"],
    [plusDagen(pasen, 50), "Tweede pinksterdag"],
    [`${jaar}-12-25`, "Eerste kerstdag"],
    [`${jaar}-12-26`, "Tweede kerstdag"],
  ]);
}

export function feestdagNaam(d: Datum): string | undefined {
  return feestdagen(Number(d.slice(0, 4))).get(d);
}
