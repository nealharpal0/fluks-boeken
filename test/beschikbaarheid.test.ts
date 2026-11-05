import { describe, expect, it } from "vitest";
import {
  type BezetteTijd,
  dagenOverzicht,
  maxGelijktijdig,
  openingOp,
  vrijeTijdsloten,
} from "../src/lib/beschikbaarheid";
import { feestdagen, formatDatumLang, lokaalNaarUtc, nuLokaal, paaszondag, weekdagIndex } from "../src/lib/tijd";
import { testConfig } from "./hulp";

// Maandag 9 november 2026; "nu" ligt een week eerder zodat de minimale boekingstermijn niet meespeelt.
const MAANDAG = "2026-11-09";
const NU = "2026-11-02T09:00";
const handwas = { duurMinuten: 60 };
const lang = { duurMinuten: 240 };

function slots(opties: Partial<Parameters<typeof vrijeTijdsloten>[0]> = {}) {
  return vrijeTijdsloten({
    config: testConfig(),
    behandeling: handwas,
    datum: MAANDAG,
    nu: NU,
    afspraken: [],
    blokkades: [],
    ...opties,
  });
}

const afspraak = (start: string, bezetTot: string, id?: number): BezetteTijd => ({ start, bezetTot, id });

describe("tijdsloten op een lege dag", () => {
  it("biedt elke 30 minuten een slot binnen de openingstijden, behalve tijdens de pauze", () => {
    expect(slots()).toEqual([
      "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
      "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
    ]);
  });

  it("laat een lange behandeling niet over de pauze of sluitingstijd heen lopen", () => {
    expect(slots({ behandeling: lang })).toEqual(["08:00", "08:30", "13:00", "13:30", "14:00"]);
  });

  it("is op zondag (gesloten) leeg", () => {
    expect(slots({ datum: "2026-11-08" })).toEqual([]);
  });

  it("gebruikt de afwijkende openingstijden op zaterdag", () => {
    const s = slots({ datum: "2026-11-14" });
    expect(s[0]).toBe("09:00");
    expect(s.at(-1)).toBe("15:00");
    expect(s).not.toContain("12:00"); // 12:00-13:00 raakt de pauze
  });

  it("is dicht op feestdagen, tenzij er een uitzondering is ingesteld", () => {
    expect(slots({ datum: "2026-12-25" })).toEqual([]);
    const config = testConfig((c) => {
      c.uitzonderingen = { "2026-12-25": "10:00-12:00" };
    });
    expect(slots({ datum: "2026-12-25", config })).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("respecteert per-dag pauzes", () => {
    const config = testConfig((c) => {
      c.pauzes = { maandag: ["10:00-11:00"] };
    });
    const s = slots({ config });
    expect(s).toContain("08:30");
    expect(s).not.toContain("09:30"); // 09:30-10:30 raakt de pauze
    expect(s).toContain("11:00");
    expect(s).toContain("12:30"); // op maandag geen middagpauze meer
  });
});

describe("tijdsloten met bestaande afspraken", () => {
  it("houdt rekening met duur én buffer van een bestaande afspraak", () => {
    // Bestaande afspraak 10:00-11:00, met 15 minuten buffer bezet tot 11:15.
    const s = slots({ afspraken: [afspraak(`${MAANDAG}T10:00`, `${MAANDAG}T11:15`)] });
    expect(s.slice(0, 4)).toEqual(["08:00", "08:30", "11:15", "11:30"]);
    for (const t of ["09:00", "09:30", "10:00", "10:30", "11:00"]) expect(s).not.toContain(t);
  });

  it("biedt een slot direct na een afspraak aan zodat de dag niet versnippert", () => {
    const s = slots({ afspraken: [afspraak(`${MAANDAG}T08:00`, `${MAANDAG}T08:45`)] });
    expect(s[0]).toBe("08:45");
  });

  it("negeert de afspraak zelf bij verzetten", () => {
    const eigen = afspraak(`${MAANDAG}T10:00`, `${MAANDAG}T11:15`, 7);
    expect(slots({ afspraken: [eigen] })).not.toContain("10:00");
    expect(slots({ afspraken: [eigen], negeerId: 7 })).toContain("10:00");
  });

  it("staat bij capaciteit 2 twee afspraken tegelijk toe, maar geen derde", () => {
    const config = testConfig((c) => {
      c.planning.capaciteit = 2;
    });
    const een = [afspraak(`${MAANDAG}T10:00`, `${MAANDAG}T11:15`)];
    expect(slots({ config, afspraken: een })).toContain("10:00");
    const twee = [...een, afspraak(`${MAANDAG}T10:00`, `${MAANDAG}T11:15`)];
    expect(slots({ config, afspraken: twee })).not.toContain("10:00");
  });

  it("telt bij capaciteit alleen afspraken die écht tegelijk lopen", () => {
    // A: 09:00-10:15 en B: 10:15-11:30 overlappen elkaar niet. Een slot van 09:30-10:45 raakt beide,
    // maar er lopen nooit meer dan 1 tegelijk naast het nieuwe slot.
    const lijst = [afspraak(`${MAANDAG}T09:00`, `${MAANDAG}T10:15`), afspraak(`${MAANDAG}T10:15`, `${MAANDAG}T11:30`)];
    expect(maxGelijktijdig(lijst, `${MAANDAG}T09:30`, `${MAANDAG}T10:45`)).toBe(1);
    const config = testConfig((c) => {
      c.planning.capaciteit = 2;
    });
    expect(slots({ config, afspraken: lijst })).toContain("09:30");
    expect(slots({ afspraken: lijst })).not.toContain("09:30");
  });

  it("blokkeert tijden die overlappen met een blokkade", () => {
    const s = slots({ blokkades: [{ start: `${MAANDAG}T14:00`, eind: `${MAANDAG}T16:00` }] });
    expect(s).not.toContain("13:00"); // 13:00-14:15 (met buffer) raakt de blokkade
    expect(s).toContain("16:00");
    expect(s).not.toContain("15:30");
  });

  it("blokkeert een hele dag met een meerdaagse blokkade (vakantie)", () => {
    const blokkades = [{ start: "2026-11-06T00:00", eind: "2026-11-12T00:00" }];
    expect(slots({ blokkades })).toEqual([]);
  });
});

describe("boekingstermijn", () => {
  it("biedt niets aan binnen de minimale termijn (12 uur)", () => {
    expect(slots({ nu: `${MAANDAG}T07:00` })).toEqual([]);
    const s = slots({ nu: "2026-11-08T22:00" }); // vroegste start: maandag 10:00
    expect(s[0]).toBe("10:00");
  });

  it("biedt niets aan in het verleden of verder dan het maximum vooruit", () => {
    expect(slots({ nu: "2026-11-10T09:00" })).toEqual([]);
    expect(slots({ nu: "2026-09-01T09:00" })).toEqual([]); // > 60 dagen vooruit
  });

  it("kan voor het beheer zonder termijnen rekenen", () => {
    expect(slots({ nu: `${MAANDAG}T07:00`, zonderTermijnen: true })[0]).toBe("08:00");
  });

  it("geeft een dagoverzicht voor de datumkiezer", () => {
    const overzicht = dagenOverzicht(
      { config: testConfig(), behandeling: handwas, nu: NU, afspraken: [], blokkades: [] },
      MAANDAG,
      7,
    );
    expect(overzicht).toHaveLength(7);
    expect(overzicht[0]).toMatchObject({ datum: MAANDAG, aantalVrij: 17 });
    expect(overzicht[6]).toMatchObject({ datum: "2026-11-15", aantalVrij: 0, geslotenReden: "Gesloten" });
  });
});

describe("tijdrekening", () => {
  it("berekent Pasen en de feestdagen correct", () => {
    expect(paaszondag(2024)).toBe("2024-03-31");
    expect(paaszondag(2025)).toBe("2025-04-20");
    expect(paaszondag(2026)).toBe("2026-04-05");
    expect(paaszondag(2027)).toBe("2027-03-28");
    const f2026 = feestdagen(2026);
    expect(f2026.get("2026-05-14")).toBe("Hemelvaartsdag");
    expect(f2026.get("2026-05-25")).toBe("Tweede pinksterdag");
    expect(feestdagen(2025).get("2025-04-26")).toBe("Koningsdag"); // 27 april 2025 is een zondag
    expect(openingOp(testConfig(), "2026-04-06").geslotenReden).toBe("Tweede paasdag");
  });

  it("rekent lokale tijd om naar UTC, ook met zomertijd", () => {
    expect(lokaalNaarUtc("2026-07-01T10:00", "Europe/Amsterdam").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(lokaalNaarUtc("2026-11-09T10:00", "Europe/Amsterdam").toISOString()).toBe("2026-11-09T09:00:00.000Z");
    expect(nuLokaal("Europe/Amsterdam", new Date("2026-07-01T08:00:00Z"))).toBe("2026-07-01T10:00");
    expect(nuLokaal("Europe/Amsterdam", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01T00:30");
  });

  it("schrijft datums in het Nederlands", () => {
    expect(weekdagIndex(MAANDAG)).toBe(0);
    expect(formatDatumLang("2026-11-03")).toBe("dinsdag 3 november 2026");
  });
});
