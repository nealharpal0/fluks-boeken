/**
 * Nederlandse e-mailsjablonen. Elk sjabloon geeft onderwerp + HTML + tekst.
 * Onderwerp en hoofdtekst zijn per klant aan te passen via
 * `berichten.teksten.<soort>` in het configbestand.
 */
import type { BerichtSoort, KlantConfig, Seizoensherinnering } from "../config/schema";
import { extraVeldenVan } from "../db/afspraken";
import { datumVan, formatDatumLang, formatDuur, minutenTussen, plusDagen, tijdVan } from "../lib/tijd";
import type { Afspraak } from "../types";
import { type BerichtInhoud, type Blok, alineas, maakBericht } from "./opmaak";

export interface SjabloonContext {
  config: KlantConfig;
  basisUrl: string;
}

export function voornaam(naam: string): string {
  return naam.trim().split(/\s+/)[0] ?? naam;
}

/** Vervangt {sleutel} door de waarde; onbekende plaatshouders blijven staan. */
export function vulIn(tekst: string, waarden: Record<string, string>): string {
  return tekst.replace(/\{([a-z0-9_-]+)\}/gi, (heel, sleutel: string) => waarden[sleutel] ?? heel);
}

export function prijsTekst(bedrag: number): string {
  const heel = Number.isInteger(bedrag);
  return `€ ${heel ? bedrag : bedrag.toFixed(2).replace(".", ",")}`;
}

export const links = {
  afspraak: (ctx: SjabloonContext, a: Afspraak) => `${ctx.basisUrl}/afspraak/${a.token}`,
  agenda: (ctx: SjabloonContext, a: Afspraak) => `${ctx.basisUrl}/afspraak/${a.token}/agenda.ics`,
  review: (ctx: SjabloonContext, a: Afspraak) => `${ctx.basisUrl}/r/${a.token}`,
  afmelden: (ctx: SjabloonContext, a: Afspraak) => `${ctx.basisUrl}/afmelden/${a.token}`,
  boeken: (ctx: SjabloonContext, behandelingId?: string) =>
    behandelingId ? `${ctx.basisUrl}/boeken/${encodeURIComponent(behandelingId)}` : `${ctx.basisUrl}/`,
  beheer: (ctx: SjabloonContext, a: Afspraak) => `${ctx.basisUrl}/beheer/afspraak/${a.id}`,
  route: (ctx: SjabloonContext) => {
    const a = ctx.config.bedrijf.adres;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.straat}, ${a.postcode} ${a.plaats}`)}`;
  },
};

function waarden(ctx: SjabloonContext, a?: Afspraak): Record<string, string> {
  const basis: Record<string, string> = { bedrijf: ctx.config.bedrijf.naam };
  if (!a) return basis;
  return {
    ...extraVeldenVan(a),
    ...basis,
    voornaam: voornaam(a.naam),
    naam: a.naam,
    behandeling: a.behandeling_naam.toLowerCase(),
    Behandeling: a.behandeling_naam,
    datum: formatDatumLang(datumVan(a.start)),
    tijd: tijdVan(a.start),
  };
}

function aanpassing(ctx: SjabloonContext, soort: BerichtSoort) {
  return ctx.config.berichten.teksten?.[soort];
}

/** Onderwerp en intro-alinea's, met eventuele eigen tekst uit de config. */
function kern(
  ctx: SjabloonContext,
  soort: BerichtSoort,
  a: Afspraak | undefined,
  standaard: { onderwerp: string; tekst: string },
): { onderwerp: string; intro: Blok[] } {
  const eigen = aanpassing(ctx, soort);
  const w = waarden(ctx, a);
  return {
    onderwerp: vulIn(eigen?.onderwerp ?? standaard.onderwerp, w),
    intro: alineas(vulIn(eigen?.tekst ?? standaard.tekst, w)),
  };
}

function adresRegel(ctx: SjabloonContext): string {
  const a = ctx.config.bedrijf.adres;
  return `${a.straat}\n${a.postcode} ${a.plaats}`;
}

