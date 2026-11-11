// Motore di consiglio build per Predecessor.
// Nessuna statistica di partite vinte: la build nasce da un modello di combattimento
// costruito sul kit dell'eroe (kit.js, model.js) e dagli effetti di oggetti e perk (effects.js).
(function (root) {
  "use strict";

  const isNode = typeof require !== "undefined" && typeof module !== "undefined";
  const FX = isNode ? require("./effects.js") : root.PredEffects;
  const Kit = isNode ? require("./kit.js") : root.PredKit;
  const Model = isNode ? require("./model.js") : root.PredModel;
  const Meta = isNode ? require("./meta.js") : root.PredMeta;
  // Effetti passivi scritti a mano. PRED_NOFX=1 li disattiva (serve a misurare quanto valgono)
  const ItemFx = isNode ? (process.env.PRED_NOFX ? null : require("./itemfx.js")) : root.PredItemFx;

  const STYLES = {
    balanced: "Bilanciato",
    dps: "Più danno (DPS)",
    tank: "Più tank",
    support: "Più supporto",
  };

  const ROLES = {
    CARRY: "Carry",
    MIDLANE: "Mid",
    OFFLANE: "Offlane",
    JUNGLE: "Jungle",
    SUPPORT: "Supporto",
  };

  const ENEMY_MIX = {
    mixed: { label: "Mista (equilibrata)", phys: 0.5 },
    physical: { label: "Soprattutto danno fisico", phys: 0.8 },
    magical: { label: "Soprattutto danno magico", phys: 0.2 },
  };

  const STAT_LABELS = {
    HEALTH: "Vita",
    BASE_HEALTH_REGENERATION: "Rigenerazione vita",
    MANA: "Mana",
    BASE_MANA_REGENERATION: "Rigenerazione mana",
    PHYSICAL_POWER: "Potenza fisica",
    MAGICAL_POWER: "Potenza magica",
    PHYSICAL_ARMOR: "Armatura fisica",
    MAGICAL_ARMOR: "Armatura magica",
    PHYSICAL_PENETRATION: "Penetrazione fisica",
    PERC_PHYSICAL_PENETRATION: "Penetrazione fisica %",
    MAGICAL_PENETRATION: "Penetrazione magica",
    PERC_MAGICAL_PENETRATION: "Penetrazione magica %",
    ATTACK_SPEED: "Velocità d'attacco",
    CRITICAL_CHANCE: "Probabilità critico",
    ABILITY_HASTE: "Velocità abilità",
    LIFESTEAL: "Furto di vita",
    MAGICAL_LIFESTEAL: "Furto di vita magico",
    OMNIVAMP: "Omnivamp",
    TENACITY: "Tenacia",
    GOLD_PER_SECOND: "Oro al secondo",
    MOVEMENT_SPEED: "Velocità di movimento",
    HEAL_AND_SHIELD_POWER: "Potenza cure e scudi",
  };

  // Etichette favorite per stile e ruolo: servono solo da spareggio, il peso vero è nel modello.
  const STYLE_TAGS = {
    dps: ["OFFENSE", "BURST", "ON_HIT", "DAMAGE_AMP", "SCALING", "SHRED", "CRIT_AMP", "MULTI_KILL", "POKE", "DUELING"],
    tank: ["DEFENSE", "TEAMFIGHT_DURABILITY", "SUSTAINED_DURABILITY", "ANTI_BURST", "ENGAGE", "SCALING_HEALTH", "SLOWING_AURA", "DEFENSIVE_AURA"],
    support: ["HEALING_AND_SHIELDING", "HEALING", "SHIELDING", "UTILITY", "UTILITY_AURA", "DEFENSIVE_AURA", "CLEANSE", "ENGAGE"],
    balanced: ["DUELING", "SUSTAINED_FIGHTING", "SUSTAIN", "TEAMFIGHTING", "SCALING"],
  };
  const ROLE_TAGS = {
    CARRY: ["ON_HIT", "CRIT_AMP", "ATTACK_SPEED", "SCALING", "ANTI_TANK", "MULTI_KILL"],
    MIDLANE: ["BURST", "POKE", "MAGICAL_PENETRATION", "ABILITY_DAMAGE", "REDUCED_COOLDOWNS"],
    OFFLANE: ["DUELING", "SUSTAINED_FIGHTING", "ENGAGE", "SPLITPUSH", "SUSTAIN"],
    JUNGLE: ["BURST", "MOBILITY", "DUELING", "ANTI_TANK"],
    SUPPORT: ["UTILITY", "UTILITY_AURA", "HEALING_AND_SHIELDING", "DEFENSIVE_AURA"],
  };

  const CREST_FOR_CLASS = {
    TANK: "TANK", FIGHTER: "FIGHTER", ASSASSIN: "ASSASSIN", SUPPORT: "SUPPORT",
    SHARPSHOOTER: "SHARPSHOOTER", MAGE: "MAGE", EXECUTIONER: "FIGHTER",
    ENCHANTER: "SUPPORT", WARDEN: "SUPPORT", CATCHER: "SUPPORT",
  };

  // Consumabile suggerito (euristica semplice)
  const TONIC = { physical: "Strength Tonic", magical: "Intellect Tonic", tank: "Protection Tonic", support: "Divine Potion" };

  const EFFECT_SCALE = { dps: 0.03, balanced: 0.035, tank: 0.04, support: 0.09 }; // peso degli effetti testuali rispetto al modello (gli aiuti alla squadra non si vedono nel modello)
  const TAG_BONUS = 0.012;

  function defaultStyle(role) {
    if (role === "SUPPORT") return "support";
    if (role === "CARRY" || role === "MIDLANE") return "dps";
    return "balanced";
  }

  // ref: build reali dalle partite (data/reference). Se manca, il motore ricade sul solo modello.
  // coef: pesi del modello calibrati sulle partite reali (data/modello-pesi.json). undefined = quelli salvati, null = nessuno
  function makeContext(data, ref, coef) {
    const byId = new Map();
    const usable = [];
    const allByName = new Map();
    for (const it of data.items) {
      const d = it.data;
      if (!d) continue;
      byId.set(it.id, it);
      if (!allByName.has(d.displayName) || !d.isHidden) allByName.set(d.displayName, it);
      if (d.isHidden) continue;
      usable.push(it);
    }
    const byName = new Map(usable.map((it) => [it.data.displayName, it]));
    let saved = null;
    if (coef === undefined) {
      if (isNode) { try { saved = require("./data/modello-pesi.json"); } catch (e) { saved = null; } }
      else saved = root.PRED_COEF || null;
    }
    const ctx = { data, byId, byName, allByName, usable, kits: new Map(), meta: null, coef: coef === undefined ? saved : coef };
    if (ref && Meta) ctx.meta = Meta.makeMeta(ref, ctx);
    return ctx;
  }

  function kitOf(ctx, hero) {
    if (!ctx.kits.has(hero.slug)) ctx.kits.set(hero.slug, Kit.parseKit(hero));
    return ctx.kits.get(hero.slug);
  }

  function totalsOf(items, extra) {
    const t = {};
    for (const it of items) for (const s of it.data.stats) t[s.stat] = (t[s.stat] || 0) + s.value;
    if (extra) for (const s of extra) t[s.stat] = (t[s.stat] || 0) + s.value;
    return t;
  }

  function conflicts(it, picked) {
    const mine = new Set([...it.data.blocks, ...it.data.blockedBy].map((x) => x.id));
    return picked.some((p) => mine.has(p.id) || [...p.data.blocks, ...p.data.blockedBy].some((x) => x.id === it.id));
  }

  // I componenti si trovano per nome: gli id in buildsFrom non coincidono con quelli degli oggetti.
  function components(it, ctx) {
    const out = [];
    const seen = new Set();
    (function walk(x, depth) {
      for (const c of x.data.buildsFrom || []) {
        const full = ctx.allByName.get(c.displayName);
        if (!full || seen.has(c.displayName)) continue;
        seen.add(c.displayName);
        out.push({ name: full.data.displayName, price: full.data.price, depth });
        walk(full, depth + 1);
      }
    })(it, 0);
    return out;
  }

  // Costo totale: ricetta + tutti i componenti
  function totalCost(it, ctx) {
    return it.data.price + components(it, ctx).reduce((n, c) => n + c.price, 0);
  }

  // --- Valutazione di un insieme di oggetti -----------------------------------------
  // Tipo di potenza dominante nel kit (rapporti di scaling delle abilità): null se i due sono vicini
  function primaryKind(kit) {
    let ap = 0, ad = 0;
    for (const a of kit.abilities) for (const e of a.entries) { ap += e.sc.AP || 0; ad += e.sc.AD || 0; }
    if (ap > ad * 1.5 && ap > 40) return "magical";
    if (ad > ap * 1.5 && ad > 40) return "physical";
    return null;
  }
  const OFFTYPE_PENALTY = 0.11;

  // Opzioni del modello quando l'avversario è noto: armature, vita e tipo di danno che subiamo sono i suoi
  function vsOpts(vs) {
    return { enemyArmorPhys: vs.armP, enemyArmorMag: vs.armM, enemyHealth: vs.hp, incomingPhys: vs.physShare };
  }

  function makeScorer(ctx, hero, kit, style, role, mixKey, fx, vs) {
    const primary = primaryKind(kit);
    const opts = vs ? vsOpts(vs) : { incomingPhys: (ENEMY_MIX[mixKey] || ENEMY_MIX.mixed).phys };
    const tagsStyle = STYLE_TAGS[style] || [];
    const tagsRole = ROLE_TAGS[role] || [];
    const goldW = role === "SUPPORT" ? 0.06 : 0.012;
    const extraCache = new Map();
    function extraOf(it) {
      if (extraCache.has(it.id)) return extraCache.get(it.id);
      const d = it.data;
      const eff = FX.effectValue(FX.classifyCached("i" + it.id, d.effects.map((e) => e.text).join("\n")), fx.style, fx.dmg, fx.profile);
      let v = Math.min(eff.total, 1.6) * (EFFECT_SCALE[style] || 0.03);
      if (tagsStyle.includes(d.aggressionType)) v += TAG_BONUS;
      if (tagsRole.includes(d.aggressionType)) v += TAG_BONUS * 0.8;
      // Potenza del tipo opposto a quello del kit: l'ibrido sprecato
      if (primary === "magical" && d.stats.some((s) => s.stat === "PHYSICAL_POWER")) v -= OFFTYPE_PENALTY;
      if (primary === "physical" && d.stats.some((s) => s.stat === "MAGICAL_POWER")) v -= OFFTYPE_PENALTY;
      const gps = d.stats.find((s) => s.stat === "GOLD_PER_SECOND");
      if (gps) v += goldW * (gps.value / 0.5);
      const out = { v, eff };
      extraCache.set(it.id, out);
      return out;
    }
    // Caratteristiche numeriche di un oggetto per questo eroe (servono ai coefficienti calibrati sulle partite reali)
    const itemFeat = new Map();
    const styleTagW = FX.STYLE_TAG_WEIGHT[style] || FX.STYLE_TAG_WEIGHT.balanced;
    function featOf(it) {
      if (itemFeat.has(it.id)) return itemFeat.get(it.id);
      const d = it.data;
      const cls = FX.classifyCached("i" + it.id, d.effects.map((e) => e.text).join("\n"));
      const f = {};
      for (const tag of FEAT_TAGS) f["tag_" + tag] = Math.min(FX.effectValue(cls, style, fx.dmg, fx.profile, { [tag]: styleTagW[tag] || 0 }).total, 1.6);
      const x = extraOf(it);
      f.bonus = (tagsStyle.includes(d.aggressionType) ? 1 : 0) + (tagsRole.includes(d.aggressionType) ? 0.8 : 0);
      f.offtype = (primary === "magical" && d.stats.some((s) => s.stat === "PHYSICAL_POWER")) || (primary === "physical" && d.stats.some((s) => s.stat === "MAGICAL_POWER")) ? 1 : 0;
      const gps = d.stats.find((s) => s.stat === "GOLD_PER_SECOND");
      f.gps = gps ? (goldW / 0.012) * (gps.value / 0.5) : 0;
      const txt = effText(ctx, it);
      for (const g of Object.keys(FEAT_GROUPS)) f["g_" + g] = FEAT_GROUPS[g].includes(d.aggressionType) ? (g === "onhit" ? 0.3 + fx.profile.basicDriven : 1) : 0;
      f.antiheal = ANTI_HEAL.test(txt) ? 1 : 0;
      f.pcthp = PCT_HEALTH.test(txt) && /damage/i.test(txt) ? 1 : 0;
      f.cost = totalCost(it, ctx) / 1000;
      f.v = x.v;
      itemFeat.set(it.id, f);
      return f;
    }
    // Vettore delle caratteristiche di un insieme di oggetti: parte fisica del modello (danno, burst, resistenza, utilità)
    // e parte sugli effetti. J = somma dei coefficienti per le caratteristiche.
    function features(items, crestStats, res) {
      const w = Model.STYLE_W[style] || Model.STYLE_W.balanced;
      const melee = kit && kit.base && kit.base.range < 1000 && style !== "support" ? 1.35 : 1;
      const v = { D: w[0] * Math.log(res.D), B: w[0] * Math.log(res.Dburst), E: w[1] * melee * Math.log(res.EHP), U: w[2] * Math.log(res.U), bonus: 0, offtype: 0, gps: 0, antiheal: 0, pcthp: 0, cost: 0 };
      for (const tag of FEAT_TAGS) v["tag_" + tag] = 0;
      for (const g of Object.keys(FEAT_GROUPS)) v["g_" + g] = 0;
      for (const it of items) { const f = featOf(it); for (const k of Object.keys(f)) if (k !== "v") v[k] += f[k]; }
      return v;
    }
    const coef = ctx.coef && ctx.coef.w ? ctx.coef.w : null;
    function score(items, crestStats) {
      const res = Model.evaluate(kit, totalsOf(items, crestStats), Object.assign({}, opts, { fx: ItemFx ? ItemFx.aggregate(items, hero.slug) : null }));
      if (coef) {
        const f = features(items, crestStats, res);
        let J = 0;
        for (const k of Object.keys(f)) J += (coef[k] || 0) * f[k];
        // I coefficienti sono tarati sullo stile tipico del ruolo: per un altro stile si aggiunge lo spostamento che il
        // modello fisico attribuisce al cambio di stile (più difesa per «tank», più danno per «dps»)
        const def = defaultStyle(role);
        if (style !== def) J += STYLE_SHIFT * (Model.objective(res, style, 0, kit) - Model.objective(res, def, 0, kit));
        return { J, res };
      }
      let extra = 0;
      for (const it of items) extra += extraOf(it).v;
      return { J: Model.objective(res, style, extra, kit), res };
    }
    return { opts, score, extraOf, features, featOf, heroSlug: hero.slug };
  }
  const STYLE_SHIFT = 5; // scala dei coefficienti calibrati rispetto alla funzione obiettivo originale (≈ peso di B+E+U)
  const FEAT_TAGS = ["offense", "defense", "sustain", "utility", "mobility"];
  // Famiglie di oggetti dall'etichetta del gioco (aggressionType): aggiungono ciò che il testo degli effetti non dice al modello
  const FEAT_GROUPS = {
    shred: ["PHYSICAL_SHRED", "MAGICAL_SHRED", "ANTI_TANK", "ANTI_SHIELD"],
    burst: ["BURST", "DUELING", "POKE", "ULTIMATE_DAMAGE", "OFFENSE"],
    onhit: ["ON_HIT", "CRIT_AMP", "ON_HIT_AURA"],
    scaling: ["SCALING", "SCALING_MANA", "DAMAGE_AMP", "DAMAGE_OVER_TIME", "CURSED"],
    area: ["AREA_DAMAGE", "MULTI_KILL", "OFFENSIVE_AURA", "SLOWING_SPELLS"],
    defense: ["DEFENSE", "ANTI_BURST", "SPELL_SHIELD", "ANTI_MAGIC", "TEAMFIGHT_DURABILITY", "ANTI_CRIT", "ANTI_DISRUPTION", "CLEANSE", "RESURRECTION"],
    sustain: ["SUSTAIN", "HEALING_AND_SHIELDING", "SHIELDING", "SUSTAINED_FIGHTING", "MANA_REGEN"],
    util: ["MOBILITY", "DEFENSIVE_AURA", "UTILITY", "INCREASED_GOLD", "REDUCED_COOLDOWNS"],
  };

  function optimize(pool, scorer, crestStats, size) {
    const picked = [];
    while (picked.length < size) {
      let best = null;
      for (const it of pool) {
        if (picked.includes(it) || conflicts(it, picked)) continue;
        const s = scorer.score(picked.concat(it), crestStats).J;
        if (!best || s > best.s) best = { it, s };
      }
      if (!best) break;
      picked.push(best.it);
    }
    // Miglioramento: prova a sostituire ogni oggetto con un altro
    let cur = scorer.score(picked, crestStats).J;
    for (let pass = 0; pass < 10; pass++) {
      let improved = false;
      for (let i = 0; i < picked.length; i++) {
        const others = picked.filter((_, k) => k !== i);
        let bestIt = picked[i], bestS = cur;
        for (const it of pool) {
          if (picked.includes(it) || conflicts(it, others)) continue;
          const s = scorer.score(others.concat(it), crestStats).J;
          if (s > bestS + 1e-9) { bestS = s; bestIt = it; }
        }
        if (bestIt !== picked[i]) { picked[i] = bestIt; cur = bestS; improved = true; }
      }
      if (!improved) break;
    }
    return picked;
  }

  function chooseCrest(ctx, hero, scorer, picked, role, style) {
    const wanted = new Set(hero.data.classes.map((c) => CREST_FOR_CLASS[c]).filter(Boolean));
    if (role === "SUPPORT") wanted.add("SUPPORT");
    if (style === "tank") wanted.add("TANK");
    const crests = ctx.usable.filter((i) => i.data.slotType === "CREST" && !i.data.isEvolved);
    let best = null;
    for (const c of crests) {
      let s = scorer.score(picked, c.data.stats).J;
      if (wanted.has(c.data.class)) s += 0.04;
      if (hero.data.classes.includes(c.data.class)) s += 0.02;
      if (!best || s > best.s) best = { c, s };
    }
    return best && best.c;
  }

  // --- Perk: Eternal, comuni, blessing minori, specifici dell'eroe ---------------------
  function perkPools(ctx, hero) {
    const perks = (ctx.data.perks || []).filter((p) => p.data);
    const mine = hero.data.displayName;
    const others = new Set();
    for (const h of ctx.data.heroes) {
      if (h.slug === hero.slug) continue;
      if (h.data.displayName.length >= 4) others.add(h.data.displayName);
      for (const a of h.data.abilities) {
        const n = a.name.replace(/([a-z])([A-Z])/g, "$1 $2");
        if (n.length >= 6) others.add(n);
      }
    }
    const mentionsOther = (text) => {
      for (const o of others) if (new RegExp("\\b" + o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(text)) return true;
      return false;
    };
    const bySlot = (slot) => perks.filter((p) => p.data.slot === slot);
    return {
      hero: perks.filter((p) => p.data.slot === "HERO_SPECIFIC_1" && p.data.heroData && p.data.heroData.displayName === mine),
      eternal: bySlot("ETERNAL_1"),
      common1: bySlot("COMMON_1"),
      common2: bySlot("COMMON_2"),
      blessing1: bySlot("BLESSING_MINOR_1").filter((p) => !mentionsOther(FX.strip(p.data.description))),
      blessing2: bySlot("BLESSING_MINOR_2").filter((p) => !mentionsOther(FX.strip(p.data.description))),
    };
  }

  function scorePerks(list, tags, fx, n) {
    return list
      .map((p) => {
        const cls = FX.classifyCached("p" + p.id, p.data.description);
        const eff = FX.effectValue(cls, fx.style, fx.dmg, fx.profile);
        const ag = p.data.aggressionTypes || [];
        const bonus = ag.some((a) => tags.style.includes(a)) * 0.5 + ag.some((a) => tags.role.includes(a)) * 0.4;
        return { p, score: eff.total + bonus, notes: eff.used };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  function pickPerks(ctx, hero, tags, fx) {
    const pools = perkPools(ctx, hero);
    const view = (r) => r && {
      icon: r.p.data.icon,
      name: r.p.data.displayName,
      text: FX.strip(r.p.data.description).replace(/\s+/g, " ").trim(),
      raw: r.p.data.description,
      category: r.p.data.eternalCategoryData && r.p.data.eternalCategoryData.displayName,
      level: r.p.data.unlockLevel,
      notes: r.notes.slice(0, 1).map((n) => n.tag),
    };
    const one = (list) => view(scorePerks(list, tags, fx, 1)[0]);
    return {
      hero: one(pools.hero),
      eternal: one(pools.eternal),
      eternalAlt: scorePerks(pools.eternal, tags, fx, 3).slice(1).map(view),
      common: [one(pools.common1), one(pools.common2)].filter(Boolean),
      blessings: [one(pools.blessing1), one(pools.blessing2)].filter(Boolean),
    };
  }

  // Augment (perk dell'eroe) ed Eternal scelti dalle partite reali al posto di quelli stimati dal testo
  function applyRealPerks(perks, real) {
    const view = (r) => r && {
      icon: r.perk.data.icon,
      name: r.perk.data.displayName,
      text: FX.strip(r.perk.data.description).replace(/\s+/g, " ").trim(),
      raw: r.perk.data.description,
      category: r.perk.data.eternalCategoryData && r.perk.data.eternalCategoryData.displayName,
      level: r.perk.data.unlockLevel,
      notes: [],
      real: { winrate: r.winrate, matches: r.matches, share: r.share, reliability: Meta.reliability(r.matches) },
    };
    if (real.augment) perks.hero = view(real.augment);
    if (real.eternal) {
      perks.eternal = view(real.eternal);
      perks.eternalAlt = real.eternalAlt.map(view);
    }
    perks.augmentAlt = real.augmentAlt.map(view);
  }

  // --- Spiegazione per oggetto --------------------------------------------------------
  function itemView(it, ctx, scorer, picked, crestStats, why, real) {
    const d = it.data;
    return {
      id: it.id,
      icon: d.icon,
      name: d.displayName,
      price: totalCost(it, ctx),
      recipe: d.price,
      real: real || null,
      tag: d.aggressionType,
      stats: d.stats,
      // Tutto il testo degli effetti dell'oggetto (con i tag di gioco), per mostrarlo tradotto e con i simboli
      effects: d.effects.map((e) => ({ name: e.name, raw: e.text, active: e.active })),
      why: why || [],
      components: components(it, ctx),
    };
  }

  // Quanto ogni statistica dell'oggetto contribuisce alla build (J con e senza quella statistica)
  function whyStats(it, picked, crestStats, scorer) {
    const full = scorer.score(picked, crestStats).J;
    const out = [];
    for (const s of it.data.stats) {
      const t = totalsOf(picked, crestStats);
      t[s.stat] = (t[s.stat] || 0) - s.value;
      const res = Model.evaluate(scorer.kit, t, Object.assign({}, scorer.opts, { fx: ItemFx ? ItemFx.aggregate(picked, scorer.heroSlug) : null }));
      const J = Model.objective(res, scorer.style, 0, scorer.kit);
      const base = Model.objective(scorer.score(picked, crestStats).res, scorer.style, 0, scorer.kit);
      out.push({ stat: s.stat, gain: base - J });
    }
    return out.filter((x) => x.gain > 0.002).sort((a, b) => b.gain - a.gain).slice(0, 3).map((x) => x.stat);
  }

  // --- Oggetto "da situazione" -------------------------------------------------------------
  // In gioco la build non cambia contro l'avversario: di solito si sostituisce UN solo oggetto.
  // Ogni situazione è una regola: quando scatta (on), quali oggetti la risolvono (test) e perché (reason).
  // Per aggiungere un caso basta aggiungere una voce a SITUATIONS: scatta solo se la build non ha già un oggetto di quel tipo.
  const ANTI_HEAL = /Reduce[^.]{0,30}Healing by/i;
  const PCT_HEALTH = /%[^.]{0,30}(?:max(?:imum)?|current)\s+health/i;
  const CLEANSE = /cleanse|remove[^.]{0,40}(?:stun|crowd|control)|immun/i;
  function effText(ctx, it) {
    ctx.fxText = ctx.fxText || new Map();
    if (!ctx.fxText.has(it.id)) ctx.fxText.set(it.id, FX.strip(it.data.effects.map((e) => e.text).join(" ")).replace(/\s+/g, " "));
    return ctx.fxText.get(it.id);
  }
  const hasStat = (it, stats, min) => it.data.stats.some((s) => stats.includes(s.stat) && s.value >= min);
  const HP_TANKY = 4200;
  const healsALot = (vs) => (vs.hs || 0) >= 90 || (vs.lifesteal || 0) >= 20 || (vs.omni || 0) >= 12;
  const PEN = { physical: ["PHYSICAL_PENETRATION", "PERC_PHYSICAL_PENETRATION"], magical: ["MAGICAL_PENETRATION", "PERC_MAGICAL_PENETRATION"] };

  const SITUATIONS = [
    {
      kind: "antiheal",
      on: (vs) => healsALot(vs),
      test: (ctx, it) => ANTI_HEAL.test(effText(ctx, it)),
      reason: () => "recupera molta vita (cure, scudi o furto di vita): l'oggetto riduce le sue cure del 45%",
    },
    {
      kind: "pcthealth",
      on: (vs) => (vs.hp || 0) >= HP_TANKY,
      test: (ctx, it) => { const t = effText(ctx, it); return PCT_HEALTH.test(t) && /\bdeals?\b[^.]*(target|their)/i.test(t) && /damage/i.test(t); },
      reason: (vs) => `ha molta vita (~${Math.round(vs.hp)}): il danno in % sulla vita cresce con la sua salute`,
    },
    {
      kind: "penetration",
      on: (vs, me) => (me.dmg === "physical" ? vs.armP >= 140 : vs.armM >= 120),
      test: (ctx, it, me) => hasStat(it, PEN[me.dmg] || PEN.physical, 10), // 7 di penetrazione (es. Spirit Of Amir) è un dettaglio, non il motivo per cui si compra
      reason: (vs, me) => me.dmg === "physical" ? `ha armatura fisica alta (~${Math.round(vs.armP)}): serve penetrazione fisica` : `ha armatura magica alta (~${Math.round(vs.armM)}): serve penetrazione magica`,
    },
    {
      kind: "tenacity",
      on: (vs) => (vs.hardCc || 0) >= 2,
      test: (ctx, it) => hasStat(it, ["TENACITY"], 1) || CLEANSE.test(effText(ctx, it)),
      reason: (vs) => `ha ${vs.hardCc} abilità di controllo pesante: servono Tenacia o rimozione del controllo`,
    },
    {
      kind: "armor",
      on: (vs) => vs.physShare >= 0.75,
      test: (ctx, it) => hasStat(it, ["PHYSICAL_ARMOR"], 35),
      reason: (vs) => `fa soprattutto danno fisico (~${Math.round(vs.physShare * 100)}%): serve armatura fisica`,
    },
    {
      kind: "magicres",
      on: (vs) => vs.physShare <= 0.25,
      test: (ctx, it) => hasStat(it, ["MAGICAL_ARMOR"], 35),
      reason: (vs) => `fa soprattutto danno magico (~${Math.round((1 - vs.physShare) * 100)}%): serve armatura magica`,
    },
  ];

  // Uso reale degli oggetti dell'eroe nelle partite (nome -> partite e winrate), o null senza dati.
  const SWAP_MIN_USED = 30; // partite minime perché un oggetto sia «usato davvero» da quell'eroe
  const SWAP_MIN_GAIN = 0.01; // guadagno minimo dell'obiettivo del modello perché valga la pena cambiare
  const SWAP_PROTECTED = 2; // i due oggetti più giocati dell'eroe non si tolgono mai
  const IDEA_KINDS = new Set(["penetration", "pcthealth", "antiheal"]); // situazioni in cui un oggetto non usato può essere proposto
  const IDEA_MIN_DAMAGE = 0.05; // danno in più minimo (5%) contro questo avversario perché l'idea valga
  const SWAP_WR_TOL = 3; // punti di winrate corretta che l'oggetto aggiunto può perdere rispetto a quello tolto
  function usageOf(ctx, slug) {
    if (!ctx.meta || !ctx.meta.has(slug)) return null;
    return new Map(ctx.meta.popular(slug).map((x) => [x.name, x]));
  }

  // Cambia al massimo un oggetto, e solo se il modello dice che migliora davvero (SWAP_MIN_GAIN).
  // Due livelli: `swap` pesca solo tra oggetti che l'eroe usa davvero (≥ SWAP_MIN_USED partite) e non toglie mai i suoi
  // oggetti centrali né uno che vince molto di più; `idea` è il miglior oggetto che l'eroe NON usa, valutato solo dal
  // modello: va dichiarato come «da verificare» (può essere un oggetto trascurato dai giocatori, o un errore del modello).
  function situationalSwap(ctx, pool, picked, crestStats, scorer, vs, me, usage) {
    const before = scorer.score(picked, crestStats);
    const matchesOf = (it) => (usage && usage.get(it.data.displayName) ? usage.get(it.data.displayName).matches : 0);
    const protectedSet = usage ? new Set(picked.slice().sort((a, b) => matchesOf(b) - matchesOf(a)).slice(0, SWAP_PROTECTED)) : new Set();
    const hw = usage ? [...usage.values()].reduce((s, x) => s + x.winrate * x.matches, 0) / Math.max(1, [...usage.values()].reduce((s, x) => s + x.matches, 0)) : 50;
    const adj = (x) => Meta.smooth(x.winrate, x.matches, hw);
    let swap = null, idea = null;
    for (const sit of SITUATIONS) {
      if (!sit.on(vs, me)) continue;
      if (picked.some((it) => sit.test(ctx, it, me))) continue; // la build ha già un oggetto di questo tipo
      for (const cand of pool) {
        if (picked.includes(cand) || !sit.test(ctx, cand, me)) continue;
        const info = usage && usage.get(cand.data.displayName);
        const isReal = !usage || (info && info.matches >= SWAP_MIN_USED);
        for (let i = 0; i < picked.length; i++) {
          if (protectedSet.has(picked[i])) continue;
          const others = picked.filter((_, k) => k !== i);
          if (conflicts(cand, others)) continue;
          if (isReal && usage) { // non si toglie un oggetto che nelle partite vince molto di più di quello che entra
            const rem = usage.get(picked[i].data.displayName);
            if (rem && rem.matches >= SWAP_MIN_USED && adj(info) < adj(rem) - SWAP_WR_TOL) continue;
          }
          const after = scorer.score(others.concat(cand), crestStats);
          const gain = after.J - before.J;
          if (gain < SWAP_MIN_GAIN) continue;
          const dD = after.res.D / before.res.D - 1, dE = after.res.EHP / before.res.EHP - 1;
          // Un oggetto che l'eroe non usa si propone solo dove il numero è verificabile: penetrazione e danno in % sulla
          // vita fanno più danno a QUESTO avversario; l'anti-cura non deve costare danno. Le difese sono escluse: il modello
          // le sopravvaluta (Unbroken Will, Warden's Faith, Golem's Gift) e i giocatori le trovano da soli.
          // Una situazione offensiva deve far più danno a questo avversario, anche per gli oggetti che l'eroe usa già
          if ((sit.kind === "penetration" || sit.kind === "pcthealth") && dD < 0.01) continue;
          if (!isReal && !(IDEA_KINDS.has(sit.kind) && dD >= (sit.kind === "antiheal" ? -0.03 : IDEA_MIN_DAMAGE) && dE >= -0.1)) continue;
          const cur = isReal ? swap : idea;
          if (cur && gain <= cur.gain) continue;
          const rec = {
            gain, kind: sit.kind, reason: sit.reason(vs, me), added: cand, removed: picked[i], picked: others.concat(cand),
            effect: { damage: dD, ehp: dE },
            real: info && info.matches > 0 ? { winrate: Math.round(info.winrate * 10) / 10, matches: info.matches, reliability: Meta.reliability(info.matches) } : null,
          };
          if (isReal) swap = rec; else idea = rec;
        }
      }
    }
    if (idea && swap && idea.gain <= swap.gain) idea = null; // l'idea si mostra solo se il modello la vede meglio del cambio già consigliato
    return { swap, idea };
  }
  const swapView = (s) => s && { kind: s.kind, added: s.added.data.displayName, removed: s.removed.data.displayName, reason: s.reason, gain: s.gain, effect: s.effect, real: s.real, icon: s.added.data.icon };

  function recommend(ctx, heroSlug, opts) {
    opts = opts || {};
    const hero = ctx.data.heroes.find((h) => h.slug === heroSlug);
    if (!hero) throw new Error("Eroe non trovato: " + heroSlug);
    const role = opts.role && hero.data.roles.includes(opts.role) ? opts.role : hero.data.roles[0];
    const style = opts.style || defaultStyle(role);
    const mixKey = opts.enemy && ENEMY_MIX[opts.enemy] ? opts.enemy : "mixed";
    const kit = kitOf(ctx, hero);
    const profile = FX.heroProfile(hero);
    profile.basicDriven = Math.min(1, kit.basicEmphasis / 1.3); // dalle valutazioni del gioco, non da una stima sul testo
    Model.evaluate(kit, {}); // imposta il tipo di danno principale dell'eroe
    const dmg = kit.defaultKind || "physical";
    const fx = { style, dmg, profile };
    const vs = opts.vs || null; // statistiche dell'avversario: { armP, armM, hp, physShare, hs, lifesteal, omni }
    // La build base NON dipende dall'avversario: in gioco cambia al massimo un oggetto (anti-cura o danno in % sulla vita).
    const base = makeScorer(ctx, hero, kit, style, role, mixKey, fx, null);
    base.kit = kit;
    base.style = style;
    const scorer = vs ? makeScorer(ctx, hero, kit, style, role, mixKey, fx, vs) : base;
    scorer.kit = kit;
    scorer.style = style;

    const pool = ctx.usable.filter((i) => i.data.slotType === "PASSIVE" && i.data.rarity === "EPIC" && !i.data.isEvolved);
    // Base: le build vincenti delle partite reali (se disponibili per l'eroe). Il modello serve a spiegarle e ad adattarle.
    const real = !opts.model && ctx.meta && ctx.meta.has(heroSlug) ? ctx.meta.build(heroSlug, { style, conflicts }) : null;
    let picked, crest;
    if (real && real.items.length === 6) {
      picked = real.items.slice();
      crest = real.crest.start || real.crest.final;
    } else {
      picked = optimize(pool, base, null, 6);
      crest = chooseCrest(ctx, hero, base, picked, role, style);
      picked = optimize(pool, base, crest ? crest.data.stats : null, 6);
    }
    const crestStats = crest ? crest.data.stats : null;
    const realBy = new Map(real ? real.slots.map((s) => [s.item, s]) : []);
    let swap = null, idea = null;
    if (vs) {
      const sw = situationalSwap(ctx, pool, picked, crestStats, scorer, vs, { dmg }, real ? usageOf(ctx, heroSlug) : null);
      if (sw.swap) picked = sw.swap.picked;
      swap = swapView(sw.swap);
      idea = swapView(sw.idea); // non cambia la build: è solo un suggerimento da verificare
    }

    // Ordine di priorità: contributo di ogni oggetto alla build finale
    const full = scorer.score(picked, crestStats);
    const contrib = (it) => full.J - scorer.score(picked.filter((x) => x !== it), crestStats).J;
    // Con le partite reali l'ordine è quello di acquisto; con il solo modello è il contributo alla build
    const ordered = real ? picked.slice().sort((a, b) => ((realBy.get(a) || { slot: 9 }).slot) - ((realBy.get(b) || { slot: 9 }).slot)) : picked.slice().sort((a, b) => contrib(b) - contrib(a));

    // Alternative: oggetti usati davvero da questo eroe (o, senza dati, i migliori del modello)
    let alternatives;
    if (real) {
      alternatives = ctx.meta.alternatives(heroSlug, picked, 6).map((x) => itemView(x.item, ctx, scorer, picked, crestStats, [], { winrate: x.winrate, matches: x.matches, reliability: Meta.reliability(x.matches) }));
    } else {
      const weakest = ordered[ordered.length - 1];
      const rest = picked.filter((x) => x !== weakest);
      alternatives = pool
        .filter((it) => !picked.includes(it) && !conflicts(it, rest))
        .map((it) => ({ it, J: scorer.score(rest.concat(it), crestStats).J }))
        .sort((a, b) => b.J - a.J)
        .slice(0, 6)
        .map(({ it }) => itemView(it, ctx, scorer, picked, crestStats, []));
    }

    const perks = pickPerks(ctx, hero, { style: STYLE_TAGS[style] || [], role: ROLE_TAGS[role] || [] }, fx);
    if (real) applyRealPerks(perks, real);
    const tonicName = style === "tank" ? TONIC.tank : style === "support" ? TONIC.support : TONIC[dmg];
    const tonic = ctx.byName.get(tonicName);
    const totals = totalsOf(picked, crestStats);
    const sens = Model.sensitivity(kit, totals, Object.assign({}, scorer.opts, { fx: ItemFx ? ItemFx.aggregate(picked, hero.slug) : null }));

    return {
      hero, role, style, damage: dmg, profile, perks, enemy: vs ? "opponent" : mixKey, swap, idea,
      crest: crest && { icon: crest.data.icon, name: crest.data.displayName, cls: crest.data.class, stats: crest.data.stats, effects: crest.data.effects },
      items: ordered.map((it) => {
        const s = realBy.get(it);
        return itemView(it, ctx, scorer, picked, crestStats, whyStats(it, picked, crestStats, scorer), s && { slot: s.slot, winrate: s.winrate, matches: s.matches, share: s.share, time: s.time, reliability: s.reliability });
      }),
      alternatives,
      tonic: tonic && { name: tonic.data.displayName, price: tonic.data.price },
      totals,
      totalPrice: picked.reduce((n, it) => n + totalCost(it, ctx), 0),
      real: real && {
        crestFinal: real.crest.final && { name: real.crest.final.data.displayName, icon: real.crest.final.data.icon, winrate: real.crest.winrate, matches: real.crest.matches, time: real.crest.time, reliability: Meta.reliability(real.crest.matches) },
        skillOrder: real.skillOrder, hero: real.hero, source: real.source,
      },
      analysis: {
        D: full.res.D, Dbasic: full.res.Dbasic, EHP: full.res.EHP, U: full.res.U, aps: full.res.aps,
        hardCc: kit.abilities.filter((x) => Model.ccPower(x.text) >= 0.85).length,
        hp: full.res.hpTotal, armP: full.res.armP, armM: full.res.armM, physShare: full.res.physShare, hs: full.res.hs, cc: full.res.cc,
        abilities: full.res.perAbility, sens,
      },
    };
  }

  // --- Avversario (1 contro 1) e counterpick -------------------------------------------
  // Il modello è lo stesso della build: cambia solo contro chi si combatte. Armature, vita e tipo di danno
  // dell'avversario vengono dalla SUA build consigliata. Non sono statistiche di partite vinte.
  const statsOf = (r) => ({
    armP: r.analysis.armP, armM: r.analysis.armM, hp: r.analysis.hp, physShare: r.analysis.physShare,
    hs: r.analysis.hs, lifesteal: r.totals.LIFESTEAL || 0, omni: r.totals.OMNIVAMP || 0, hardCc: r.analysis.hardCc,
  });

  function heroBySlug(ctx, slug) {
    const h = ctx.data.heroes.find((x) => x.slug === slug);
    if (!h) throw new Error("Eroe non trovato: " + slug);
    return h;
  }

  // Ruolo dell'avversario: lo stesso nostro se lo può giocare (è l'avversario di corsia), altrimenti il suo primo
  function opponentRole(opp, role, wanted) {
    const roles = opp.data.roles.filter((r) => ROLES[r]);
    if (wanted && roles.includes(wanted)) return wanted;
    return roles.includes(role) ? role : roles[0];
  }

  // Scontro 1 contro 1 a build fatte. Tempo per uccidere = vita effettiva / danno al secondo (stima media su un combattimento).
  function duelOf(ctx, a, b) {
    const fxOf = (r) => (ItemFx ? ItemFx.aggregate(r.items.map((i) => i.name), r.hero.slug) : null);
    const ra = Model.evaluate(kitOf(ctx, a.hero), a.totals, Object.assign(vsOpts(statsOf(b)), { fx: fxOf(a) }));
    const rb = Model.evaluate(kitOf(ctx, b.hero), b.totals, Object.assign(vsOpts(statsOf(a)), { fx: fxOf(b) }));
    const ttkB = rb.EHP / ra.D; // secondi che servono a "a" per uccidere "b"
    const ttkA = ra.EHP / rb.D;
    return { ttkB, ttkA, ratio: ttkA / ttkB, dA: ra.D, dB: rb.D, ehpA: ra.EHP, ehpB: rb.EHP };
  }

  // Eroe già scelto: build contro l'avversario, build dell'avversario contro di noi, confronto con la build standard.
  function recommendVs(ctx, heroSlug, oppSlug, opts) {
    opts = opts || {};
    const hero = heroBySlug(ctx, heroSlug);
    const opp = heroBySlug(ctx, oppSlug);
    const role = opts.role && hero.data.roles.includes(opts.role) ? opts.role : hero.data.roles[0];
    const style = opts.style || defaultStyle(role);
    const oppRole = opponentRole(opp, role, opts.oppRole);
    const oppStyle = opts.oppStyle || defaultStyle(oppRole);
    const standard = recommend(ctx, heroSlug, { role, style }); // senza sapere chi si affronta
    const oppFirst = recommend(ctx, oppSlug, { role: oppRole, style: oppStyle, vs: statsOf(standard) });
    const me = recommend(ctx, heroSlug, { role, style, vs: statsOf(oppFirst) });
    const them = recommend(ctx, oppSlug, { role: oppRole, style: oppStyle, vs: statsOf(me) });
    return {
      me, opp: them, standard,
      duel: duelOf(ctx, me, them), // stima del modello (inaffidabile, vedi PROGETTO.md §9.1)
      real: ctx.meta ? ctx.meta.matchup(heroSlug, oppSlug) : undefined, // winrate reale di heroSlug contro oppSlug, o null
      swap: me.swap, // al massimo un oggetto cambia rispetto alla build standard
      idea: me.idea, // oggetto non usato dall'eroe che il modello vede utile: da verificare, non cambia la build
      tips: counterTips(ctx, them, me),
    };
  }

  // Preparazione: la build standard dell'avversario (non sa chi gli metteremo contro)
  function prepareCounter(ctx, oppSlug, opts) {
    opts = opts || {};
    const opp = heroBySlug(ctx, oppSlug);
    const role = opts.role || "MIDLANE";
    const oppRole = opponentRole(opp, role, opts.oppRole);
    const oppStyle = opts.oppStyle || defaultStyle(oppRole);
    const oppBuild = recommend(ctx, oppSlug, { role: oppRole, style: oppStyle });
    const candidates = ctx.data.heroes.filter((h) => h.slug !== oppSlug && h.data.roles.includes(role));
    return { oppSlug, role, style: opts.style || defaultStyle(role), oppRole, oppStyle, oppBuild, candidates };
  }

  function counterpickOne(ctx, base, hero) {
    const build = recommend(ctx, hero.slug, { role: base.role, style: base.style, vs: statsOf(base.oppBuild) });
    return {
      hero, build, duel: duelOf(ctx, build, base.oppBuild),
      real: ctx.meta ? ctx.meta.matchup(hero.slug, base.oppSlug) : undefined, // winrate reale contro l'avversario, o null
    };
  }

  // Con dati reali: prima chi ha dati, per winrate corretta (campioni piccoli corretti verso 50%); chi non ne ha
  // resta in coda in ordine alfabetico, MAI ordinato dal modello (non concorda con la realtà). Senza dati reali
  // (contesto del solo modello, usato dai banchi di prova) resta l'ordine del modello.
  const byAdvantage = (x, y) => {
    if (x.real === undefined && y.real === undefined) return y.duel.ratio - x.duel.ratio;
    if (x.real && y.real) return y.real.wrAdj - x.real.wrAdj || y.real.matches - x.real.matches;
    if (x.real || y.real) return x.real ? -1 : 1;
    return x.hero.data.displayName.localeCompare(y.hero.data.displayName);
  };

  function counterpicks(ctx, oppSlug, opts) {
    const base = prepareCounter(ctx, oppSlug, opts);
    const list = base.candidates.map((h) => counterpickOne(ctx, base, h)).sort(byAdvantage);
    return { base, list };
  }

  // Come contrastare: consigli ricavati dal kit e dalla build dell'avversario (soglie semplici, non verità di gioco)
  function counterTips(ctx, oppRes, meRes) {
    const tips = [];
    const a = oppRes.analysis;
    const kit = kitOf(ctx, oppRes.hero);
    const pct = Math.round(a.physShare * 100);
    if (a.physShare >= 0.65) tips.push(`Il suo danno è soprattutto fisico (~${pct}%): l'armatura fisica rende di più di quella magica.`);
    else if (a.physShare <= 0.35) tips.push(`Il suo danno è soprattutto magico (~${100 - pct}%): l'armatura magica rende di più di quella fisica.`);
    else tips.push(`Il suo danno è misto (~${pct}% fisico): servono entrambe le armature.`);
    const hard = kit.abilities.filter((x) => Model.ccPower(x.text) >= 0.85).map((x) => x.name);
    if (hard.length >= 2) tips.push(`Ha ${hard.length} abilità di controllo pesante (${hard.join(", ")}): la Tenacia vale di più.`);
    else if (hard.length === 1) tips.push(`Ha un controllo pesante (${hard[0]}): gioca attorno a quella ricarica.`);
    if (a.hs >= 90 || oppRes.totals.LIFESTEAL >= 20 || oppRes.totals.OMNIVAMP >= 12) {
      const mine = meRes && meRes.items.find((it) => it.effects.some((e) => ANTI_HEAL.test(FX.strip(e.raw || ""))));
      tips.push(mine
        ? `Recupera molta vita con cure, scudi o furto di vita: ${mine.name} nella tua build riduce già le sue cure, usalo presto.`
        : "Recupera molta vita con cure, scudi o furto di vita: un oggetto anti-cura (famiglia Tainted) è utile.");
    }
    if (a.armP >= 140) tips.push(`Armatura fisica alta (${Math.round(a.armP)}): penetrazione fisica e danno in % sulla vita pesano di più.`);
    if (a.armM >= 120) tips.push(`Armatura magica alta (${Math.round(a.armM)}): penetrazione magica pesa di più.`);
    if (a.hp >= HP_TANKY) tips.push(`Vita molto alta (${Math.round(a.hp)}): un oggetto con danno in % sulla vita massima rende di più.`);
    if (a.hp <= 2400 && a.EHP < 4200) tips.push("È fragile: chi lo raggiunge per primo di solito vince lo scontro.");
    return tips;
  }

  // Per la calibrazione (scripts/calibra-modello.cjs): scorer e insieme di oggetti candidati di un eroe nel suo ruolo
  function scorerFor(ctx, heroSlug, role) {
    const hero = heroBySlug(ctx, heroSlug);
    role = role || hero.data.roles.find((r) => ROLES[r]);
    const style = defaultStyle(role);
    const kit = kitOf(ctx, hero);
    const profile = FX.heroProfile(hero);
    profile.basicDriven = Math.min(1, kit.basicEmphasis / 1.3);
    Model.evaluate(kit, {});
    const fx = { style, dmg: kit.defaultKind || "physical", profile };
    const scorer = makeScorer(ctx, hero, kit, style, role, "mixed", fx, null);
    scorer.kit = kit; scorer.style = style;
    const pool = ctx.usable.filter((i) => i.data.slotType === "PASSIVE" && i.data.rarity === "EPIC" && !i.data.isEvolved);
    return { hero, role, style, scorer, pool, conflicts };
  }

  const api = {
    scorerFor, FEAT_TAGS, FEAT_GROUPS,
    STYLES, ROLES, ENEMY_MIX, STAT_LABELS, REFERENCE: Model.REFERENCE, makeContext, recommend, defaultStyle,
    recommendVs, prepareCounter, counterpickOne, counterpicks, counterTips, duelOf, opponentRole, byAdvantage,
  };
  if (isNode) module.exports = api;
  else root.PredEngine = api;
})(typeof self !== "undefined" ? self : this);
