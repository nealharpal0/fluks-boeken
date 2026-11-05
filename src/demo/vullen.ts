/**
 * Demodata voor "Glans & Co": klanten, afspraken, aanvragen, een blokkade en
 * verstuurde berichten, steeds rond de datum van vandaag. Alle namen,
 * e-mailadressen (.example) en kentekens zijn verzonnen.
 */
import { sjabloonContext } from "../acties";
import type { App } from "../app";
import type { BerichtInhoud } from "../berichten/opmaak";
import * as sjabloon from "../berichten/sjablonen";
import { maakAfspraak, maakBlokkade } from "../db/afspraken";
import { bewaarFoto, leesInstelling, schrijfInstelling } from "../db/overig";
import { bezetTotVan, eindVan, openingOp } from "../lib/beschikbaarheid";
import { type Datum, datumVan, maakMoment, naarMinuten, plusDagen, plusUren } from "../lib/tijd";
import type { Afspraak, AfspraakStatus } from "../types";
import { DEMO_FOTOS } from "./fotos";

const KLANTEN = [
  { naam: "Sanne de Vries", telefoon: "06 11 22 33 44", kenteken: "GX-512-K", auto: "Volkswagen Golf" },
  { naam: "Mehmet Yılmaz", telefoon: "06 22 33 44 55", kenteken: "HB-77-ZT", auto: "BMW 3-serie Touring" },
  { naam: "Lotte Jansen", telefoon: "06 33 44 55 66", kenteken: "S-401-NP", auto: "Tesla Model 3" },
  { naam: "Ruben Bakker", telefoon: "06 44 55 66 77", kenteken: "KR-90-PL", auto: "Volvo XC60" },
  { naam: "Fatima El Amrani", telefoon: "06 55 66 77 88", kenteken: "TJ-318-B", auto: "Toyota Yaris" },
  { naam: "Joost van Dijk", telefoon: "06 66 77 88 99", kenteken: "PZ-650-V", auto: "Porsche 911" },
  { naam: "Emma Visser", telefoon: "06 77 88 99 00", kenteken: "ND-24-RS", auto: "Mini Cooper" },
  { naam: "Daan Smit", telefoon: "06 88 99 00 11", kenteken: "XL-833-F", auto: "Audi A4 Avant" },
  { naam: "Noor Hendriks", telefoon: "06 99 00 11 22", kenteken: "GV-145-D", auto: "Kia EV6" },
  { naam: "Thomas de Boer", telefoon: "06 10 20 30 40", kenteken: "RT-09-KN", auto: "Ford Ranger" },
  { naam: "Isa Mulder", telefoon: "06 20 30 40 50", kenteken: "LB-772-H", auto: "Peugeot 208" },
  { naam: "Bram Peters", telefoon: "06 30 40 50 60", kenteken: "ZK-31-WX", auto: "Mercedes C-klasse" },
];

function emailVan(naam: string): string {
  return `${naam.toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, ".")}@voorbeeld.example`;
}

interface Plan {
  dag: Datum;
  tijd: string;
  behandeling: string;
  klant: number;
  status: AfspraakStatus;
  opmerking?: string;
  toestemming?: [boolean, boolean, boolean];
  reden?: string;
  fotos?: number;
}

/** Open van (uiterlijk) 08:00 tot (minstens) 18:00, zodat alle demo-afspraken passen. */
function heleWerkdag(app: App, d: Datum): boolean {
  const v = openingOp(app.config, d).vakken;
  return v.length > 0 && v[0]![0] <= 8 * 60 && v[v.length - 1]![1] >= 18 * 60;
}

/** De eerstvolgende `n` dagen (vanaf `vanaf`, in `richting`) waarop de zaak open is. */
function werkdagen(app: App, vanaf: Datum, n: number, richting: 1 | -1): Datum[] {
  const uit: Datum[] = [];
  let d = vanaf;
  for (let i = 0; uit.length < n && i < 60; i++) {
    d = plusDagen(d, richting);
    if (heleWerkdag(app, d)) uit.push(d);
  }
  return uit;
}

async function logBericht(app: App, a: Afspraak | null, soort: string, sleutel: string, aan: string, inhoud: BerichtInhoud, moment: string) {
  await app.db
    .prepare(
      `INSERT INTO berichten (sleutel, soort, afspraak_id, ontvanger, onderwerp, status, pogingen, inhoud_html, inhoud_tekst, aangemaakt_op, verzonden_op)
       VALUES (?1, ?2, ?3, ?4, ?5, 'gelogd', 1, ?6, ?7, ?8, ?8) ON CONFLICT (sleutel) DO NOTHING`,
    )
    .bind(sleutel, soort, a?.id ?? null, aan, inhoud.onderwerp, inhoud.html, inhoud.tekst, moment)
    .run();
}

