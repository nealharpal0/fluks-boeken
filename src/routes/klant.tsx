/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { annuleerDoorKlant, type BoekInvoer, boekAfspraak, magKlantAnnuleren, planningRond, schoon, vindBehandeling } from "../acties";
import { haalAfspraakOpToken, markeerReviewGeklikt } from "../db/afspraken";
import { binnenLimiet, meldAf } from "../db/overig";
import { dagenOverzicht, vrijeTijdsloten } from "../lib/beschikbaarheid";
import { googleAgendaLink, maakIcal } from "../lib/ical";
import { datumVan, isGeldigeDatum, isGeldigeTijd, plusDagen } from "../lib/tijd";
import { FoutPagina, type Melding } from "../views/layout";
import { AfmeldPagina, AfspraakPagina, BoekPagina, type FormWaarden, LEGE_WAARDEN, PrivacyPagina, StartPagina } from "../views/klant";
import { bestandenVeld, bezoekerIp, type Ctx, leesMelding, type Omgeving, tekstVeld, toon, zetMelding } from "./hulp";

export const klant = new Hono<Omgeving>();

const DAGEN_PER_SCHERM = 14;

klant.get("/", (c) => {
  const app = c.get("app");
  return toon(c, <StartPagina config={app.config} demo={app.demo} melding={leesMelding(c)} />);
});

klant.get("/privacy", (c) => {
  const app = c.get("app");
  return toon(c, <PrivacyPagina config={app.config} demo={app.demo} />);
});

function nietGevonden(c: Ctx, titel = "Pagina niet gevonden", tekst = "Deze pagina bestaat niet (meer).") {
  const app = c.get("app");
  return toon(c, <FoutPagina config={app.config} demo={app.demo} titel={titel} tekst={tekst} />, 404);
}

interface BoekState {
  waarden?: FormWaarden;
  fouten?: Record<string, string>;
  datum?: string | null;
  tijd?: string | null;
  status?: 200 | 409 | 422;
  melding?: Melding;
  herkies?: boolean;
}

async function toonBoekPagina(c: Ctx, behandelingId: string, state: BoekState = {}) {
  const app = c.get("app");
  const b = vindBehandeling(app, behandelingId);
  if (!b) return nietGevonden(c, "Behandeling niet gevonden", "Deze behandeling kan (nu) niet online geboekt worden.");

  const nu = app.nu();
  const vandaag = datumVan(nu);
  const laatste = plusDagen(vandaag, app.config.planning.maximaalDagenVooruit);
  const binnen = (d: string | undefined | null): d is string => !!d && isGeldigeDatum(d) && d >= vandaag && d <= laatste;

  const gevraagdeDatum = state.datum !== undefined ? state.datum : c.req.query("datum");
  const gevraagdeTijd = state.tijd !== undefined ? state.tijd : c.req.query("tijd");
  let datum = binnen(gevraagdeDatum) ? gevraagdeDatum : null;
  let vanaf = binnen(c.req.query("vanaf")) ? c.req.query("vanaf")! : (datum ?? vandaag);
  if (datum && (datum < vanaf || datum > plusDagen(vanaf, DAGEN_PER_SCHERM - 1))) vanaf = datum;
  const aantal = Math.min(DAGEN_PER_SCHERM, Math.max(1, Math.round((Date.parse(laatste) - Date.parse(vanaf)) / 86_400_000) + 1));

  const planning = await planningRond(app, vanaf, plusDagen(vanaf, aantal - 1));
  const basis = { config: app.config, behandeling: b, nu, ...planning };
  const dagen = dagenOverzicht(basis, vanaf, aantal);
  let eersteVrijeDag: string | null = null;
  if (!dagen.some((d) => d.aantalVrij)) {
    const verderVanaf = plusDagen(vanaf, aantal);
    if (verderVanaf <= laatste) {
      const verder = await planningRond(app, verderVanaf, laatste);
      const n = Math.round((Date.parse(laatste) - Date.parse(verderVanaf)) / 86_400_000) + 1;
      eersteVrijeDag = dagenOverzicht({ ...basis, ...verder }, verderVanaf, n).find((d) => d.aantalVrij)?.datum ?? null;
    }
  }
  // Nog geen dag gekozen: toon meteen de tijden van de eerste dag met plek.
  if (!datum && gevraagdeDatum === undefined) datum = dagen.find((d) => d.aantalVrij)?.datum ?? null;

  const tijden = datum ? vrijeTijdsloten({ ...basis, datum }) : [];
  let tijd = gevraagdeTijd && isGeldigeTijd(gevraagdeTijd) && tijden.includes(gevraagdeTijd) ? gevraagdeTijd : null;
  let melding = state.melding ?? leesMelding(c);
  if (gevraagdeTijd && !tijd && !melding) {
    melding = { soort: "info", tekst: "Dit tijdstip is niet (meer) beschikbaar. Kies een ander moment." };
    tijd = null;
  }

  return toon(c, 
    <BoekPagina
      config={app.config}
      demo={app.demo}
      melding={melding}
      behandeling={b}
      dagen={dagen}
      datum={datum}
      tijden={tijden}
      tijd={tijd}
      vanaf={vanaf}
      vorigeVanaf={vanaf > vandaag ? (plusDagen(vanaf, -DAGEN_PER_SCHERM) < vandaag ? vandaag : plusDagen(vanaf, -DAGEN_PER_SCHERM)) : null}
      volgendeVanaf={plusDagen(vanaf, DAGEN_PER_SCHERM) <= laatste ? plusDagen(vanaf, DAGEN_PER_SCHERM) : null}
      eersteVrijeDag={eersteVrijeDag}
      waarden={state.waarden ?? LEGE_WAARDEN}
      fouten={state.fouten ?? {}}
      herkies={state.herkies}
    />,
    state.status ?? 200,
  );
}

