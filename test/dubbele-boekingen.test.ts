import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accepteer, boekAfspraak, type BoekInvoer, maakAfspraakDoorBeheer, verzet, weiger } from "../src/acties";
import { accepteerAfspraak, maakBlokkade, wijzigStatus } from "../src/db/afspraken";
import { leegDatabase, testApp, testConfig, zetAfspraak } from "./hulp";

const NU = "2026-11-02T09:00";
const DAG = "2026-11-09"; // maandag

function invoer(over: Partial<BoekInvoer> = {}): BoekInvoer {
  return {
    behandelingId: "handwas",
    datum: DAG,
    tijd: "10:00",
    naam: "Sanne de Vries",
    email: "sanne@voorbeeld.nl",
    telefoon: "06 12345678",
    opmerking: "",
    extraVelden: {},
    toestemmingHerinnering: false,
    toestemmingReview: false,
    toestemmingOnderhoud: false,
    fotos: [],
    ...over,
  };
}

async function aantalActief(): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM afspraken WHERE status IN ('aangevraagd','bevestigd','afgerond')",
  ).first<{ n: number }>();
  return r!.n;
}

beforeEach(leegDatabase);

describe("geen dubbele boekingen in de database", () => {
  it("laat van tien gelijktijdige boekingen voor hetzelfde slot er precies één slagen", async () => {
    const { app } = testApp(NU);
    const pogingen = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => zetAfspraak(app, `${DAG}T10:00`, { naam: `Klant ${i}`, status: "aangevraagd" })),
    );
    expect(pogingen.filter((p) => p.status === "fulfilled")).toHaveLength(1);
    expect(await aantalActief()).toBe(1);
  });

  it("weigert een afspraak die gedeeltelijk overlapt, ook via de buffer", async () => {
    const { app } = testApp(NU);
    await zetAfspraak(app, `${DAG}T10:00`); // 10:00-11:00, bezet tot 11:15
    await expect(zetAfspraak(app, `${DAG}T10:30`)).rejects.toThrow(/bezet/);
    await expect(zetAfspraak(app, `${DAG}T09:30`)).rejects.toThrow(/bezet/); // 09:30-10:45 incl. buffer
    await expect(zetAfspraak(app, `${DAG}T11:00`)).rejects.toThrow(/bezet/); // binnen de buffer
    await expect(zetAfspraak(app, `${DAG}T11:15`)).resolves.toBeTruthy();
    await expect(zetAfspraak(app, `${DAG}T08:45`)).resolves.toBeTruthy(); // 08:45-10:00 sluit precies aan
  });

  it("staat bij capaciteit 2 precies twee gelijktijdige afspraken toe", async () => {
    const { app } = testApp(
      NU,
      testConfig((c) => {
        c.planning.capaciteit = 2;
      }),
    );
    const pogingen = await Promise.allSettled(Array.from({ length: 5 }, () => zetAfspraak(app, `${DAG}T10:00`)));
    expect(pogingen.filter((p) => p.status === "fulfilled")).toHaveLength(2);
    // Een afspraak die alleen met één van de twee overlapt, maar op een moment waarop er al twee lopen: geweigerd.
    await expect(zetAfspraak(app, `${DAG}T10:30`)).rejects.toThrow(/bezet/);
    // Na afloop van beide (11:15) is er weer plek.
    await expect(zetAfspraak(app, `${DAG}T11:15`)).resolves.toBeTruthy();
  });

  it("telt bij capaciteit 2 alleen echt gelijktijdige afspraken", async () => {
    const { app } = testApp(
      NU,
      testConfig((c) => {
        c.planning.capaciteit = 2;
      }),
    );
    await zetAfspraak(app, `${DAG}T09:00`); // bezet 09:00-10:15
    await zetAfspraak(app, `${DAG}T10:15`); // bezet 10:15-11:30
    await expect(zetAfspraak(app, `${DAG}T09:30`)).resolves.toBeTruthy(); // nooit meer dan 2 tegelijk
    await expect(zetAfspraak(app, `${DAG}T10:00`)).rejects.toThrow(/bezet/); // nu wél 3 tegelijk om 10:15
  });

  it("respecteert blokkades", async () => {
    const { app } = testApp(NU);
    await maakBlokkade(app.db, `${DAG}T13:00`, `${DAG}T15:00`, "Tandarts");
    await expect(zetAfspraak(app, `${DAG}T14:00`)).rejects.toThrow(/bezet/);
    await expect(zetAfspraak(app, `${DAG}T12:00`)).rejects.toThrow(/bezet/); // buffer loopt de blokkade in
    await expect(zetAfspraak(app, `${DAG}T15:00`)).resolves.toBeTruthy();
  });

  it("geeft het slot vrij na weigeren of annuleren", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    await wijzigStatus(app.db, a.id, ["aangevraagd"], "geweigerd");
    const b = await zetAfspraak(app, `${DAG}T10:00`);
    await wijzigStatus(app.db, b.id, ["bevestigd"], "geannuleerd");
    await expect(zetAfspraak(app, `${DAG}T10:00`)).resolves.toBeTruthy();
  });
});

