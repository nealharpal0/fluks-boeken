/**
 * Beschikbaarheid: welke starttijden kan een klant kiezen?
 *
 * Dit is pure logica zonder database, zodat hij makkelijk te testen is.
 * De database bewaakt daarnaast met één atomische query dat er nooit een
 * dubbele boeking ontstaat (zie src/db/afspraken.ts); beide gebruiken
 * dezelfde regels:
 *
 *  - een afspraak bezet [start, eind + buffer);
 *  - er mogen nooit meer dan `capaciteit` afspraken tegelijk lopen;
 *  - een afspraak (inclusief buffer) mag niet overlappen met een blokkade;
 *  - de afspraak zelf (zonder buffer) moet binnen één openingsvenster vallen
 *    (dus niet over een pauze of sluitingstijd heen).
 */
import type { Behandeling, KlantConfig, Tijdvakken, Weekdag } from "../config/schema";
import { WEEKDAGEN } from "../config/schema";
import {
  type Datum,
  type Moment,
  datumVan,
  feestdagNaam,
  maakMoment,
  minutenVan,
  naarMinuten,
  plusDagen,
  plusMinuten,
  plusUren,
  vanMinuten,
  weekdagIndex,
} from "./tijd";

/** Een tijdvak binnen een dag in minuten: [van, tot). */
export type Vak = [number, number];

export interface BezetteTijd {
  id?: number;
  start: Moment;
  bezetTot: Moment;
}

export interface BlokkadeTijd {
  start: Moment;
  eind: Moment;
}