function afspraakGegevens(ctx: SjabloonContext, a: Afspraak, opties: { metAdres?: boolean } = {}): Blok {
  const behandeling = ctx.config.behandelingen.find((b) => b.id === a.behandeling_id);
  const rijen: [string, string][] = [
    ["Behandeling", a.behandeling_naam],
    ["Datum", formatDatumLang(datumVan(a.start))],
    ["Tijd", `${tijdVan(a.start)} – ${tijdVan(a.eind)} (ca. ${formatDuur(minutenTussen(a.start, a.eind))})`],
  ];
  if (behandeling?.vanafPrijs !== undefined) rijen.push(["Prijs", `vanaf ${prijsTekst(behandeling.vanafPrijs)}`]);
  if (opties.metAdres !== false) rijen.push(["Adres", adresRegel(ctx)]);
  return { soort: "gegevens", rijen };
}

const TRANSACTIONEEL =
  "Je ontvangt deze e-mail omdat je een afspraak hebt gemaakt. Vragen of iets wijzigen? Beantwoord deze e-mail of bel ons.";

function maak(ctx: SjabloonContext, onderwerp: string, titel: string, blokken: Blok[], extra: { afmeldUrl?: string; voetnoot?: string } = {}): BerichtInhoud {
  return maakBericht(ctx.config, ctx.basisUrl, onderwerp, { titel, blokken, voetnoot: extra.voetnoot ?? TRANSACTIONEEL, afmeldUrl: extra.afmeldUrl });
}

// ---------------------------------------------------------------------------

export function aanvraagOntvangen(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "aanvraag_ontvangen", a, {
    onderwerp: "We hebben je aanvraag ontvangen",
    tekst:
      "Hoi {voornaam},\n\nBedankt voor je aanvraag bij {bedrijf}! We bekijken hem zo snel mogelijk. Zodra je afspraak vaststaat, krijg je van ons een bevestiging per e-mail.\n\nLet op: tot die tijd is de afspraak nog niet definitief.",
  });
  return maak(ctx, onderwerp, "Aanvraag ontvangen", [
    ...intro,
    afspraakGegevens(ctx, a),
    { soort: "knop", tekst: "Bekijk je aanvraag", url: links.afspraak(ctx, a) },
  ]);
}

export function bevestiging(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "bevestiging", a, {
    onderwerp: "Bevestigd: {Behandeling} op {datum} om {tijd}",
    tekst: "Hoi {voornaam},\n\nGoed nieuws: je afspraak is bevestigd! We zien je graag op {datum} om {tijd}.",
  });
  const annuleren = ctx.config.planning.annulerenTotUrenVooraf;
  return maak(ctx, onderwerp, "Je afspraak is bevestigd", [
    ...intro,
    afspraakGegevens(ctx, a),
    { soort: "knop", tekst: "Zet in je agenda", url: links.agenda(ctx, a) },
    { soort: "link", tekst: "Routebeschrijving", url: links.route(ctx) },
    {
      soort: "klein",
      tekst:
        annuleren > 0
          ? `Verhinderd? Annuleer dan uiterlijk ${annuleren} uur van tevoren via je afspraakpagina: ${links.afspraak(ctx, a)}`
          : "Verhinderd? Laat het ons dan zo snel mogelijk weten.",
    },
  ]);
}

export function afwijzing(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "afwijzing", a, {
    onderwerp: "Je aanvraag voor {datum} kunnen we helaas niet inplannen",
    tekst:
      "Hoi {voornaam},\n\nBedankt voor je aanvraag voor {behandeling} op {datum} om {tijd}. Helaas kunnen we deze afspraak niet inplannen.",
  });
  const blokken: Blok[] = [...intro];
  if (a.reden.trim()) blokken.push({ soort: "gegevens", rijen: [["Toelichting", a.reden.trim()]] });
  blokken.push(
    { soort: "alinea", tekst: "Kies gerust een ander moment dat je uitkomt; we helpen je graag." },
    { soort: "knop", tekst: "Kies een ander moment", url: links.boeken(ctx, a.behandeling_id) },
  );
  return maak(ctx, onderwerp, "Je aanvraag is niet ingepland", blokken);
}

