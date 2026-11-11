// Modello di combattimento: dato un eroe (kit.js) e le statistiche totali di una build
// calcola danno al secondo (D), resistenza effettiva (EHP) e utilità di squadra (U).
// Il valore di ogni statistica non è deciso a mano: segue da come è fatto il kit.
// Esempio: un eroe con danno fisso o in % sulla salute nemica guadagna più dalla penetrazione
// che dalla potenza; uno con grandi rapporti di scaling guadagna più dalla potenza.
(function (root) {
  "use strict";

  const Kit = typeof require !== "undefined" && typeof module !== "undefined" ? require("./kit.js") : root.PredKit;

  // Ipotesi del modello (fine partita, livello 18). Sono stime, non dati del gioco.
  const ASSUME = {
    enemyArmorPhys: 95,
    enemyArmorMag: 75,
    enemyHealth: 3200,
    critMult: 1.75,
    fightSec: 12, // durata di un combattimento tipico
    burstSec: 3, // finestra di apertura (combo) per il danno di burst
    basicUptimeMelee: 0.6, // quota del tempo in cui un eroe in mischia riesce ad attaccare
    basicUptimeRanged: 0.75,
    manaWindow: 30,
    incomingPhys: 0.5, // quota di danno fisico subito (cambia con la squadra nemica)
    ccExposure: 0.12, // frazione di combattimento passata sotto controllo di massa
  };

  const CC_WEIGHTS = [
    [/stun|suppress|knock(?:s|ed|ing)? up|taunt|fear|sleep|silenc|polymorph/i, 1],
    [/knock(?:s|ed|ing)? back|pull|root|immobili[sz]|snare|ground/i, 0.85],
    [/slow/i, 0.35],
  ];

  const SHRED_UPTIME = 0.7; // media dei stack di riduzione armatura in uno scontro (si accumulano colpo dopo colpo)
  const NOFX = { apMult: 0, bonusAD: 0, bonusAP: 0, ampAll: 0, ampAbil: 0, ignoreP: 0, ignoreM: 0, shredP: 0, shredM: 0, critDmg: 0, cdFlat: 0, onHit: [], empowered: [], perCast: [], periodic: [], dpsPct: [], shield: [], heal: [], cast: [], healFromDmg: 0, omnivamp: 0, rebirth: false, bonusAS: 0, bonusCrit: 0, bonusArmP: 0, bonusArmM: 0, armMultP: 0, armMultM: 0, dr: 0, ampUlt: 0, ultHaste: 0, cdPct: 0, bonusAH: 0, basicMult: 1, apsMult: 1 };
  const mitig = (armor) => 100 / (100 + Math.max(0, armor));
  const pctOfMax = { maximum: 1, max: 1, bonus: 0.4, current: 0.7, missing: 0.4 };

  // Pesi per stile (offesa, difesa, utilità) sulla funzione obiettivo J.
  const STYLE_W = {
    dps: [1.0, 0.3, 0.1],
    balanced: [0.6, 0.9, 0.2],
    tank: [0.3, 1.0, 0.25],
    support: [0.25, 0.5, 1.0],
  };

  function ccPower(text) {
    let best = 0;
    for (const [re, w] of CC_WEIGHTS) if (re.test(text)) best = Math.max(best, w);
    return best;
  }

  function heroDefaultKind(kit) {
    let ap = 0, ad = 0;
    for (const a of kit.abilities) for (const e of a.entries) { ap += e.sc.AP || 0; ad += e.sc.AD || 0; }
    return ap > ad ? "magical" : "physical";
  }

  // Calcola D, EHP, U per un insieme di statistiche totali (oggetti + cristallo).
  function evaluate(kit, totals, opts) {
    const o = Object.assign({}, ASSUME, opts || {});
    const B = kit.base;
    const T = (s) => totals[s] || 0;
    const defKind = kit.defaultKind || (kit.defaultKind = heroDefaultKind(kit));

    const F = o.fx || NOFX; // effetti passivi scritti a mano (itemfx.js)
    const AD = B.damage + T("PHYSICAL_POWER") + F.bonusAD;
    const AP = (T("MAGICAL_POWER") + F.bonusAP) * (1 + F.apMult);
    const hpTotal = B.health + T("HEALTH");
    const armP = (B.armorPhys + T("PHYSICAL_ARMOR") + F.bonusArmP) * (1 + F.armMultP);
    const armM = (B.armorMag + T("MAGICAL_ARMOR") + F.bonusArmM) * (1 + F.armMultM);
    const AH = T("ABILITY_HASTE") + F.bonusAH;
    const penP = Math.max(0, Math.min(1, T("PERC_PHYSICAL_PENETRATION") / 100));
    const penM = Math.max(0, Math.min(1, T("PERC_MAGICAL_PENETRATION") / 100));

    const effArmor = (kind) => {
      // ordine di gioco: riduzione (shred), poi % ignorata/penetrazione %, poi penetrazione piatta
      if (kind === "physical") return Math.max(0, o.enemyArmorPhys * (1 - F.shredP * SHRED_UPTIME) * (1 - penP) * (1 - F.ignoreP) - T("PHYSICAL_PENETRATION"));
      return Math.max(0, o.enemyArmorMag * (1 - F.shredM * SHRED_UPTIME) * (1 - penM) * (1 - F.ignoreM) - T("MAGICAL_PENETRATION"));
    };
    const m = (kind) => (kind === "true" ? 1 : mitig(effArmor(kind)));

    const entryRaw = (e) => {
      const sc = e.sc || {};
      return (
        e.base +
        ((sc.AD || 0) / 100) * AD +
        ((sc.AP || 0) / 100) * AP +
        ((sc.HP || 0) / 100) * hpTotal +
        ((sc.AR || 0) / 100) * (armP - B.armorPhys) +
        ((sc.MR || 0) / 100) * (armM - B.armorMag) +
        ((sc.HPT || 0) / 100) * o.enemyHealth
      );
    };
    const kindOf = (e) => (e.kind === "damage" || !e.kind ? defKind : e.kind);

    // --- Attacco base -------------------------------------------------------
    const aps = Math.max(0.2, (B.attackSpeed + T("ATTACK_SPEED") + F.bonusAS) / 100 / (B.attackTime || 1) * F.apsMult);
    let basicDmg = 0;
    const be = kit.basic ? kit.basic.entries.filter((e) => ["physical", "magical", "true", "damage"].includes(e.kind)) : [];
    if (be.length) {
      for (const e of be) basicDmg += entryRaw(e) * m(kindOf(e));
      basicDmg /= be.length;
    } else {
      basicDmg = AD * m("physical");
    }
    basicDmg *= F.basicMult;
    const crit = Math.min(100, T("CRITICAL_CHANCE") + F.bonusCrit) / 100;
    const uptime = B.range >= 1000 ? o.basicUptimeRanged : o.basicUptimeMelee;
    // Quota di danno fisico/magico/vero (prima delle armature): serve a sapere cosa subisce chi ci affronta
    const acc = { physical: 0, magical: 0, true: 0 };
    if (be.length) for (const e of be) acc[kindOf(e)] = (acc[kindOf(e)] || 0) + (entryRaw(e) / be.length) * aps * uptime;
    else acc.physical += AD * aps * uptime;
    const rawFx = (h) => (h.flat || 0) + (h.ad || 0) * AD + (h.ap || 0) * AP + (h.curHp || 0) * o.enemyHealth * 0.75 + (h.maxHp || 0) * o.enemyHealth;
    const ranged = B.range >= 1000;
    let onHit = 0, empPS = 0;
    for (const h of F.onHit) onHit += Math.max(h.min || 0, rawFx(h)) * (ranged ? h.ranged || 1 : 1) * (h.mult || 1) * m(h.kind || "physical");
    for (const h of F.empowered) empPS += Math.min(rawFx(h) * m(h.kind || "physical") / h.every, aps * uptime * rawFx(h) * m(h.kind || "physical"));
    const Dbasic = (aps * basicDmg * (1 + crit * (o.critMult + F.critDmg - 1)) * uptime * (kit.basicEmphasis || 1) + aps * uptime * onHit + empPS) * (1 + F.ampAll);

    // --- Abilità: danno, cure/scudi, controllo, mana ------------------------------
    let Dabil = 0, hs = 0, cc = 0, manaPerSec = 0, burstAb = 0;
    const hsMul = 1 + T("HEAL_AND_SHIELD_POWER") / 100;
    const perAbility = [];
    for (const a of kit.abilities) {
      if (!a.cd) continue;
      const isUlt = /ULT/i.test(a.key);
      const cdBase = isUlt ? a.cd : Math.max(a.cd * 0.5, (a.cd - F.cdFlat) * (1 - F.cdPct));
      const cdEff = (cdBase * 100) / (100 + AH + (isUlt ? F.ultHaste : 0));
      let dmg = 0, heal = 0;
      const rawA = [];
      for (const e of a.entries) {
        const raw = entryRaw(e);
        if (["physical", "magical", "true", "damage"].includes(e.kind)) { dmg += raw * m(kindOf(e)); rawA.push([kindOf(e), raw]); }
        else if (e.kind === "shield" || e.kind === "heal") heal += raw * hsMul;
      }
      for (const p of a.pct) {
        const k = p.kind === "damage" ? defKind : p.kind;
        const raw = (p.pct / 100) * o.enemyHealth * (pctOfMax[p.of] || 0.6);
        dmg += raw * m(k);
        rawA.push([k, raw]);
      }
      for (const p of a.selfPct) {
        const v = (p.pct / 100) * hpTotal * (pctOfMax[p.of] || 0.6);
        if (p.kind === "shield" || p.kind === "heal") heal += v * hsMul;
      }
      // Lanci in un combattimento: il primo sempre, poi uno ogni ricarica (con un margine per animazioni e posizionamento)
      if (dmg > 0) for (const h of F.perCast) dmg += rawFx(h) * m(h.kind || "physical"); // effetti a ogni abilità che colpisce
      dmg *= (1 + F.ampAbil) * (1 + F.ampAll) * (isUlt ? 1 + F.ampUlt : 1);
      burstAb += dmg; // combo di apertura: ogni abilità una volta sola
      const uses = 1 + (0.9 * (o.fightSec - 1)) / cdEff;
      for (const [k, raw] of rawA) acc[k] = (acc[k] || 0) + (raw * uses) / o.fightSec;
      const rate = (dmg * uses) / o.fightSec;
      Dabil += rate;
      hs += (heal * uses) / o.fightSec;
      cc += (ccPower(a.text) * uses) / o.fightSec;
      manaPerSec += (a.cost || 0) / cdEff;
      perAbility.push({ key: a.key, name: a.name, rate, cd: cdEff });
    }
    const manaPool = B.mana + T("MANA");
    const manaRegen = B.manaRegen * (1 + T("BASE_MANA_REGENERATION") / 100);
    const supply = manaPool + manaRegen * o.manaWindow;
    const need = manaPerSec * o.manaWindow;
    const manaFactor = need > 0 ? Math.max(0.5, Math.min(1, supply / need)) : 1;
    // Danno periodico e in % sulla vita (itemfx.js): ogni N secondi, oppure continuo
    let Dextra = 0, burstExtra = 0;
    for (const h of F.periodic) {
      const v = rawFx(h) * m(h.kind || "physical") * (h.cond || 1);
      Dextra += v / h.every;
      burstExtra += v * (h.every <= 8 ? 1 : 0.5);
    }
    for (const h of F.dpsPct) {
      const v = h.pct * o.enemyHealth * m(h.kind || "magical") * (h.cond || 1);
      Dextra += v;
      burstExtra += v * o.burstSec;
    }
    // Abilità scritte a mano (eroi con abilità che il kit non legge): la prima volta sempre, poi a ogni ricarica
    for (const h of F.cast) {
      const v = rawFx(h) * m(h.kind || "physical") * (h.mult || 1) * (1 + F.ampAbil);
      const uses = 1 + (0.9 * (o.fightSec - 1)) / ((h.cd * 100) / (100 + AH));
      Dextra += (v * uses) / o.fightSec;
      burstExtra += v;
    }
    Dextra *= 1 + F.ampAll;
    burstExtra *= 1 + F.ampAll;
    const D = Dbasic + Dabil * manaFactor + Dextra;
    // Danno al secondo nei primi BURST_SEC secondi (apertura): abilità tutte una volta + attacchi base. Chi uccide in fretta
    // conta più della media su 12 s: la media sottostima i burst e premia le abilità con ricarica corta.
    const Dburst = Dbasic + (burstAb * manaFactor + burstExtra) / o.burstSec;

    // --- Resistenza ---------------------------------------------------------
    const mixMit = o.incomingPhys * mitig(armP) + (1 - o.incomingPhys) * mitig(armM);
    const regen = B.healthRegen * (1 + T("BASE_HEALTH_REGENERATION") / 100);
    const healFight =
      (T("LIFESTEAL") / 100) * Dbasic * 0.9 +
      (T("OMNIVAMP") / 100 + F.omnivamp) * D + F.healFromDmg * D +
      (T("MAGICAL_LIFESTEAL") / 100) * Dabil * 0.9 +
      regen;
    let passiveShield = 0;
    if (kit.passive) for (const p of kit.passive.selfPct) if (p.kind === "shield") passiveShield += (p.pct / 100) * hpTotal * (pctOfMax[p.of] || 0.6);
    // Scudi, cure periodiche e resurrezione degli oggetti, quante volte ci stanno nello scontro
    let fxPool = 0;
    const times = (every) => Math.floor((o.fightSec - 1) / (every || 99)) + 1;
    for (const s of F.shield) fxPool += times(s.every) * ((s.flat || 0) + (s.hp || 0) * hpTotal + (s.ap || 0) * AP);
    for (const h of F.heal) fxPool += times(h.every) * ((h.flat || 0) + (h.hp || 0) * hpTotal) * 0.5;
    if (F.rebirth) fxPool += 0.5 * B.health * 0.7;
    const pool = hpTotal + passiveShield + fxPool + healFight * o.fightSec * 0.5;
    const tenRed = T("TENACITY") / (T("TENACITY") + 100);
    const EHP = (pool / mixMit) * (1 + o.ccExposure * tenRed) / (1 - F.dr);

    // --- Utilità ------------------------------------------------------------
    const U = Math.max(1, hs + 150 * cc);

    const accTot = acc.physical + acc.magical + acc.true;
    const physShare = accTot > 0 ? (acc.physical + 0.5 * acc.true) / accTot : 0.5;
    return { D, Dburst, Dbasic, Dabil, EHP, U, aps, basicDmg, hpTotal, armP, armM, manaFactor, hs, cc, perAbility, mixMit, m, physShare };
  }

  function objective(res, style, extra, kit) {
    const w = STYLE_W[style] || STYLE_W.balanced;
    // Chi combatte in mischia deve sopravvivere in prima linea: più peso alla resistenza
    const melee = kit && kit.base && kit.base.range < 1000 && style !== "support" ? 1.35 : 1;
    return w[0] * Math.log(res.D) + w[1] * melee * Math.log(res.EHP) + w[2] * Math.log(res.U) + (extra || 0);
  }

  // Sensibilità: quanto cambiano danno, resistenza e utilità aggiungendo un oggetto "tipo" a una build.
  const REFERENCE = {
    PHYSICAL_POWER: 60,
    MAGICAL_POWER: 90,
    PHYSICAL_PENETRATION: 10,
    MAGICAL_PENETRATION: 9,
    ATTACK_SPEED: 35,
    CRITICAL_CHANCE: 20,
    ABILITY_HASTE: 20,
    HEALTH: 500,
    PHYSICAL_ARMOR: 50,
    MAGICAL_ARMOR: 45,
    LIFESTEAL: 10,
    OMNIVAMP: 8,
    MANA: 300,
    HEAL_AND_SHIELD_POWER: 10,
    TENACITY: 70,
    MOVEMENT_SPEED: 4,
  };

  function sensitivity(kit, totals, opts) {
    const base = evaluate(kit, totals, opts);
    const out = [];
    for (const [stat, v] of Object.entries(REFERENCE)) {
      const t2 = Object.assign({}, totals);
      t2[stat] = (t2[stat] || 0) + v;
      const r = evaluate(kit, t2, opts);
      out.push({
        stat,
        value: v,
        dD: r.D / base.D - 1,
        dEHP: r.EHP / base.EHP - 1,
        dU: r.U / base.U - 1,
      });
    }
    return out;
  }

  const api = { ASSUME, STYLE_W, evaluate, objective, sensitivity, REFERENCE, ccPower };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredModel = api;
})(typeof self !== "undefined" ? self : this);