describe("accepteren en verzetten", () => {
  it("accepteert een aanvraag maar niet twee keer", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    const eerste = await accepteerAfspraak(app.db, a.id, 1, NU);
    expect(eerste.ok).toBe(true);
    if (eerste.ok) expect(eerste.afspraak).toMatchObject({ status: "bevestigd", bevestigd_op: NU });
    const tweede = await accepteerAfspraak(app.db, a.id, 1, NU);
    expect(tweede).toEqual({ ok: false, reden: "status" });
  });

  it("weigert accepteren als het tijdstip inmiddels geblokkeerd is", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    await maakBlokkade(app.db, `${DAG}T00:00`, `${DAG}T23:59`, "Ziek");
    const r = await accepteer(app, a.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fout).toMatch(/geen plek/);
  });

  it("verzet alleen naar een vrij tijdstip en mag over zijn eigen oude tijd heen schuiven", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`);
    await zetAfspraak(app, `${DAG}T13:00`, { email: "ander@voorbeeld.nl" });
    const bezet = await verzet(app, a.id, DAG, "13:30");
    expect(bezet.ok).toBe(false);
    const halfUur = await verzet(app, a.id, DAG, "10:30"); // overlapt alleen met zichzelf
    expect(halfUur.ok).toBe(true);
    if (halfUur.ok) expect(halfUur.afspraak).toMatchObject({ start: `${DAG}T10:30`, eind: `${DAG}T11:30`, bezet_tot: `${DAG}T11:45` });
  });

  it("kan geweigerde afspraken niet meer verzetten of accepteren", async () => {
    const { app } = testApp(NU);
    const a = await zetAfspraak(app, `${DAG}T10:00`, { status: "aangevraagd" });
    expect((await weiger(app, a.id, "Vol")).ok).toBe(true);
    expect((await verzet(app, a.id, DAG, "14:00")).ok).toBe(false);
    expect((await accepteer(app, a.id)).ok).toBe(false);
  });

  it("voorkomt ook dubbele boekingen bij handmatig invoeren in het beheer", async () => {
    const { app } = testApp(NU);
    await zetAfspraak(app, `${DAG}T10:00`);
    const r = await maakAfspraakDoorBeheer(app, {
      behandelingId: "velgen",
      datum: DAG,
      tijd: "10:30",
      naam: "Telefonische klant",
      email: "",
      telefoon: "",
      notitie: "",
      stuurBevestiging: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("boeken via het formulier", () => {
  it("laat bij twee klanten die tegelijk boeken er één winnen en geeft de ander een nette melding", async () => {
    const { app, wacht } = testApp(NU);
    const [a, b] = await Promise.all([
      boekAfspraak(app, invoer({ email: "een@voorbeeld.nl" })),
      boekAfspraak(app, invoer({ email: "twee@voorbeeld.nl" })),
    ]);
    await wacht();
    const uitkomsten = [a, b];
    expect(uitkomsten.filter((u) => u.ok)).toHaveLength(1);
    const verliezer = uitkomsten.find((u) => !u.ok);
    expect(verliezer && !verliezer.ok && verliezer.slotBezet).toBe(true);
    expect(await aantalActief()).toBe(1);
  });

  it("weigert tijden buiten de openingstijden of in de pauze", async () => {
    const { app } = testApp(NU);
    expect((await boekAfspraak(app, invoer({ tijd: "12:00" }))).ok).toBe(false); // loopt de pauze in
    expect((await boekAfspraak(app, invoer({ tijd: "07:00" }))).ok).toBe(false);
    expect((await boekAfspraak(app, invoer({ datum: "2026-11-08" }))).ok).toBe(false); // zondag
  });

  it("controleert de invoer", async () => {
    const { app } = testApp(NU);
    const r = await boekAfspraak(app, invoer({ naam: "", email: "geen-email", telefoon: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fouten).sort()).toEqual(["email", "naam", "telefoon"]);
  });

  it("negeert botjes die het verborgen veld invullen", async () => {
    const { app } = testApp(NU);
    expect((await boekAfspraak(app, invoer({ valstrik: "http://spam" }))).ok).toBe(false);
    expect(await aantalActief()).toBe(0);
  });

  it("slaat toestemmingen standaard uit op en bevestigt direct als dat zo is ingesteld", async () => {
    const { app } = testApp(
      NU,
      testConfig((c) => {
        c.planning.automatischBevestigen = true;
      }),
    );
    const r = await boekAfspraak(app, invoer());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.afspraak.status).toBe("bevestigd");
      expect(r.afspraak).toMatchObject({ toestemming_herinnering: 0, toestemming_review: 0, toestemming_onderhoud: 0, toestemming_op: null });
    }
  });
});