export function verzet(ctx: SjabloonContext, a: Afspraak, oudeStart: string): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "verzet", a, {
    onderwerp: "Je afspraak is verzet naar {datum} om {tijd}",
    tekst: "Hoi {voornaam},\n\nJe afspraak is verzet. Hieronder staat het nieuwe tijdstip.",
  });
  return maak(ctx, onderwerp, "Je afspraak is verzet", [
    ...intro,
    afspraakGegevens(ctx, a),
    { soort: "klein", tekst: `Oorspronkelijk tijdstip: ${formatDatumLang(datumVan(oudeStart))} om ${tijdVan(oudeStart)}.` },
    { soort: "knop", tekst: "Zet in je agenda", url: links.agenda(ctx, a) },
    { soort: "link", tekst: "Bekijk je afspraak", url: links.afspraak(ctx, a) },
  ]);
}

export function geannuleerd(ctx: SjabloonContext, a: Afspraak, doorKlant: boolean): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "geannuleerd", a, {
    onderwerp: "Je afspraak op {datum} is geannuleerd",
    tekst: doorKlant
      ? "Hoi {voornaam},\n\nJe hebt je afspraak voor {behandeling} op {datum} om {tijd} geannuleerd. Jammer dat het niet uitkomt!"
      : "Hoi {voornaam},\n\nHelaas moeten we je afspraak voor {behandeling} op {datum} om {tijd} annuleren. Onze excuses voor het ongemak.",
  });
  const blokken: Blok[] = [...intro];
  if (!doorKlant && a.reden.trim()) blokken.push({ soort: "gegevens", rijen: [["Toelichting", a.reden.trim()]] });
  blokken.push(
    { soort: "alinea", tekst: "Wil je een nieuwe afspraak maken? Dat kan op elk moment online." },
    { soort: "knop", tekst: "Nieuwe afspraak maken", url: links.boeken(ctx, a.behandeling_id) },
  );
  return maak(ctx, onderwerp, "Afspraak geannuleerd", blokken);
}

export function verlopen(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "verlopen", a, {
    onderwerp: "We konden je aanvraag niet op tijd bevestigen",
    tekst:
      "Hoi {voornaam},\n\nHet is ons helaas niet gelukt om je aanvraag voor {behandeling} op {datum} om {tijd} op tijd te bevestigen. Sorry daarvoor!\n\nKies gerust een nieuw moment; we reageren dan zo snel mogelijk.",
  });
  return maak(ctx, onderwerp, "Aanvraag verlopen", [
    ...intro,
    { soort: "knop", tekst: "Kies een nieuw moment", url: links.boeken(ctx, a.behandeling_id) },
  ]);
}

export function herinnering(ctx: SjabloonContext, a: Afspraak, nuDatum: string): BerichtInhoud {
  const dag = datumVan(a.start);
  const wanneer = dag === plusDagen(nuDatum, 1) ? "morgen" : dag === nuDatum ? "vandaag" : `op ${formatDatumLang(dag, false)}`;
  const { onderwerp, intro } = kern(ctx, "herinnering", a, {
    onderwerp: `Herinnering: ${wanneer} om {tijd} {behandeling}`,
    tekst: `Hoi {voornaam},\n\nEven een herinnering: ${wanneer} om {tijd} verwachten we je voor {behandeling}. We kijken ernaar uit!`,
  });
  return maak(
    ctx,
    onderwerp,
    `Tot ${wanneer}!`,
    [
      ...intro,
      afspraakGegevens(ctx, a),
      { soort: "link", tekst: "Routebeschrijving", url: links.route(ctx) },
      { soort: "link", tekst: "Bekijk of annuleer je afspraak", url: links.afspraak(ctx, a) },
    ],
    {
      afmeldUrl: links.afmelden(ctx, a),
      voetnoot: "Je ontvangt deze herinnering omdat je daar bij het boeken toestemming voor gaf.",
    },
  );
}

