/**
 * Bedrijfslogica: boeken, accepteren, weigeren, verzetten, annuleren, klaar
 * melden. Route-handlers roepen deze functies aan; ze versturen ook de
 * bijbehorende e-mails (op de achtergrond).
 */
import type { App } from "./app";
import { verstuurBericht } from "./berichten/dienst";
import type { BerichtInhoud } from "./berichten/opmaak";
import * as sjabloon from "./berichten/sjablonen";
import type { BerichtSoort, Behandeling } from "./config/schema";
import { isGeldigEmail } from "./config/valideer";
import {
  accepteerAfspraak,
  alsBlokkadeTijden,
  bezetteTijden,
  blokkadesIn,
  haalAfspraak,
  maakAfspraak,
  type NieuweAfspraak,
  verzetAfspraak,
  wijzigStatus,
} from "./db/afspraken";
import { bewaarFoto, heffAfmeldingOp, herkenAfbeelding, MAX_FOTO_BYTES } from "./db/overig";
import { bezetTotVan, eindVan, isSlotVrij } from "./lib/beschikbaarheid";
import {
  type Datum,
  datumVan,
  isGeldigeDatum,
  isGeldigeTijd,
  maakMoment,
  minutenTussen,
  type Moment,
  naarMinuten,
  plusDagen,
  plusUren,
} from "./lib/tijd";
import type { Afspraak } from "./types";

export function sjabloonContext(app: App): sjabloon.SjabloonContext {
  return { config: app.config, basisUrl: app.config.basisUrl };
}

export function vindBehandeling(app: App, id: string, ookInactief = false): Behandeling | undefined {
  return app.config.behandelingen.find((b) => b.id === id && (ookInactief || b.actief !== false));
}

/** Verstuurt een e-mail aan de klant of beheerder op de achtergrond. */
function stuur(
  app: App,
  soort: BerichtSoort,
  sleutel: string,
  afspraak: Afspraak | null,
  aan: string,
  inhoud: BerichtInhoud,
  afmeldUrl?: string,
): void {
  if (!aan) return;
  app.achtergrond.push(
    verstuurBericht(app, { sleutel, soort, afspraakId: afspraak?.id ?? null, aan, inhoud, afmeldUrl }).catch((e) =>
      console.error(`Bericht ${sleutel} kon niet worden verwerkt:`, e),
    ),
  );
}

// ---------------------------------------------------------------------------
// Boeken door een klant
// ---------------------------------------------------------------------------

export interface BoekInvoer {
  behandelingId: string;
  datum: string;
  tijd: string;
  naam: string;
  email: string;
  telefoon: string;
  opmerking: string;
  extraVelden: Record<string, string>;
  toestemmingHerinnering: boolean;
  toestemmingReview: boolean;
  toestemmingOnderhoud: boolean;
  fotos: File[];
  /** Honeypot-veld; mensen laten dit leeg. */
  valstrik?: string;
}

export type Fouten = Record<string, string>;

export type BoekUitkomst =
  | { ok: true; afspraak: Afspraak }
  | { ok: false; fouten: Fouten; slotBezet?: boolean };

const TELEFOON_RE = /^[+()\d][\d\s()+-]{5,19}$/;