klant.get("/boeken/:id", (c) => toonBoekPagina(c, c.req.param("id")));

klant.post("/boeken/:id", async (c) => {
  const app = c.get("app");
  const behandelingId = c.req.param("id");
  if (!vindBehandeling(app, behandelingId)) return nietGevonden(c);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  } catch {
    return c.text("Ongeldig formulier", 400);
  }
  const extra: Record<string, string> = {};
  for (const v of app.config.formulier.extraVelden ?? []) {
    const waarde = schoon(tekstVeld(body, `extra_${v.id}`), v.maxLengte ?? 100);
    if (waarde) extra[v.id] = waarde;
  }
  const invoer: BoekInvoer = {
    behandelingId,
    datum: tekstVeld(body, "datum"),
    tijd: tekstVeld(body, "tijd"),
    naam: schoon(tekstVeld(body, "naam"), 100),
    email: schoon(tekstVeld(body, "email"), 254),
    telefoon: schoon(tekstVeld(body, "telefoon"), 20),
    opmerking: schoon(tekstVeld(body, "opmerking"), 1000),
    extraVelden: extra,
    toestemmingHerinnering: tekstVeld(body, "toestemming_herinnering") === "ja",
    toestemmingReview: tekstVeld(body, "toestemming_review") === "ja",
    toestemmingOnderhoud: tekstVeld(body, "toestemming_onderhoud") === "ja",
    fotos: bestandenVeld(body, "fotos"),
    valstrik: tekstVeld(body, "website"),
  };
  const waarden: FormWaarden = {
    naam: invoer.naam,
    email: invoer.email,
    telefoon: invoer.telefoon,
    opmerking: invoer.opmerking,
    extra,
    toestemmingHerinnering: invoer.toestemmingHerinnering,
    toestemmingReview: invoer.toestemmingReview,
    toestemmingOnderhoud: invoer.toestemmingOnderhoud,
  };

  if (!(await binnenLimiet(app.db, "aanvraag", bezoekerIp(c), 10, 3600_000))) {
    return toonBoekPagina(c, behandelingId, {
      waarden,
      datum: invoer.datum,
      tijd: invoer.tijd,
      status: 422,
      fouten: { algemeen: "Je hebt in korte tijd veel aanvragen gedaan. Probeer het later opnieuw of neem contact met ons op." },
    });
  }

  const uitkomst = await boekAfspraak(app, invoer);
  if (uitkomst.ok) {
    return c.redirect(`/afspraak/${uitkomst.afspraak.token}?nieuw=1`, 303);
  }
  if (uitkomst.slotBezet) {
    // Formulier opnieuw tonen zonder gekozen tijd, ingevulde gegevens blijven staan.
    return toonBoekPagina(c, behandelingId, {
      waarden,
      datum: invoer.datum,
      tijd: null,
      herkies: true,
      status: 409,
      melding: { soort: "fout", tekst: uitkomst.fouten.tijd ?? "Dit tijdstip is niet meer beschikbaar." },
    });
  }
  return toonBoekPagina(c, behandelingId, { waarden, fouten: uitkomst.fouten, datum: invoer.datum, tijd: invoer.tijd, status: 422 });
});