export function klaar(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "klaar", a, {
    onderwerp: "Je afspraak is klaar",
    tekst: "Hoi {voornaam},\n\nGoed nieuws: we zijn klaar met {behandeling}. Je bent welkom om langs te komen.",
  });
  return maak(ctx, onderwerp, "Klaar!", [
    ...intro,
    { soort: "gegevens", rijen: [["Adres", adresRegel(ctx)], ...(ctx.config.bedrijf.telefoon ? [["Telefoon", ctx.config.bedrijf.telefoon] as [string, string]] : [])] },
    { soort: "link", tekst: "Routebeschrijving", url: links.route(ctx) },
  ]);
}

/** Reviewverzoek. Iedereen krijgt dezelfde link naar het Google-profiel: geen review-gating. */
export function review(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "review", a, {
    onderwerp: "Hoe was je ervaring bij {bedrijf}?",
    tekst:
      "Hoi {voornaam},\n\nBedankt voor je bezoek aan {bedrijf}! Wil je ons helpen door je ervaring te delen in een review op Google? Het kost je maar een minuutje en helpt andere klanten bij hun keuze.\n\nAlles wat je kwijt wilt is welkom – we lezen elke review.",
  });
  return maak(ctx, onderwerp, "Wil je je ervaring delen?", [...intro, { soort: "knop", tekst: "Schrijf een review op Google", url: links.review(ctx, a) }], {
    afmeldUrl: links.afmelden(ctx, a),
    voetnoot: "Je ontvangt deze e-mail omdat je bij het boeken toestemming gaf voor een reviewverzoek. Je krijgt hooguit nog één herinnering.",
  });
}

export function reviewHerinnering(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "review_herinnering", a, {
    onderwerp: "Nog even over je bezoek aan {bedrijf}",
    tekst:
      "Hoi {voornaam},\n\nOnlangs was je bij ons voor {behandeling}. Als je een minuutje hebt, zouden we het erg waarderen als je je ervaring deelt op Google.\n\nDit is de laatste keer dat we het vragen – beloofd.",
  });
  return maak(ctx, onderwerp, "Een minuutje voor een review?", [...intro, { soort: "knop", tekst: "Schrijf een review op Google", url: links.review(ctx, a) }], {
    afmeldUrl: links.afmelden(ctx, a),
    voetnoot: "Je ontvangt deze e-mail omdat je bij het boeken toestemming gaf voor een reviewverzoek. Dit is de enige herinnering.",
  });
}

export function onderhoud(ctx: SjabloonContext, a: Afspraak, weken: number, eigenTekst?: string): BerichtInhoud {
  const { onderwerp, intro } = kern(ctx, "onderhoud", a, {
    onderwerp: "Tijd voor een nieuwe {behandeling}?",
    tekst: `Hoi {voornaam},\n\n${eigenTekst ?? `Het is alweer ${weken} weken geleden dat je bij ons was voor {behandeling}. Is het tijd voor een nieuwe afspraak?`}`,
  });
  return maak(ctx, onderwerp, "Tijd voor onderhoud", [...intro, { soort: "knop", tekst: "Plan je afspraak", url: links.boeken(ctx, a.behandeling_id) }], {
    afmeldUrl: links.afmelden(ctx, a),
    voetnoot: "Je ontvangt deze e-mail omdat je bij het boeken toestemming gaf voor onderhouds- en seizoensherinneringen.",
  });
}

