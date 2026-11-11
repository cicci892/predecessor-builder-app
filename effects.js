// Lettura dei testi di abilità, effetti degli oggetti e perk.
// Trasforma il testo del gioco in "tag di valore" (attacco, difesa, cure, utilità, ...)
// con una grandezza e un fattore di condizione. Sono regole euristiche, non statistiche
// di vittoria: il valore reale di un effetto condizionale resta una stima.
(function (root) {
  "use strict";

  const strip = (s) =>
    (s || "").replace(/<img[^>]*>/g, "").replace(/<\/?[A-Za-z_]+[^>]*>|<\/>/g, "").replace(/[ \t]+/g, " ");

  const TAG_LABELS = {
    offense: "danno",
    defense: "difesa",
    sustain: "cure/scudi",
    utility: "controllo/utilità",
    mobility: "mobilità",
    economy: "oro/esperienza",
    mana: "mana",
  };

  // --- Classificazione di una frase -------------------------------------------------
  const RULES = [
    ["defense", /(armor|max(imum)? health|damage reduction|less damage|reduced damage|damage taken|tenacity|resist|invulnerab|immun|size)/],
    ["sustain", /(heal|restore|lifesteal|omnivamp|regenerat|shield|barrier|health on|missing health)/],
    ["offense", /(damage|physical power|magical power|attack speed|penetration|shred|critical|on-hit|true damage|power|execute|cooldown|ability haste)/],
    ["utility", /(slow|stun|root|knock|pull|silence|disarm|cripple|vision|aura|allies|ally|teammate|debuff|mark)/],
    ["mobility", /(movement speed|dash|blink|sprint|leap|speed boost)/],
    ["economy", /(gold|experience|\bxp\b|minion|monster|camp|jungle|farm)/],
    ["mana", /(mana)/],
  ];
  const COND = /\b(when|while|after|if|upon|below|above|once|each time|every|for \d|stacks?|marked|against)\b/;

  function sentences(raw) {
    return raw
      .split(/\n+|•|(?<=[.!?])\s+(?=[A-Z])/)
      .map((x) => x.trim())
      .filter((x) => x.length > 3);
  }

  // Ritorna { tags:{tag:valore}, notes:[stringhe leggibili], ap, ad }
  function classify(rawText) {
    const out = { tags: {}, notes: [], ap: 0, ad: 0 };
    for (const sentRaw of sentences(rawText || "")) {
      const s = strip(sentRaw);
      const low = s.toLowerCase();
      if (/^restriction|^does not apply|^activations/.test(low) || /:\s*$/.test(low)) continue;
      const ap = /AbilityPower/i.test(sentRaw);
      const ad = /AttackDamage/i.test(sentRaw);
      const hp = /HealthText>\(\+/.test(sentRaw) || /(bonus|max(imum)?) health\)/i.test(s);
      if (ap) out.ap++;
      if (ad) out.ad++;
      const pcts = [...low.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
      const mag = pcts.length ? Math.max(0.3, Math.min(2, Math.max(...pcts) / 12)) : 0.8;
      const cond = COND.test(low) ? 0.6 : 1;
      const hits = [];
      if (/item stats/.test(low)) {
        hits.push("offense", "defense");
      } else {
        for (const [tag, re] of RULES) {
          if (re.test(low)) hits.push(tag);
          if (hits.length >= 2) break;
        }
      }
      for (const tag of hits) {
        const v = mag * cond;
        out.tags[tag] = (out.tags[tag] || 0) + v;
        out.notes.push({ tag, cond: cond < 1, text: s.replace(/s+/g, " ").trim(), ap, ad, hp });
      }
    }
    return out;
  }

  // --- Profilo dell'eroe dalle abilità ---------------------------------------------
  function ratios(raw) {
    let ap = 0, ad = 0;
    for (const m of (raw || "").matchAll(/<AbilityPowerText>\(\+([\d./]+)%/g)) ap += parseFloat(m[1].split("/").pop());
    for (const m of (raw || "").matchAll(/<AttackDamageText>\(\+([\d./]+)%/g)) ad += parseFloat(m[1].split("/").pop());
    return { ap, ad };
  }

  const CC_RE = /(stun|knock|root|silenc|pull|taunt|fear|sleep|suppress|slow)/gi;

  function heroProfile(hero) {
    const p = { healthSelf: 0, healthTarget: 0, apRatio: 0, adRatio: 0, basicDriven: 0, cc: 0, mobility: 0, heal: 0, shield: 0, abilityCount: 0, attacks: 0 };
    for (const a of hero.data.abilities) {
      const raw = a.menuDescription || "";
      const txt = strip(raw);
      // Scaling con la salute: propria (scudi, danno su salute massima) o del bersaglio (% salute nemica)
      for (const m of raw.matchAll(/<HealthText>\(\+([\d./]+)%([^]{0,90})/g)) {
        const v = parseFloat(m[1].split("/").pop());
        const tail = strip(m[2]).toLowerCase().slice(0, 45);
        if (/target|enem/.test(tail)) p.healthTarget += v; else p.healthSelf += v;
      }
      for (const m of txt.matchAll(/(\d+(?:\.\d+)?)\s*%\s*of\s+(?:his|her|its|their|your)\s+(?:maximum|max|bonus)\s+health/gi)) p.healthSelf += parseFloat(m[1]);
      for (const m of txt.matchAll(/(\d+(?:\.\d+)?(?:\/[\d.]+)*)\s*%\s*of\s+the\s+target.s\s+(?:maximum|max|bonus)\s+health/gi)) p.healthTarget += parseFloat(m[1].split("/").pop());
      if (a.key === "BASIC" || a.key === "PASSIVE") {
        if (/basic attack/i.test(txt) && a.key === "PASSIVE") p.attacks++;
        continue;
      }
      const r = ratios(raw);
      p.apRatio += r.ap;
      p.adRatio += r.ad;
      p.abilityCount++;
      p.cc += (txt.match(CC_RE) || []).length;
      if (/(dash|blink|leap|charge|teleport)/i.test(txt)) p.mobility++;
      if (/\bheal/i.test(txt)) p.heal++;
      if (/\bshield|barrier/i.test(txt)) p.shield++;
      p.attacks += (txt.match(/basic attack|on-hit|attack speed/gi) || []).length;
    }
    p.basicDriven = hero.data.classes.includes("SHARPSHOOTER") ? 1 : Math.min(1, p.attacks / 4);
    p.abilityDriven = Math.min(1, (p.apRatio + p.adRatio) / 450);
    p.healthDriven = Math.min(1, p.healthSelf / 20);
    return p;
  }

  // Tipo di danno più probabile, dallo scaling delle abilità; se ambiguo usa gli attributi.
  function damageFromProfile(p, hero) {
    if (p.apRatio > p.adRatio * 1.5 && p.apRatio > 60) return "magical";
    if (p.adRatio > p.apRatio * 1.5 && p.adRatio > 60) return "physical";
    return null;
  }

  // --- Valore di un effetto per uno stile ------------------------------------------
  const STYLE_TAG_WEIGHT = {
    dps: { offense: 1, defense: 0.15, sustain: 0.35, utility: 0.2, mobility: 0.3, economy: 0.1, mana: 0.05 },
    tank: { offense: 0.2, defense: 1, sustain: 0.6, utility: 0.4, mobility: 0.2, economy: 0.05, mana: 0.05 },
    support: { offense: 0.15, defense: 0.4, sustain: 0.8, utility: 1, mobility: 0.4, economy: 0.6, mana: 0.3 },
  };
  STYLE_TAG_WEIGHT.balanced = {};
  for (const k of Object.keys(STYLE_TAG_WEIGHT.dps))
    STYLE_TAG_WEIGHT.balanced[k] = (STYLE_TAG_WEIGHT.dps[k] + STYLE_TAG_WEIGHT.tank[k]) / 2;

  const cache = new Map();
  function classifyCached(key, text) {
    if (!cache.has(key)) cache.set(key, classify(text));
    return cache.get(key);
  }

  // style: dps|tank|support|balanced; dmg: physical|magical
  // wOverride: pesi per tag al posto di quelli dello stile (serve a separare il contributo di ogni tag)
  function effectValue(cls, style, dmg, profile, wOverride) {
    const w = wOverride || STYLE_TAG_WEIGHT[style];
    let total = 0;
    const used = [];
    for (const n of cls.notes) {
      let v = w[n.tag] || 0;
      if (n.tag === "offense") {
        if (dmg === "physical" && n.ap && !n.ad) v *= 0.15;
        if (dmg === "magical" && n.ad && !n.ap) v *= 0.15;
        if (profile && /attack speed|on-hit|basic attack/i.test(n.text)) v *= 0.4 + 1.2 * profile.basicDriven;
        if (profile && /cooldown|ability haste/i.test(n.text)) v *= 0.4 + 1.1 * profile.abilityDriven;
        if (profile && n.hp) v *= 0.35 + 1.3 * profile.healthDriven;
      }
      if (profile && n.tag === "utility" && profile.cc >= 6) v *= 1.15;
      if (profile && n.tag === "mobility" && profile.mobility >= 2) v *= 0.7;
      const pct = [...n.text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
      const mag = pct.length ? Math.max(0.3, Math.min(2, Math.max(...pct) / 12)) : 0.8;
      const part = v * mag * (n.cond ? 0.6 : 1);
      if (part > 0.05) used.push({ ...n, part });
      total += part;
    }
    return { total: Math.min(total, 3), used: used.sort((a, b) => b.part - a.part) };
  }

  const api = { sentences, classify, classifyCached, effectValue, heroProfile, damageFromProfile, strip, TAG_LABELS, STYLE_TAG_WEIGHT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredEffects = api;
})(typeof self !== "undefined" ? self : this);