export function parseTijdvakken(t: Tijdvakken | undefined): Vak[] {
  if (t === null || t === undefined) return [];
  const lijst = Array.isArray(t) ? t : [t];
  return lijst
    .map((s): Vak => {
      const [van, tot] = s.split("-").map((x) => x.trim());
      if (!van || !tot) throw new Error(`Ongeldig tijdvak "${s}" (verwacht "UU:MM-UU:MM")`);
      return [naarMinuten(van), naarMinuten(tot)];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** Haalt `eraf` uit alle vakken. */
export function trekAf(vakken: Vak[], eraf: Vak): Vak[] {
  const uit: Vak[] = [];
  for (const [van, tot] of vakken) {
    if (eraf[1] <= van || eraf[0] >= tot) {
      uit.push([van, tot]);
      continue;
    }
    if (eraf[0] > van) uit.push([van, eraf[0]]);
    if (eraf[1] < tot) uit.push([eraf[1], tot]);
  }
  return uit;
}

export function pauzesOp(config: KlantConfig, dag: Weekdag): Vak[] {
  const p = config.pauzes;
  if (!p) return [];
  if (Array.isArray(p)) return parseTijdvakken(p);
  return parseTijdvakken(p[dag] ?? []);
}

export interface DagOpening {
  vakken: Vak[];
  /** Waarom de dag dicht is (bijv. "Eerste kerstdag"), als dat zo is. */
  geslotenReden?: string;
}

/** De openingsvensters op een datum, na aftrek van pauzes en met feestdagen/uitzonderingen. */
export function openingOp(config: KlantConfig, datum: Datum): DagOpening {
  const dag = WEEKDAGEN[weekdagIndex(datum)]!;
  const uitzondering = config.uitzonderingen?.[datum];
  let vakken: Vak[];
  if (uitzondering !== undefined) {
    vakken = parseTijdvakken(uitzondering);
    if (vakken.length === 0) return { vakken: [], geslotenReden: "Gesloten" };
  } else {
    if (config.feestdagenGesloten !== false) {
      const feestdag = feestdagNaam(datum);
      if (feestdag) return { vakken: [], geslotenReden: feestdag };
    }
    vakken = parseTijdvakken(config.openingstijden[dag]);
  }
  for (const pauze of pauzesOp(config, dag)) vakken = trekAf(vakken, pauze);
  vakken = vakken.filter(([van, tot]) => tot > van);
  return vakken.length ? { vakken } : { vakken: [], geslotenReden: "Gesloten" };
}

/**
 * Het hoogste aantal afspraken dat ergens binnen [start, bezetTot) tegelijk loopt.
 * Het maximum ligt altijd op het begin van het interval of op de start van een
 * afspraak binnen het interval; precies die punten controleren we.
 */
export function maxGelijktijdig(afspraken: BezetteTijd[], start: Moment, bezetTot: Moment, negeerId?: number): number {
  const relevant = afspraken.filter(
    (a) => a.id === undefined || a.id !== negeerId,
  ).filter((a) => a.start < bezetTot && a.bezetTot > start);
  const punten = [start, ...relevant.map((a) => a.start).filter((s) => s > start)];
  let max = 0;
  for (const p of punten) {
    const n = relevant.filter((a) => a.start <= p && a.bezetTot > p).length;
    if (n > max) max = n;
  }
  return max;
}

export function overlaptBlokkade(blokkades: BlokkadeTijd[], start: Moment, bezetTot: Moment): boolean {
  return blokkades.some((b) => b.start < bezetTot && b.eind > start);
}

export interface SlotInvoer {
  config: KlantConfig;
  behandeling: Pick<Behandeling, "duurMinuten">;
  datum: Datum;
  /** Huidige lokale tijd. */
  nu: Moment;
  /** Actieve afspraken (aangevraagd/bevestigd/afgerond) rond deze datum. */
  afspraken: BezetteTijd[];
  blokkades: BlokkadeTijd[];
  /** Afspraak die genegeerd wordt (bij verzetten van die afspraak zelf). */
  negeerId?: number;
  /** Voor het beheer: minimale/maximale boekingstermijn niet toepassen. */
  zonderTermijnen?: boolean;
}

export function eindVan(start: Moment, duurMinuten: number): Moment {
  return plusMinuten(start, duurMinuten);
}

export function bezetTotVan(start: Moment, duurMinuten: number, bufferMinuten: number): Moment {
  return plusMinuten(start, duurMinuten + bufferMinuten);
}

/** Valt de datum binnen de periode waarin klanten online mogen boeken? */
export function binnenBoekingstermijn(config: KlantConfig, datum: Datum, nu: Moment): boolean {
  const vandaag = datumVan(nu);
  return datum >= vandaag && datum <= plusDagen(vandaag, config.planning.maximaalDagenVooruit);
}

/** Alle vrije starttijden ("UU:MM") op een datum voor een behandeling. */
export function vrijeTijdsloten(invoer: SlotInvoer): string[] {
  const { config, behandeling, datum, nu, afspraken, blokkades, negeerId } = invoer;
  const { tijdslotMinuten, bufferMinuten, capaciteit, minimaalUrenVooraf } = config.planning;
  const duur = behandeling.duurMinuten;

  if (!invoer.zonderTermijnen && !binnenBoekingstermijn(config, datum, nu)) return [];
  const vroegste = invoer.zonderTermijnen ? nu : plusUren(nu, minimaalUrenVooraf);

  const { vakken } = openingOp(config, datum);
  const dagBegin = maakMoment(datum, 0);
  const dagEinde = maakMoment(datum, 1440 + bufferMinuten);
  const dagAfspraken = afspraken.filter((a) => a.start < dagEinde && a.bezetTot > dagBegin);

  const kandidaten = new Set<number>();
  for (const [van, tot] of vakken) {
    for (let t = van; t + duur <= tot; t += tijdslotMinuten) kandidaten.add(t);
    // Ook direct aansluitend op een afspraak of blokkade beginnen, zodat de dag niet versnippert.
    const eindes = [...dagAfspraken.map((a) => a.bezetTot), ...blokkades.map((b) => b.eind)];
    for (const e of eindes) {
      if (datumVan(e) !== datum) continue;
      const t = minutenVan(e);
      if (t >= van && t + duur <= tot) kandidaten.add(t);
    }
  }

  const vrij: string[] = [];
  for (const t of [...kandidaten].sort((a, b) => a - b)) {
    const start = maakMoment(datum, t);
    if (start < vroegste) continue;
    const bezetTot = bezetTotVan(start, duur, bufferMinuten);
    if (overlaptBlokkade(blokkades, start, bezetTot)) continue;
    if (maxGelijktijdig(dagAfspraken, start, bezetTot, negeerId) >= capaciteit) continue;
    vrij.push(vanMinuten(t));
  }
  return vrij;
}

/** Is precies deze starttijd nog vrij? */
export function isSlotVrij(invoer: SlotInvoer, tijd: string): boolean {
  return vrijeTijdsloten(invoer).includes(tijd);
}

export interface DagOverzicht {
  datum: Datum;
  aantalVrij: number;
  geslotenReden?: string;
}

/** Overzicht van meerdere dagen, voor de datumkiezer. */
export function dagenOverzicht(
  invoer: Omit<SlotInvoer, "datum">,
  vanaf: Datum,
  aantalDagen: number,
): DagOverzicht[] {
  const uit: DagOverzicht[] = [];
  for (let i = 0; i < aantalDagen; i++) {
    const datum = plusDagen(vanaf, i);
    const opening = openingOp(invoer.config, datum);
    const aantalVrij = opening.vakken.length ? vrijeTijdsloten({ ...invoer, datum }).length : 0;
    uit.push({ datum, aantalVrij, geslotenReden: opening.geslotenReden });
  }
  return uit;
}

/** Past een behandeling überhaupt in een openingsvenster? (voor configcontrole) */
export function langsteVenster(config: KlantConfig): number {
  let max = 0;
  // Controleer één willekeurige week zonder feestdagen-afhankelijkheid.
  for (const dag of WEEKDAGEN) {
    let vakken = parseTijdvakken(config.openingstijden[dag]);
    for (const p of pauzesOp(config, dag)) vakken = trekAf(vakken, p);
    for (const [van, tot] of vakken) max = Math.max(max, tot - van);
  }
  return max;
}
