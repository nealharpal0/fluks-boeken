import { describe, expect, it } from "vitest";
import klantConfig from "../klant.config";
import demoConfig from "../src/config/demo.config";
import { valideerConfig } from "../src/config/valideer";
import { contrast, leesbaarOpWit, tekstKleurOp } from "../src/lib/kleur";
import { testConfig } from "./hulp";

describe("configuratie", () => {
  it("het meegeleverde klantvoorbeeld en de demo zijn geldig", () => {
    expect(valideerConfig(klantConfig).fouten).toEqual([]);
    expect(valideerConfig(demoConfig).fouten).toEqual([]);
  });

  it("geeft begrijpelijke Nederlandse foutmeldingen", () => {
    const c = testConfig((x) => {
      x.huisstijl.primaireKleur = "rood";
      x.basisUrl = "boeken.nl/";
      x.openingstijden.maandag = "18:00-09:00";
      x.behandelingen.push({ ...x.behandelingen[0]!, naam: "Dubbel" });
      x.email.smtp = { host: "smtp.x", poort: 25, beveiliging: "tls", gebruikersnaam: "" };
      x.planning.capaciteit = 0;
      x.berichten.seizoen.push({ id: "fout", datum: "13-45", onderwerp: "x", tekst: "y" });
    });
    const { fouten } = valideerConfig(c);
    expect(fouten).toContain('huisstijl.primaireKleur moet een hexkleur zijn, bijv. "#0f766e".');
    expect(fouten.some((f) => f.startsWith("basisUrl"))).toBe(true);
    expect(fouten).toContain("openingstijden.maandag: eindtijd moet na begintijd liggen.");
    expect(fouten.some((f) => f.includes('id "handwas" komt dubbel voor'))).toBe(true);
    expect(fouten.some((f) => f.includes("poort 25 is geblokkeerd"))).toBe(true);
    expect(fouten).toContain("planning.capaciteit moet tussen 1 en 50 liggen.");
    expect(fouten).toContain('berichten.seizoen (fout): datum moet "MM-DD" zijn.');
  });

  it("waarschuwt voor behandelingen die nooit passen", () => {
    const c = testConfig((x) => {
      x.behandelingen[0]!.duurMinuten = 600;
    });
    expect(valideerConfig(c).waarschuwingen.some((w) => w.includes("nooit te boeken"))).toBe(true);
  });

  it("kiest altijd een leesbare tekstkleur bij de huisstijl (WCAG AA)", () => {
    for (const kleur of ["#0f5e7a", "#7c3aed", "#fde047", "#ffffff", "#000000", "#22c55e", "#e11d48"]) {
      expect(contrast(kleur, tekstKleurOp(kleur))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(leesbaarOpWit(kleur), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