/** Leegt de database en vult hem met verse demodata. */
export async function vulDemo(app: App): Promise<void> {
  const db = app.db;
  await db.batch(["fotos", "berichten", "afspraken", "blokkades", "afmeldingen", "limieten"].map((t) => db.prepare(`DELETE FROM ${t}`)));

  const nu = app.nu();
  const vandaag = datumVan(nu);
  const verleden = werkdagen(app, vandaag, 8, -1);
  const toekomst = werkdagen(app, vandaag, 8, 1);
  const vandaagOpen = heleWerkdag(app, vandaag);
  const ja: [boolean, boolean, boolean] = [true, true, true];

  const plannen: Plan[] = [
    // Verleden
    { dag: verleden[7]!, tijd: "13:00", behandeling: "coating", klant: 5, status: "afgerond", toestemming: ja },
    { dag: verleden[6]!, tijd: "09:00", behandeling: "interieur", klant: 7, status: "afgerond", toestemming: [true, true, false] },
    { dag: verleden[5]!, tijd: "08:00", behandeling: "complete-detailing", klant: 8, status: "afgerond", toestemming: ja },
    { dag: verleden[4]!, tijd: "10:00", behandeling: "handwas", klant: 9, status: "niet_verschenen" },
    { dag: verleden[3]!, tijd: "13:00", behandeling: "polijsten", klant: 10, status: "afgerond", toestemming: [false, true, false] },
    { dag: verleden[1]!, tijd: "09:00", behandeling: "handwas", klant: 11, status: "afgerond", toestemming: ja },
    { dag: verleden[0]!, tijd: "14:00", behandeling: "interieur", klant: 4, status: "afgerond", toestemming: [true, false, true] },
    // Vandaag (als de zaak open is)
    ...(vandaagOpen
      ? [
          { dag: vandaag, tijd: "08:00", behandeling: "complete-detailing", klant: 0, status: "bevestigd" as const, toestemming: ja, opmerking: "Veel hondenharen in de kofferbak." },
          { dag: vandaag, tijd: "13:30", behandeling: "handwas", klant: 1, status: "bevestigd" as const, toestemming: [true, false, false] as [boolean, boolean, boolean] },
        ]
      : []),
    // Toekomst
    { dag: toekomst[0]!, tijd: "09:00", behandeling: "interieur", klant: 2, status: "bevestigd", toestemming: ja, fotos: 1 },
    { dag: toekomst[0]!, tijd: "13:00", behandeling: "velgen", klant: 3, status: "bevestigd" },
    { dag: toekomst[1]!, tijd: "08:00", behandeling: "polijsten", klant: 6, status: "aangevraagd", toestemming: ja, opmerking: "Lichte krassen op de motorkap, zie foto's.", fotos: 2 },
    { dag: toekomst[1]!, tijd: "13:00", behandeling: "handwas", klant: 9, status: "bevestigd", toestemming: [true, false, false] },
    { dag: toekomst[2]!, tijd: "10:00", behandeling: "handwas", klant: 10, status: "aangevraagd" },
    { dag: toekomst[2]!, tijd: "14:00", behandeling: "complete-detailing", klant: 11, status: "geweigerd", reden: "Die middag zijn we al volgeboekt. Past donderdag ook?" },
    { dag: toekomst[3]!, tijd: "08:30", behandeling: "complete-detailing", klant: 7, status: "bevestigd", toestemming: ja },
    { dag: toekomst[5]!, tijd: "13:00", behandeling: "coating", klant: 8, status: "bevestigd", toestemming: ja, opmerking: "Auto is net nieuw afgeleverd." },
    { dag: toekomst[6]!, tijd: "09:30", behandeling: "interieur", klant: 0, status: "aangevraagd", toestemming: [true, true, false] },
  ];

  // Blokkade: een middag training
  await maakBlokkade(db, maakMoment(toekomst[4]!, 13 * 60), maakMoment(toekomst[4]!, 18 * 60), "Training keramische coatings");

  const ctx = sjabloonContext(app);
  for (const p of plannen) {
    const b = app.config.behandelingen.find((x) => x.id === p.behandeling)!;
    const k = KLANTEN[p.klant]!;
    const start = maakMoment(p.dag, naarMinuten(p.tijd));
    const eind = eindVan(start, b.duurMinuten);
    const actiefStatus = p.status === "aangevraagd" ? "aangevraagd" : "bevestigd";
    const t = p.toestemming ?? [false, false, false];
    const aanvraagMoment = plusUren(start, -24 * 5);
    const a = await maakAfspraak(
      db,
      {
        behandelingId: b.id,
        behandelingNaam: b.naam,
        start,
        eind,
        bezetTot: bezetTotVan(start, b.duurMinuten, app.config.planning.bufferMinuten),
        status: actiefStatus,
        bevestigdOp: actiefStatus === "bevestigd" ? plusUren(aanvraagMoment, 2) : null,
        naam: k.naam,
        email: emailVan(k.naam),
        telefoon: k.telefoon,
        opmerking: p.opmerking ?? "",
        extraVelden: { kenteken: k.kenteken, auto: k.auto },
        toestemmingHerinnering: t[0],
        toestemmingReview: t[1],
        toestemmingOnderhoud: t[2],
        bron: "demo",
      },
      app.config.planning.capaciteit,
    );
    if (!a) continue;
    let rij: Afspraak = a;
    if (p.status !== actiefStatus) {
      const klaarOp = p.status === "afgerond" ? eind : null;
      rij = (await db
        .prepare("UPDATE afspraken SET status = ?2, reden = ?3, klaar_op = ?4 WHERE id = ?1 RETURNING *")
        .bind(a.id, p.status, p.reden ?? "", klaarOp)
        .first<Afspraak>())!;
    }
    for (let i = 0; i < (p.fotos ?? 0); i++) {
      const foto = DEMO_FOTOS[i % DEMO_FOTOS.length]!;
      await bewaarFoto(db, a.id, "image/jpeg", Uint8Array.from(atob(foto), (c) => c.charCodeAt(0)));
    }

    // Berichten die in werkelijkheid verstuurd zouden zijn
    const email = rij.email;
    {
      await logBericht(app, rij, "aanvraag_ontvangen", `aanvraag_ontvangen:${rij.id}`, email, sjabloon.aanvraagOntvangen(ctx, { ...rij, status: "aangevraagd" }), aanvraagMoment);
      await logBericht(app, rij, "nieuwe_aanvraag", `nieuwe_aanvraag:${rij.id}`, app.config.email.beheerderAdres, sjabloon.nieuweAanvraag(ctx, { ...rij, status: "aangevraagd" }, p.fotos ?? 0), aanvraagMoment);
    }
    if (["bevestigd", "afgerond", "niet_verschenen"].includes(rij.status)) {
      await logBericht(app, rij, "bevestiging", `bevestiging:${rij.id}`, email, sjabloon.bevestiging(ctx, rij), plusUren(aanvraagMoment, 2));
    }
    if (rij.status === "geweigerd") {
      await logBericht(app, rij, "afwijzing", `afwijzing:${rij.id}`, email, sjabloon.afwijzing(ctx, rij), plusUren(aanvraagMoment, 3));
    }
    if (rij.status === "afgerond") {
      if (rij.toestemming_herinnering) {
        await logBericht(app, rij, "herinnering", `herinnering:${rij.id}:${rij.start}`, email, sjabloon.herinnering(ctx, rij, plusDagen(p.dag, -1)), plusUren(start, -24));
      }
      await logBericht(app, rij, "klaar", `klaar:${rij.id}`, email, sjabloon.klaar(ctx, rij), eind);
      if (rij.toestemming_review) {
        await logBericht(app, rij, "review", `review:${rij.id}`, email, sjabloon.review(ctx, rij), plusUren(eind, 3));
        if (p.klant === 5) {
          await logBericht(app, rij, "review_herinnering", `review_herinnering:${rij.id}`, email, sjabloon.reviewHerinnering(ctx, rij), plusUren(eind, 3 + 24 * 4));
        }
      }
    }
  }
  // Eén klant heeft al op de reviewlink geklikt.
  await db.prepare("UPDATE afspraken SET review_geklikt_op = ?1 WHERE email = ?2").bind(nu, emailVan(KLANTEN[8]!.naam)).run();
  await schrijfInstelling(db, "demo_gevuld_op", vandaag);
}

/**
 * Vult de demo als dat vandaag nog niet is gebeurd. Atomisch: bij gelijktijdige
 * verzoeken vult er maar één.
 */
export async function vulDemoIndienNodig(app: App, alleenAlsLeeg: boolean): Promise<boolean> {
  const vandaag = datumVan(app.nu());
  if (alleenAlsLeeg && (await leesInstelling(app.db, "demo_gevuld_op"))) return false;
  const claim = await app.db
    .prepare(
      `INSERT INTO instellingen (sleutel, waarde) VALUES ('demo_claim', ?1)
       ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde WHERE instellingen.waarde != excluded.waarde
       RETURNING sleutel`,
    )
    .bind(vandaag)
    .first();
  if (!claim) return false;
  await vulDemo(app);
  return true;
}
