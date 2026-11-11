// Build reali dalle partite (data/reference, letto da pred.gg): cristallo, 6 oggetti in ordine con il minuto,
// augment, Eternal e ordine delle abilità. I campioni piccoli vengono corretti verso la media dell'eroe,
// così "100% su 3 partite" non vince su "54% su 500".
(function (root) {
  "use strict";

  const PRIOR = 60; // partite "finte" alla winrate media: più è alto, più conta la popolarità rispetto alla winrate
  const EDGE_W = 0.02; // quanto vale un punto di winrate sopra la media rispetto alla quota di scelta
  const STYLE_BONUS = 0.08; // spinta verso gli oggetti dello stile scelto, solo tra quelli usati davvero
  const MIN_SHARE = 0.08; // sotto questa quota di scelta un oggetto non è un'opzione reale
  const STYLE_STATS = {
    tank: ["HEALTH", "PHYSICAL_ARMOR", "MAGICAL_ARMOR"],
    dps: ["PHYSICAL_POWER", "MAGICAL_POWER", "PHYSICAL_PENETRATION", "MAGICAL_PENETRATION", "CRITICAL_CHANCE", "ATTACK_SPEED"],
    support: ["HEAL_AND_SHIELD_POWER", "MANA", "BASE_MANA_REGENERATION"],
  };

  // Winrate corretta: media pesata tra quella osservata e la media di riferimento
  const smooth = (wr, m, base) => (wr * m + base * PRIOR) / (m + PRIOR);

  function reliability(m) {
    if (m >= 200) return "solido";
    if (m >= 60) return "discreto";
    return "pochi dati";
  }

  // Scontri tra eroi: campioni più piccoli di quelli degli oggetti (max ~180 partite), soglie più basse
  function matchupReliability(m) {
    if (m >= 100) return "solido";
    if (m >= 30) return "discreto";
    return "pochi dati";
  }

  // Classifica le opzioni di una posizione: quota di scelta + vantaggio di winrate corretto
  function rank(list, opts) {
    const total = list.reduce((n, x) => n + x.matches, 0) || 1;
    const avg = list.reduce((n, x) => n + x.winrate * x.matches, 0) / total;
    return list
      .map((x) => {
        const share = x.matches / total;
        const wr = smooth(x.winrate, x.matches, avg);
        let score = share + EDGE_W * (wr - avg);
        if (opts && opts.bonus && share >= MIN_SHARE) score += opts.bonus(x) * STYLE_BONUS;
        return Object.assign({}, x, { share, wrAdj: wr, score });
      })
      .sort((a, b) => b.score - a.score);
  }

  function makeMeta(ref, ctx) {
    const allByName = new Map();
    for (const it of ctx.data.items) if (it.data && !allByName.has(it.data.displayName)) allByName.set(it.data.displayName, it);
    const item = (name) => ctx.byName.get(name) || allByName.get(name) || ctx.byName.get(name.trim()) || null;

    // Cristallo base da cui parte un cristallo evoluto (Tempest -> Warlock Crest -> Occult Crest)
    function crestRoot(name) {
      let cur = item(name);
      for (let i = 0; i < 4 && cur && (cur.data.buildsFrom || []).length; i++) cur = item(cur.data.buildsFrom[0].displayName);
      return cur;
    }

    const perksByName = new Map();
    for (const p of ctx.data.perks || []) if (p.data) perksByName.set(p.data.displayName.trim(), p);
    const perk = (name) => perksByName.get(String(name).trim()) || null;

    const has = (slug) => !!(ref && ref.heroes && ref.heroes[slug]);

    function styleBonus(style) {
      const stats = STYLE_STATS[style];
      if (!stats) return null;
      return (x) => {
        const it = item(x.name);
        return it && it.data.stats.some((s) => stats.includes(s.stat)) ? 1 : 0;
      };
    }

    // Build reale per eroe. conflicts(it, picked) evita oggetti che si escludono a vicenda.
    function build(slug, opts) {
      opts = opts || {};
      const h = ref.heroes[slug];
      if (!h) return null;
      const bonus = styleBonus(opts.style);
      const picked = [];
      const slots = [];
      for (let s = 0; s < 6; s++) {
        const options = rank(h.items[s] || [], { bonus });
        const choice = options.find((x) => {
          const it = item(x.name);
          return it && !picked.includes(it) && !(opts.conflicts && opts.conflicts(it, picked));
        });
        if (!choice) continue;
        const it = item(choice.name);
        picked.push(it);
        slots.push({ item: it, slot: s + 1, winrate: choice.winrate, wrAdj: choice.wrAdj, matches: choice.matches, share: choice.share, time: choice.time, reliability: reliability(choice.matches) });
      }
      // Se in qualche posizione tutte le opzioni erano già prese, si completa con gli oggetti più usati in assoluto
      if (picked.length < 6) {
        for (const x of popular(h)) {
          if (picked.length >= 6) break;
          const it = item(x.name);
          if (!it || picked.includes(it) || (opts.conflicts && opts.conflicts(it, picked))) continue;
          picked.push(it);
          slots.push({ item: it, slot: picked.length, winrate: x.winrate, wrAdj: x.winrate, matches: x.matches, share: 0, time: null, reliability: reliability(x.matches) });
        }
      }

      const crests = rank(h.crest);
      const finalCrest = item(crests[0].name);
      const startCrest = crestRoot(crests[0].name);
      const aug = rank(h.augments).map((x) => Object.assign(x, { perk: perk(x.name) })).filter((x) => x.perk);
      const ete = rank(h.eternals).map((x) => Object.assign(x, { perk: perk(x.name) })).filter((x) => x.perk);

      return {
        slots,
        items: picked,
        crest: { start: startCrest, final: finalCrest, winrate: crests[0].winrate, matches: crests[0].matches, time: crests[0].time },
        augment: aug[0] || null,
        augmentAlt: aug.slice(1),
        eternal: ete[0] || null,
        eternalAlt: ete.slice(1, 3),
        skillOrder: h.skillOrder,
        hero: { winrate: h.winrate, pickrate: h.pickrate, banrate: h.banrate },
        source: { version: ref.version, filter: ref.filter, collected: ref.collected },
      };
    }

    // Oggetti più usati in qualsiasi posizione (somma delle partite)
    function popular(h) {
      const tot = new Map();
      for (const slot of h.items) for (const x of slot) {
        const t = tot.get(x.name) || { name: x.name, matches: 0, wins: 0 };
        t.matches += x.matches;
        t.wins += (x.winrate / 100) * x.matches;
        tot.set(x.name, t);
      }
      return [...tot.values()].map((t) => Object.assign(t, { winrate: (100 * t.wins) / t.matches })).sort((a, b) => b.matches - a.matches);
    }

    // Alternative reali: oggetti usati davvero da questo eroe ma non nella build
    function alternatives(slug, picked, n) {
      const h = ref.heroes[slug];
      if (!h) return [];
      return popular(h)
        .map((x) => Object.assign(x, { item: item(x.name) }))
        .filter((x) => x.item && !picked.includes(x.item))
        .slice(0, n || 6);
    }

    // Scontro tra due eroi dalle winrate reali (campo `vs`). La pagina di ogni eroe elenca solo 10-23 avversari,
    // quindi si uniscono le due direzioni: "A contro B" dalla pagina di B, e "B contro A" capovolta dalla pagina di A.
    // Le due letture riguardano le STESSE partite: non si sommano, si fa la media pesata e si tiene il campione maggiore.
    // Ritorna null se non c'è nessun dato. winrate = % di vittorie di A contro B (tutti i ruoli, livelli e corsie).
    const slugByName = new Map(ctx.data.heroes.map((h) => [h.data.displayName, h.slug]));
    const nameBySlug = new Map(ctx.data.heroes.map((h) => [h.slug, h.data.displayName]));
    function pairRow(of, against) {
      const h = ref.heroes[of];
      return (h && h.vs && h.vs.find((v) => v.hero === nameBySlug.get(against))) || null;
    }
    function matchup(a, b) {
      if (!ref || !ref.heroes || a === b) return null;
      const dir = pairRow(b, a); // winrate di A contro B, dalla pagina di B
      const rev = pairRow(a, b); // winrate di B contro A, dalla pagina di A
      const parts = [];
      if (dir && dir.matches > 0) parts.push({ wr: dir.winrate, m: dir.matches });
      if (rev && rev.matches > 0) parts.push({ wr: 100 - rev.winrate, m: rev.matches });
      if (!parts.length) return null;
      const m = Math.max(...parts.map((p) => p.m));
      const wr = parts.reduce((n, p) => n + p.wr * p.m, 0) / parts.reduce((n, p) => n + p.m, 0);
      return {
        winrate: Math.round(wr * 10) / 10, wrAdj: smooth(wr, m, 50), matches: m, reliability: matchupReliability(m),
        sides: parts.length, // 2 = letta da entrambe le pagine
      };
    }

    return { has, build, alternatives, matchup, popular: (slug) => (ref.heroes[slug] ? popular(ref.heroes[slug]) : []), version: ref && ref.version };
  }

  const api = { makeMeta, rank, smooth, reliability, matchupReliability, PRIOR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredMeta = api;
})(typeof self !== "undefined" ? self : this);
