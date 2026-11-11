// Lettura del kit di un eroe: danno base per rango, scaling, tipo di danno, ricarica,
// valori base al livello 18. Serve al modello di combattimento (model.js).
(function (root) {
  "use strict";

  const KEYS = {
    AbilityPowerText: "AP",
    AttackDamageText: "AD",
    HealthText: "HP",
    ArmorText: "AR",
    MRText: "MR",
    ManaText: "MA",
    CritChanceText: "CR",
    AttackSpeedText: "AS",
  };

  // Trasforma i marcatori del gioco in token leggibili: "[AP 70]", "[HP 6|Target's Bonus Health)]"
  function tokenize(raw) {
    let s = (raw || "").replace(/<img[^>]*>/g, "");
    s = s.replace(/<(AbilityPowerText|AttackDamageText|HealthText|ArmorText|MRText|ManaText|CritChanceText|AttackSpeedText)>\(\+?([\d./\-]+)%([^<]*)<\/>/gi, (m, tag, val, extra) => {
      const k = KEYS[tag] || KEYS[Object.keys(KEYS).find((x) => x.toLowerCase() === tag.toLowerCase())] || "XX";
      const e = (extra || "").replace(/[\])]/g, "").trim();
      return ` [${k} ${val}${e ? "|" + e : ""}] `;
    });
    s = s.replace(/<(?:AbilityPowerText|AttackDamageText|HealthText|ArmorText|MRText|ManaText|CritChanceText|AttackSpeedText)>\)<\/>/gi, " ");
    s = s.replace(/<\/?[A-Za-z_]+[^>]*>|<\/>/g, "");
    return s.replace(/[ \t]+/g, " ");
  }

  const last = (list) => {
    const parts = String(list).split("/");
    return parseFloat(parts[parts.length - 1]);
  };

  const NUM = "(\\d+(?:\\.\\d+)?(?:\\/\\d+(?:\\.\\d+)?)*)";
  const BLOCK = "((?:\\[[A-Z]+ [^\\]]+\\]\\s*)+)";
  const ENTRY_RE = new RegExp(NUM + "\\s*" + BLOCK, "g");
  const PLAIN_RE = new RegExp(NUM + "\\s+(?:bonus |additional |maximum )?(physical|magical|true)\\s+damage", "gi");
  const TARGET_PCT_RE = /(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*%\s*(?:\+[^%]*%\s*)?of\s+the\s+target.s\s+(maximum|max|current|missing|bonus)\s+health/gi;

  function kindAfter(s, idx) {
    const tail = s.slice(idx, idx + 70).toLowerCase();
    const m = tail.match(/^[\s)]*(?:bonus |additional |maximum |total )?(physical|magical|true)\s+damage/);
    if (m) return m[1];
    if (/^[\s)]*(?:\(?\w+\s*)?(shield|barrier)/.test(tail) || /^[\s)]*\w*\s*shield/.test(tail)) return "shield";
    if (/^[\s)]*(?:health|heal|mana)\b/.test(tail)) return /^[\s)]*mana/.test(tail) ? "mana" : "heal";
    // "danno" senza tipo scritto: il tipo si deduce poi dallo scaling
    if (/^[\s)]*(?:\w+\s+){0,2}damage/.test(tail) || /^[\s)]*\{\w+\}/.test(tail)) return "damage";
    return null;
  }

  // Deduce fisico/magico dallo scaling quando il testo non lo dice.
  function inferKind(kind, sc, text) {
    if (kind !== "damage" && kind !== null) return kind;
    if (kind === null) return null;
    if (sc.AP && !sc.AD) return "magical";
    if (sc.AD && !sc.AP) return "physical";
    if (sc.AP && sc.AD) return sc.AP >= sc.AD ? "magical" : "physical";
    return "damage";
  }

  // Quale tipo di potenza scala questa voce: AP, AD, HP ... con valore massimo
  function parseScalings(block) {
    const out = {};
    for (const m of block.matchAll(/\[([A-Z]+) ([\d./\-]+)(?:\|([^\]]*))?\]/g)) {
      const v = last(m[2]);
      const key = m[1];
      const extra = (m[3] || "").toLowerCase();
      out[key] = (out[key] || 0) + v;
      if (key === "HP" && /target|enem/.test(extra)) {
        out.HPT = (out.HPT || 0) + v;
        out.HP -= v;
      }
    }
    return out;
  }

  function parseAbility(a) {
    const s = tokenize(a.menuDescription || "");
    const entries = [];
    const covered = [];
    for (const m of s.matchAll(ENTRY_RE)) {
      const idx = m.index + m[0].length;
      const kind = kindAfter(s, idx);
      const before = s.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
      if (/monster|minion|camp/.test(before) && kind !== "heal") continue;
      const sc = parseScalings(m[2]);
      let k0 = kind;
      if (k0 === null && (sc.AP || sc.AD) && /damage/.test(s.slice(idx, idx + 110).toLowerCase())) k0 = "damage";
      entries.push({ base: last(m[1]), kind: inferKind(k0, sc), sc, text: m[0].trim() });
      covered.push([m.index, idx]);
    }
    // Voci con solo scaling e nessun numero base ("Clones deal [AD 12] physical damage")
    for (const m of s.matchAll(new RegExp(BLOCK, "g"))) {
      if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue;
      const idx = m.index + m[0].length;
      const kind = kindAfter(s, idx);
      if (!kind || kind === "mana") continue;
      const before = s.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
      if (/monster|minion|camp/.test(before) && kind !== "heal") continue;
      const sc = parseScalings(m[1]);
      entries.push({ base: 0, kind: inferKind(kind, sc), sc, text: m[0].trim() });
      covered.push([m.index, idx]);
    }
    // Scudi e danni in percentuale sulla propria salute massima ("shields himself for 7% of his maximum health")
    const selfPct = [];
    for (const m of s.matchAll(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)\s*%\s*of\s+(?:his|her|its|their|your)\s+(maximum|max|bonus|missing|current)\s+health/gi)) {
      const before = s.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
      const kind = /shield|barrier/.test(before) ? "shield" : /heal|restor/.test(before) ? "heal" : /damage|deal/.test(before) ? "damage" : "other";
      selfPct.push({ pct: last(m[1]), of: m[2].toLowerCase(), kind });
    }
    for (const m of s.matchAll(PLAIN_RE)) {
      if (covered.some(([a, b]) => m.index >= a && m.index <= b)) continue;
      const before = s.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
      if (/monster|minion|camp/.test(before)) continue;
      entries.push({ base: last(m[1]), kind: m[2].toLowerCase(), sc: {}, text: m[0] });
    }
    const pct = [];
    for (const m of s.matchAll(TARGET_PCT_RE)) {
      const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
      const k = tail.match(/(physical|magical|true)/);
      pct.push({ pct: last(m[1]), of: m[2].toLowerCase(), kind: k ? k[1] : "magical" });
    }
    return { entries, pct, selfPct, text: s };
  }

  // Somma i valori di un attributo "base + incremento per livello" al livello 18.
  function attrAt(attrs, stat, level) {
    const a = attrs.find((x) => x.stat === stat);
    if (!a) return 0;
    let v = a.values[0] || 0;
    for (let i = 1; i < Math.min(level, a.values.length); i++) v += a.values[i];
    return v;
  }

  function baseStats(hero, level) {
    const at = hero.data.attributes || [];
    const get = (st) => attrAt(at, st, level);
    const val0 = (st) => (at.find((x) => x.stat === st) || { values: [0] }).values[0];
    return {
      health: get("MAX_HEALTH") || get("HEALTH"),
      armorPhys: get("BASIC_ARMOR"),
      armorMag: get("ABILITY_ARMOR"),
      damage: get("DAMAGE"),
      mana: get("MAX_MANA") || get("MANA"),
      manaRegen: get("MANA_REGEN"),
      healthRegen: get("HEALTH_REGEN"),
      attackSpeed: get("ATTACK_SPEED"),
      attackSpeedBase: val0("ATTACK_SPEED"),
      attackTime: val0("BASIC_ATTACK_TIME") || 1,
      range: val0("ATTACK_RANGE"),
      moveSpeed: val0("MOVEMENT_SPEED"),
      cleave: val0("CLEAVE"),
    };
  }

  function parseKit(hero) {
    const kit = { abilities: [], basic: null, passive: null };
    for (const a of hero.data.abilities) {
      const p = parseAbility(a);
      const cd = (a.cooldown || []).length ? a.cooldown[a.cooldown.length - 1] : 0;
      const cost = (a.cost || []).length ? a.cost[a.cost.length - 1] : 0;
      const obj = { key: a.key, name: a.name, cd, cost, ...p, raw: a.menuDescription || "" };
      if (a.key === "BASIC") kit.basic = obj;
      else if (a.key === "PASSIVE") kit.passive = obj;
      else kit.abilities.push(obj);
    }
    kit.base = baseStats(hero, 18);
    // Valutazioni del gioco: potenza degli attacchi base (attackPower) e delle abilità (abilityPower)
    const ma = hero.data.mainAttributes || { attackPower: 5, abilityPower: 5 };
    kit.basicEmphasis = Math.max(0.15, Math.min(1.3, (2 * ma.attackPower) / Math.max(1, ma.attackPower + ma.abilityPower)));
    return kit;
  }

  const api = { tokenize, parseAbility, parseKit, baseStats, attrAt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredKit = api;
})(typeof self !== "undefined" ? self : this);