export function schoon(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/** Controleert de invoer van het boekingsformulier. Geeft per veld een foutmelding. */
export function controleerBoeking(app: App, invoer: BoekInvoer): Fouten {
  const f: Fouten = {};
  const cfg = app.config.formulier;
  if (!vindBehandeling(app, invoer.behandelingId)) f.behandeling = "Kies een behandeling.";
  if (!isGeldigeDatum(invoer.datum) || !isGeldigeTijd(invoer.tijd)) f.tijd = "Kies een datum en tijd.";
  if (invoer.naam.length < 2) f.naam = "Vul je naam in.";
  if (!isGeldigEmail(invoer.email)) f.email = "Vul een geldig e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.";
  if (invoer.telefoon && !TELEFOON_RE.test(invoer.telefoon)) f.telefoon = "Vul een geldig telefoonnummer in.";
  else if (cfg.telefoonVerplicht && !invoer.telefoon) f.telefoon = "Vul je telefoonnummer in.";
  for (const v of cfg.extraVelden ?? []) {
    if (v.verplicht && !invoer.extraVelden[v.id]) f[`extra_${v.id}`] = `Vul “${v.label}” in.`;
  }
  const fotos = invoer.fotos.filter((x) => x.size > 0);
  if (fotos.length) {
    if (!cfg.fotos.aan) f.fotos = "Foto's uploaden is niet mogelijk.";
    else if (fotos.length > cfg.fotos.maxAantal) f.fotos = `Je kunt maximaal ${cfg.fotos.maxAantal} foto's meesturen.`;
    else if (fotos.some((x) => x.size > MAX_FOTO_BYTES)) f.fotos = "Een van de foto's is te groot (maximaal 1,9 MB per foto).";
  }
  return f;
}

/** Leest de foto's en controleert of het echt afbeeldingen zijn. */
async function leesFotos(bestanden: File[]): Promise<{ mime: string; data: Uint8Array }[] | null> {
  const uit: { mime: string; data: Uint8Array }[] = [];
  for (const b of bestanden.filter((x) => x.size > 0)) {
    const data = new Uint8Array(await b.arrayBuffer());
    const mime = herkenAfbeelding(data);
    if (!mime || data.byteLength > MAX_FOTO_BYTES) return null;
    uit.push({ mime, data });
  }
  return uit;
}

/** Bezette tijden en blokkades rond een datum (voor de beschikbaarheidscontrole). */
export async function planningRond(app: App, van: Datum, totEnMet: Datum) {
  const begin = maakMoment(plusDagen(van, -1), 0);
  const eind = maakMoment(plusDagen(totEnMet, 2), 0);
  const [afspraken, blokkades] = await Promise.all([bezetteTijden(app.db, begin, eind), blokkadesIn(app.db, begin, eind)]);
  return { afspraken, blokkades: alsBlokkadeTijden(blokkades) };
}

export async function boekAfspraak(app: App, invoer: BoekInvoer): Promise<BoekUitkomst> {
  if (invoer.valstrik) return { ok: false, fouten: { algemeen: "Je aanvraag kon niet worden verwerkt." } };
  const fouten = controleerBoeking(app, invoer);
  if (Object.keys(fouten).length) return { ok: false, fouten };

  const behandeling = vindBehandeling(app, invoer.behandelingId)!;
  const fotos = await leesFotos(invoer.fotos);
  if (!fotos) return { ok: false, fouten: { fotos: "Upload alleen foto's (JPG, PNG of WebP) van maximaal 1,9 MB." } };

  // 1. Valt het slot binnen openingstijden, boekingstermijn en is het (nu) vrij?
  const nu = app.nu();
  const planning = await planningRond(app, invoer.datum, invoer.datum);
  const vrij = isSlotVrij({ config: app.config, behandeling, datum: invoer.datum, nu, ...planning }, invoer.tijd);
  if (!vrij) {
    return { ok: false, slotBezet: true, fouten: { tijd: "Dit tijdstip is helaas niet (meer) beschikbaar. Kies een ander moment." } };
  }

  // 2. Atomisch opslaan: de database weigert als iemand ons net voor was.
  const start = maakMoment(invoer.datum, naarMinuten(invoer.tijd));
  const automatisch = app.config.planning.automatischBevestigen;
  const nieuw: NieuweAfspraak = {
    behandelingId: behandeling.id,
    behandelingNaam: behandeling.naam,
    start,
    eind: eindVan(start, behandeling.duurMinuten),
    bezetTot: bezetTotVan(start, behandeling.duurMinuten, app.config.planning.bufferMinuten),
    status: automatisch ? "bevestigd" : "aangevraagd",
    bevestigdOp: automatisch ? nu : null,
    naam: invoer.naam,
    email: invoer.email.toLowerCase(),
    telefoon: invoer.telefoon,
    opmerking: invoer.opmerking,
    extraVelden: invoer.extraVelden,
    toestemmingHerinnering: invoer.toestemmingHerinnering && app.config.berichten.herinnering.aan,
    toestemmingReview: invoer.toestemmingReview && app.config.berichten.review.aan,
    toestemmingOnderhoud: invoer.toestemmingOnderhoud && app.config.berichten.onderhoud.aan,
    bron: "online",
  };
  const afspraak = await maakAfspraak(app.db, nieuw, app.config.planning.capaciteit);
  if (!afspraak) {
    return { ok: false, slotBezet: true, fouten: { tijd: "Iemand was je net voor: dit tijdstip is zojuist geboekt. Kies een ander moment." } };
  }

  for (const foto of fotos) {
    try {
      await bewaarFoto(app.db, afspraak.id, foto.mime, foto.data);
    } catch (e) {
      console.error("Foto opslaan mislukt:", e);
    }
  }
  if (nieuw.toestemmingHerinnering || nieuw.toestemmingReview || nieuw.toestemmingOnderhoud) {
    await heffAfmeldingOp(app.db, afspraak.email);
  }

  const ctx = sjabloonContext(app);
  if (afspraak.status === "bevestigd") {
    stuur(app, "bevestiging", `bevestiging:${afspraak.id}`, afspraak, afspraak.email, sjabloon.bevestiging(ctx, afspraak));
  } else {
    stuur(app, "aanvraag_ontvangen", `aanvraag_ontvangen:${afspraak.id}`, afspraak, afspraak.email, sjabloon.aanvraagOntvangen(ctx, afspraak));
  }
  if (app.config.berichten.meldingNieuweAanvraag) {
    stuur(app, "nieuwe_aanvraag", `nieuwe_aanvraag:${afspraak.id}`, afspraak, app.config.email.beheerderAdres, sjabloon.nieuweAanvraag(ctx, afspraak, fotos.length));
  }
  return { ok: true, afspraak };
}

// ---------------------------------------------------------------------------
// Beheer
// ---------------------------------------------------------------------------

export type ActieUitkomst = { ok: true; afspraak: Afspraak; melding: string } | { ok: false; fout: string };

const FOUT_NIET_GEVONDEN = "Deze afspraak bestaat niet (meer).";

export async function accepteer(app: App, id: number): Promise<ActieUitkomst> {
  const r = await accepteerAfspraak(app.db, id, app.config.planning.capaciteit, app.nu());
  if (!r.ok) {
    if (r.reden === "niet_gevonden") return { ok: false, fout: FOUT_NIET_GEVONDEN };
    if (r.reden === "status") return { ok: false, fout: "Deze aanvraag is al verwerkt." };
    return { ok: false, fout: "Accepteren kan niet: op dit tijdstip is geen plek meer (overlap met een andere afspraak of blokkade). Verzet of weiger de aanvraag." };
  }
  const a = r.afspraak;
  stuur(app, "bevestiging", `bevestiging:${a.id}`, a, a.email, sjabloon.bevestiging(sjabloonContext(app), a));
  return { ok: true, afspraak: a, melding: `Afspraak van ${a.naam} is bevestigd${a.email ? " en de klant krijgt een bevestiging" : ""}.` };
}

export async function weiger(app: App, id: number, reden: string): Promise<ActieUitkomst> {
  const a = await wijzigStatus(app.db, id, ["aangevraagd"], "geweigerd", { reden: schoon(reden, 500) });
  if (!a) return (await haalAfspraak(app.db, id)) ? { ok: false, fout: "Deze aanvraag is al verwerkt." } : { ok: false, fout: FOUT_NIET_GEVONDEN };
  stuur(app, "afwijzing", `afwijzing:${a.id}`, a, a.email, sjabloon.afwijzing(sjabloonContext(app), a));
  return { ok: true, afspraak: a, melding: `Aanvraag van ${a.naam} is geweigerd.` };
}

export async function annuleerDoorBedrijf(app: App, id: number, reden: string): Promise<ActieUitkomst> {
  const a = await wijzigStatus(app.db, id, ["aangevraagd", "bevestigd"], "geannuleerd", { reden: schoon(reden, 500) });
  if (!a) return { ok: false, fout: "Deze afspraak kan niet (meer) geannuleerd worden." };
  if (a.start > app.nu()) {
    stuur(app, "geannuleerd", `geannuleerd:${a.id}`, a, a.email, sjabloon.geannuleerd(sjabloonContext(app), a, false));
  }
  return { ok: true, afspraak: a, melding: `Afspraak van ${a.naam} is geannuleerd.` };
}

/** Mag de klant deze afspraak nog zelf annuleren? */
export function magKlantAnnuleren(app: App, a: Afspraak): boolean {
  const uren = app.config.planning.annulerenTotUrenVooraf;
  if (uren <= 0 || (a.status !== "aangevraagd" && a.status !== "bevestigd")) return false;
  return plusUren(app.nu(), uren) <= a.start;
}

export async function annuleerDoorKlant(app: App, a: Afspraak): Promise<ActieUitkomst> {
  if (!magKlantAnnuleren(app, a)) return { ok: false, fout: "Online annuleren is niet meer mogelijk. Neem contact met ons op." };
  const nieuw = await wijzigStatus(app.db, a.id, ["aangevraagd", "bevestigd"], "geannuleerd", { reden: "Geannuleerd door klant" });
  if (!nieuw) return { ok: false, fout: "Deze afspraak kan niet (meer) geannuleerd worden." };
  const ctx = sjabloonContext(app);
  stuur(app, "geannuleerd", `geannuleerd:${nieuw.id}`, nieuw, nieuw.email, sjabloon.geannuleerd(ctx, nieuw, true));
  stuur(app, "klant_annulering", `klant_annulering:${nieuw.id}`, nieuw, app.config.email.beheerderAdres, sjabloon.klantAnnulering(ctx, nieuw));
  return { ok: true, afspraak: nieuw, melding: "Je afspraak is geannuleerd." };
}

export async function meldKlaar(app: App, id: number): Promise<ActieUitkomst> {
  const a = await wijzigStatus(app.db, id, ["bevestigd"], "afgerond", { klaarOp: app.nu() });
  if (!a) return { ok: false, fout: "Alleen bevestigde afspraken kunnen op klaar worden gezet." };
  if (app.config.berichten.klaar.aan) {
    stuur(app, "klaar", `klaar:${a.id}`, a, a.email, sjabloon.klaar(sjabloonContext(app), a));
  }
  return { ok: true, afspraak: a, melding: `${a.naam} is afgerond${app.config.berichten.klaar.aan && a.email ? " en krijgt bericht dat het klaar is" : ""}.` };
}

export async function markeerNietVerschenen(app: App, id: number): Promise<ActieUitkomst> {
  const a = await wijzigStatus(app.db, id, ["bevestigd"], "niet_verschenen");
  if (!a) return { ok: false, fout: "Alleen bevestigde afspraken kunnen als 'niet verschenen' worden gemarkeerd." };
  return { ok: true, afspraak: a, melding: `${a.naam} is gemarkeerd als niet verschenen.` };
}

/** Verzet een afspraak (door het beheer). Openingstijden gelden niet, dubbele boekingen blijven onmogelijk. */
export async function verzet(app: App, id: number, datum: string, tijd: string): Promise<ActieUitkomst> {
  if (!isGeldigeDatum(datum) || !isGeldigeTijd(tijd)) return { ok: false, fout: "Kies een geldige datum en tijd." };
  const huidig = await haalAfspraak(app.db, id);
  if (!huidig) return { ok: false, fout: FOUT_NIET_GEVONDEN };
  const start: Moment = maakMoment(datum, naarMinuten(tijd));
  if (start === huidig.start) return { ok: false, fout: "Dit is al het tijdstip van de afspraak." };
  const duur = minutenTussen(huidig.start, huidig.eind);
  const r = await verzetAfspraak(
    app.db,
    id,
    { start, eind: eindVan(start, duur), bezetTot: bezetTotVan(start, duur, app.config.planning.bufferMinuten) },
    app.config.planning.capaciteit,
  );
  if (!r.ok) {
    if (r.reden === "status") return { ok: false, fout: "Alleen aanvragen en bevestigde afspraken kunnen verzet worden." };
    if (r.reden === "niet_gevonden") return { ok: false, fout: FOUT_NIET_GEVONDEN };
    return { ok: false, fout: "Op dat tijdstip is geen plek: het overlapt met een andere afspraak of blokkade." };
  }
  const a = r.afspraak;
  stuur(app, "verzet", `verzet:${a.id}:${a.start}`, a, a.email, sjabloon.verzet(sjabloonContext(app), a, huidig.start));
  return { ok: true, afspraak: a, melding: `Afspraak van ${a.naam} is verzet${a.email ? "; de klant krijgt bericht" : ""}.` };
}

export interface BeheerAfspraakInvoer {
  behandelingId: string;
  datum: string;
  tijd: string;
  naam: string;
  email: string;
  telefoon: string;
  notitie: string;
  stuurBevestiging: boolean;
}

/** Afspraak invoeren vanuit het beheer (bijv. telefonisch gemaakt). Direct bevestigd. */
export async function maakAfspraakDoorBeheer(app: App, i: BeheerAfspraakInvoer): Promise<ActieUitkomst> {
  const behandeling = vindBehandeling(app, i.behandelingId, true);
  if (!behandeling) return { ok: false, fout: "Kies een behandeling." };
  if (!isGeldigeDatum(i.datum) || !isGeldigeTijd(i.tijd)) return { ok: false, fout: "Kies een geldige datum en tijd." };
  if (i.naam.length < 2) return { ok: false, fout: "Vul de naam van de klant in." };
  if (i.email && !isGeldigEmail(i.email)) return { ok: false, fout: "Het e-mailadres is ongeldig." };
  const start = maakMoment(i.datum, naarMinuten(i.tijd));
  const a = await maakAfspraak(
    app.db,
    {
      behandelingId: behandeling.id,
      behandelingNaam: behandeling.naam,
      start,
      eind: eindVan(start, behandeling.duurMinuten),
      bezetTot: bezetTotVan(start, behandeling.duurMinuten, app.config.planning.bufferMinuten),
      status: "bevestigd",
      bevestigdOp: app.nu(),
      naam: i.naam,
      email: i.email.toLowerCase(),
      telefoon: i.telefoon,
      opmerking: "",
      extraVelden: {},
      toestemmingHerinnering: false,
      toestemmingReview: false,
      toestemmingOnderhoud: false,
      bron: "beheer",
      interneNotitie: i.notitie,
    },
    app.config.planning.capaciteit,
  );
  if (!a) return { ok: false, fout: "Op dat tijdstip is geen plek: het overlapt met een andere afspraak of blokkade." };
  if (i.stuurBevestiging && a.email) {
    stuur(app, "bevestiging", `bevestiging:${a.id}`, a, a.email, sjabloon.bevestiging(sjabloonContext(app), a));
  }
  return { ok: true, afspraak: a, melding: `Afspraak voor ${a.naam} is ingepland.` };
}

/** Testmail naar de beheerder. Geeft direct de uitkomst (niet op de achtergrond). */
export async function stuurTestmail(app: App): Promise<string> {
  const uitkomst = await verstuurBericht(app, {
    sleutel: `test:${crypto.randomUUID()}`,
    soort: "test",
    afspraakId: null,
    aan: app.config.email.beheerderAdres,
    inhoud: sjabloon.testBericht(sjabloonContext(app)),
  });
  await app.verzender.sluit();
  return uitkomst;
}

export function vandaag(app: App): Datum {
  return datumVan(app.nu());
}