export function seizoen(ctx: SjabloonContext, a: Afspraak, s: Seizoensherinnering): BerichtInhoud {
  const w = waarden(ctx, a);
  return maak(ctx, vulIn(s.onderwerp, w), vulIn(s.onderwerp, w), [...alineas(vulIn(s.tekst, w)), { soort: "knop", tekst: "Maak een afspraak", url: links.boeken(ctx) }], {
    afmeldUrl: links.afmelden(ctx, a),
    voetnoot: "Je ontvangt deze e-mail omdat je bij het boeken toestemming gaf voor onderhouds- en seizoensherinneringen.",
  });
}

// ---------- Berichten aan de beheerder ----------

function klantGegevens(ctx: SjabloonContext, a: Afspraak): Blok {
  const extra = extraVeldenVan(a);
  const rijen: [string, string][] = [
    ["Naam", a.naam],
    ["E-mail", a.email || "–"],
    ["Telefoon", a.telefoon || "–"],
  ];
  for (const v of ctx.config.formulier.extraVelden ?? []) if (extra[v.id]) rijen.push([v.label, extra[v.id]!]);
  if (a.opmerking) rijen.push(["Opmerking", a.opmerking]);
  return { soort: "gegevens", rijen };
}

export function nieuweAanvraag(ctx: SjabloonContext, a: Afspraak, aantalFotos: number): BerichtInhoud {
  const bevestigd = a.status === "bevestigd";
  const w = waarden(ctx, a);
  const onderwerp = vulIn(
    aanpassing(ctx, "nieuwe_aanvraag")?.onderwerp ?? (bevestigd ? "Nieuwe afspraak: {Behandeling} op {datum} om {tijd}" : "Nieuwe aanvraag: {Behandeling} op {datum} om {tijd}"),
    w,
  );
  return maakBericht(ctx.config, ctx.basisUrl, onderwerp, {
    titel: bevestigd ? "Nieuwe afspraak (automatisch bevestigd)" : "Nieuwe aanvraag",
    blokken: [
      { soort: "alinea", tekst: bevestigd ? `${a.naam} heeft online een afspraak gemaakt.` : `${a.naam} wil graag een afspraak maken. Accepteer of weiger de aanvraag met één klik.` },
      afspraakGegevens(ctx, a, { metAdres: false }),
      klantGegevens(ctx, a),
      ...(aantalFotos ? [{ soort: "klein" as const, tekst: `De klant heeft ${aantalFotos} foto${aantalFotos === 1 ? "" : "'s"} meegestuurd.` }] : []),
      { soort: "knop", tekst: bevestigd ? "Bekijk de afspraak" : "Bekijk en accepteer", url: links.beheer(ctx, a) },
    ],
    voetnoot: "Automatische melding van Fluks Boeken.",
  });
}

export function klantAnnulering(ctx: SjabloonContext, a: Afspraak): BerichtInhoud {
  const w = waarden(ctx, a);
  return maakBericht(ctx.config, ctx.basisUrl, vulIn("Geannuleerd door klant: {Behandeling} op {datum} om {tijd}", w), {
    titel: "Afspraak geannuleerd door klant",
    blokken: [
      { soort: "alinea", tekst: `${a.naam} heeft de afspraak online geannuleerd. Het tijdslot is weer vrij.` },
      afspraakGegevens(ctx, a, { metAdres: false }),
      klantGegevens(ctx, a),
      { soort: "knop", tekst: "Bekijk in het beheer", url: links.beheer(ctx, a) },
    ],
    voetnoot: "Automatische melding van Fluks Boeken.",
  });
}

export function testBericht(ctx: SjabloonContext): BerichtInhoud {
  return maakBericht(ctx.config, ctx.basisUrl, `Testbericht van ${ctx.config.bedrijf.naam}`, {
    titel: "Het werkt!",
    blokken: [
      { soort: "alinea", tekst: "Dit is een testbericht vanuit Fluks Boeken. Als je dit leest, zijn de e-mailinstellingen in orde." },
      { soort: "knop", tekst: "Naar de boekingspagina", url: links.boeken(ctx) },
    ],
    voetnoot: "Verstuurd via de knop 'Testmail' in het beheer.",
  });
}