// ---------------------------------------------------------------------------
// Afspraakpagina, agenda-bestand, annuleren
// ---------------------------------------------------------------------------

function agendaGegevens(c: Ctx, a: { behandeling_naam: string; token: string }) {
  const app = c.get("app");
  const b = app.config.bedrijf;
  return {
    titel: `${a.behandeling_naam} bij ${b.naam}`,
    locatie: `${b.naam}, ${b.adres.straat}, ${b.adres.postcode} ${b.adres.plaats}`,
    beschrijving: `Je afspraak bij ${b.naam}.${b.telefoon ? ` Telefoon: ${b.telefoon}.` : ""}\nBekijk of annuleer: ${app.config.basisUrl}/afspraak/${a.token}`,
  };
}

klant.get("/afspraak/:token", async (c) => {
  const app = c.get("app");
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (!a || a.geanonimiseerd) return nietGevonden(c, "Afspraak niet gevonden", "We kunnen deze afspraak niet (meer) vinden. Controleer de link in je e-mail.");
  const g = agendaGegevens(c, a);
  return toon(c, 
    <AfspraakPagina
      config={app.config}
      demo={app.demo}
      melding={leesMelding(c)}
      afspraak={a}
      nieuw={c.req.query("nieuw") === "1"}
      magAnnuleren={magKlantAnnuleren(app, a)}
      agendaUrl={`/afspraak/${a.token}/agenda.ics`}
      googleAgendaUrl={googleAgendaLink({ ...g, start: a.start, eind: a.eind, tijdzone: app.tijdzone })}
    />,
  );
});

klant.get("/afspraak/:token/agenda.ics", async (c) => {
  const app = c.get("app");
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (!a || a.geanonimiseerd) return nietGevonden(c);
  const g = agendaGegevens(c, a);
  const host = new URL(app.config.basisUrl).host;
  const ics = maakIcal({
    naam: app.config.bedrijf.naam,
    tijdzone: app.tijdzone,
    events: [
      {
        uid: `afspraak-${a.id}@${host}`,
        start: a.start,
        eind: a.eind,
        titel: g.titel,
        locatie: g.locatie,
        beschrijving: g.beschrijving,
        status: a.status === "bevestigd" || a.status === "afgerond" ? "CONFIRMED" : a.status === "aangevraagd" ? "TENTATIVE" : "CANCELLED",
        url: `${app.config.basisUrl}/afspraak/${a.token}`,
      },
    ],
  });
  return c.body(ics, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="afspraak-${datumVan(a.start)}.ics"`,
  });
});

klant.post("/afspraak/:token/annuleren", async (c) => {
  const app = c.get("app");
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (!a) return nietGevonden(c);
  const r = await annuleerDoorKlant(app, a);
  zetMelding(c, r.ok ? { soort: "succes", tekst: "Je afspraak is geannuleerd. Je ontvangt een bevestiging per e-mail." } : { soort: "fout", tekst: r.fout });
  return c.redirect(`/afspraak/${a.token}`, 303);
});

// ---------------------------------------------------------------------------
// Reviewlink en afmelden
// ---------------------------------------------------------------------------

/** Reviewlink uit de e-mail: registreert de klik (zodat er geen herinnering volgt) en stuurt door naar Google. */
klant.get("/r/:token", async (c) => {
  const app = c.get("app");
  const doel = app.config.bedrijf.googleReviewUrl;
  if (!doel) return c.redirect("/", 302);
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (a) await markeerReviewGeklikt(app.db, a.id, app.nu());
  return c.redirect(doel, 302);
});

klant.get("/afmelden/:token", async (c) => {
  const app = c.get("app");
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (!a) return nietGevonden(c, "Link niet geldig", "Deze afmeldlink is niet (meer) geldig. Neem contact met ons op als je geen berichten meer wilt ontvangen.");
  return toon(c, <AfmeldPagina config={app.config} demo={app.demo} token={a.token} klaar={false} />);
});

/** Ook gebruikt voor "one-click unsubscribe" (RFC 8058) vanuit Gmail/Apple Mail. */
klant.post("/afmelden/:token", async (c) => {
  const app = c.get("app");
  const a = await haalAfspraakOpToken(app.db, c.req.param("token"));
  if (!a) return nietGevonden(c);
  await meldAf(app.db, a.email);
  if (c.req.header("content-type")?.includes("application/x-www-form-urlencoded")) {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    if (body["List-Unsubscribe"] === "One-Click") return c.text("Afgemeld", 200);
  }
  return toon(c, <AfmeldPagina config={app.config} demo={app.demo} token={a.token} klaar />);
});
