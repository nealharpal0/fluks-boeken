/* Fluks Boeken – kleine verbeteringen bovenop de gewone HTML-formulieren.
   Alles werkt ook zonder JavaScript; dit script maakt het alleen prettiger. */
(function () {
  "use strict";

  var MAX_ZIJDE = 1600; // pixels
  var KWALITEIT = 0.8;
  var bezig = 0;

  /** Verkleint een foto in de browser tot een JPEG van hooguit 1600px. */
  function comprimeer(bestand) {
    if (!bestand.type || bestand.type.indexOf("image/") !== 0 || !window.createImageBitmap) return Promise.resolve(bestand);
    return createImageBitmap(bestand, { imageOrientation: "from-image" })
      .then(function (bitmap) {
        var schaal = Math.min(1, MAX_ZIJDE / Math.max(bitmap.width, bitmap.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * schaal);
        canvas.height = Math.round(bitmap.height * schaal);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return new Promise(function (klaar) {
          canvas.toBlob(
            function (blob) {
              if (!blob || (blob.size >= bestand.size && bestand.type === "image/jpeg")) return klaar(bestand);
              klaar(new File([blob], bestand.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            },
            "image/jpeg",
            KWALITEIT
          );
        });
      })
      .catch(function () {
        return bestand; // bijv. HEIC in een browser die dat niet kan lezen: de server controleert het
      });
  }

  function fotoInvoer(input) {
    var voorbeelden = input.parentNode.querySelector("[data-foto-voorbeelden]");
    var max = Number(input.getAttribute("data-max")) || 3;
    input.addEventListener("change", function () {
      var bestanden = Array.prototype.slice.call(input.files || []);
      var melding = "";
      if (bestanden.length > max) {
        bestanden = bestanden.slice(0, max);
        melding = "Je kunt maximaal " + max + " foto's meesturen; de eerste " + max + " zijn gekozen. ";
      }
      if (voorbeelden) voorbeelden.textContent = "Foto's verkleinen…";
      bezig++;
      Promise.all(bestanden.map(comprimeer))
        .then(function (klein) {
          try {
            var dt = new DataTransfer();
            klein.forEach(function (f) {
              dt.items.add(f);
            });
            input.files = dt.files;
          } catch (e) {
            /* oudere browser: originele bestanden worden verstuurd */
          }
          if (!voorbeelden) return;
          voorbeelden.textContent = "";
          klein.forEach(function (f, i) {
            var img = document.createElement("img");
            img.alt = "Gekozen foto " + (i + 1);
            img.src = URL.createObjectURL(f);
            voorbeelden.appendChild(img);
          });
          var tekst = document.createElement("p");
          tekst.className = "klein";
          tekst.textContent = melding + klein.length + " foto" + (klein.length === 1 ? "" : "'s") + " gekozen.";
          voorbeelden.appendChild(tekst);
        })
        .finally(function () {
          bezig--;
        });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Array.prototype.forEach.call(document.querySelectorAll('input[type="file"][name="fotos"]'), fotoInvoer);

    // Dubbel versturen voorkomen en wachten tot foto's verkleind zijn.
    Array.prototype.forEach.call(document.querySelectorAll("form[data-boekformulier]"), function (form) {
      form.addEventListener("submit", function (e) {
        if (bezig > 0) {
          e.preventDefault();
          setTimeout(function () {
            form.requestSubmit ? form.requestSubmit() : form.submit();
          }, 400);
          return;
        }
        var knop = form.querySelector('button[type="submit"]');
        if (knop) {
          knop.disabled = true;
          knop.textContent = knop.getAttribute("data-bezig-tekst") || "Even geduld…";
        }
      });
    });

    // Bevestiging bij onomkeerbare acties.
    Array.prototype.forEach.call(document.querySelectorAll("form[data-bevestig]"), function (form) {
      form.addEventListener("submit", function (e) {
        if (!window.confirm(form.getAttribute("data-bevestig"))) e.preventDefault();
      });
    });

    // Kopieerknoppen.
    Array.prototype.forEach.call(document.querySelectorAll("[data-kopieer]"), function (knop) {
      knop.addEventListener("click", function () {
        var veld = document.querySelector(knop.getAttribute("data-kopieer"));
        if (!veld) return;
        veld.select();
        var klaar = function () {
          knop.textContent = "Gekopieerd!";
          setTimeout(function () {
            knop.textContent = "Kopieer";
          }, 2000);
        };
        if (navigator.clipboard) navigator.clipboard.writeText(veld.value).then(klaar, function () {});
        else {
          document.execCommand("copy");
          klaar();
        }
      });
    });

    // Na een mislukte poging: focus op het foutoverzicht zodat schermlezers het voorlezen.
    var fouten = document.getElementById("fouten");
    if (fouten) fouten.focus();
  });
})();
