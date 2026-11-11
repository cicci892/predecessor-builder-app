// Visualizzazione dei testi di gioco: traduzione in italiano (data/it.js) e simboli colorati
// per i rapporti di scaling "(+40%)" (potenza magica, potenza fisica, salute, ...).
// I simboli sono nostri (non le immagini di pred.gg): stessi colori, simboli Unicode.
(function (root) {
  "use strict";

  const FX = typeof require !== "undefined" && typeof module !== "undefined" ? require("./effects.js") : root.PredEffects;
  const IT = (typeof window !== "undefined" && window.PRED_IT) || (typeof require !== "undefined" ? safeRequire() : {}) || {};

  function safeRequire() {
    try { return require("./data/it.json"); } catch (e) { return {}; }
  }

  // tag del gioco -> [classe colore, simbolo, descrizione]
  const SCALE = {
    abilitypowertext: ["ap", "✦", "Potenza magica"],
    attackdamagetext: ["ad", "⚔", "Potenza fisica"],
    healthtext: ["hp", "✚", "Salute"],
    manatext: ["mana", "●", "Mana"],
    armortext: ["ar", "⬟", "Armatura fisica"],
    mrtext: ["mr", "⬠", "Armatura magica"],
    critchancetext: ["cr", "✸", "Probabilità critico"],
    attackspeedtext: ["as", "»", "Velocità d'attacco"],
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = (s) => s.replace(/\s+/g, " ").trim();

  // Un rapporto di scaling nel testo originale è un tag con "(+" subito dopo; ne raccolgo i tipi in ordine.
  function scaleTypes(raw) {
    const out = [];
    const re = /<(\w+)>\(\+?/g;
    let m;
    while ((m = re.exec(raw))) {
      const t = SCALE[m[1].toLowerCase()];
      if (t) out.push(t);
    }
    return out;
  }

  // Traduce e decora una frase del gioco (testo con tag) -> HTML
  function sentenceHtml(raw) {
    const plain = norm(FX.strip(raw));
    if (plain.length < 3 || /\{\w+\}/.test(plain)) return "";
    const types = scaleTypes(raw);
    const text = IT[plain] || plain;
    let i = 0;
    const html = esc(text).replace(/\(\+[^)]*\)/g, (g) => {
      const t = types[i++];
      return t ? `<span class="t-${t[0]}" title="${t[2]}">${g}${t[1]}</span>` : g;
    });
    return IT[plain] ? html : `<span class="untr" title="Non ancora tradotto">${html}</span>`;
  }

  // Testo completo (più frasi / elenchi puntati) -> HTML con una riga per punto
  function richHtml(raw) {
    const lines = FX.sentences(raw || "").map(sentenceHtml).filter(Boolean);
    return lines.map((l) => `<div class="fxl">• ${l}</div>`).join("");
  }

  // Abilità e altri testi semplici (senza tag di scaling)
  function plainHtml(text) {
    return FX.sentences(text || "").map((s) => esc(IT[norm(FX.strip(s))] || norm(FX.strip(s)))).join(" ");
  }

  const LEGEND = Object.values(SCALE).map((t) => `<span class="t-${t[0]}">${t[1]} ${t[2]}</span>`).join(" · ");

  const api = { richHtml, plainHtml, sentenceHtml, LEGEND };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredRich = api;
})(typeof self !== "undefined" ? self : this);
