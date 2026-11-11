// Effetti passivi degli oggetti scritti a mano, in termini numerici per il modello di combattimento (model.js).
// Ogni voce viene dal TESTO UFFICIALE del gioco (data/items.json). Dove il testo non dà un numero (i rapporti di scaling
// sono nascosti, es. «(+18%)») il valore è una STIMA e la voce ha `approx: true`: sono ipotesi da verificare, non misure.
// Stack e proc: si usano valori medi realistici su un combattimento di 12 s, non il massimo teorico.
//   stack nello scontro (shred): raggiungono SHRED_UPTIME del massimo in media (si accumulano colpo dopo colpo)
//   stack di partita (Malice, Overlord...): livello atteso a fine partita, dichiarato nella voce
//   effetti condizionali: pesati per la quota di tempo in cui la condizione è vera (`cond`)
(function (root) {
  "use strict";

  const SHRED_UPTIME = 0.7;
  const ENV = typeof process !== "undefined" && process.env ? process.env : {};
  const ONLY_EXACT = !!ENV.PRED_FXEXACT, ONLY_FIRST = !!ENV.PRED_FXFIRST;
  let FIRST = new Set();

  // Campi (somme tra gli oggetti della build):
  //  apMult, bonusAD, bonusAP            potenza (moltiplicatore sulla potenza magica totale, statistiche piatte)
  //  ampAll, ampAbil                     danno inflitto in più (tutto / solo abilità), anche «il bersaglio subisce di più»
  //  ignoreP, ignoreM                    % di armatura ignorata (si combinano come probabilità)
  //  shredP, shredM                      riduzione % di armatura a stack completi (si applica SHRED_UPTIME)
  //  critDmg, cdFlat                     danno critico in più, secondi tolti alle ricariche (non ultimate)
  //  onHit[]    {flat, ad, ap, curHp, maxHp, min, kind, ranged}      a ogni attacco base
  //  empowered[] {flat, ad, ap, kind, every}                         un attacco potenziato ogni `every` s
  //  perCast[]  {flat, ap, ad, maxHp, kind}                          a ogni abilità lanciata
  //  periodic[] {flat, ap, ad, maxHp, kind, every, cond}             ogni `every` s
  //  dpsPct[]   {pct, kind, cond}                                    % della vita massima nemica al secondo
  //  shield[]   {flat, hp, ap, every}                                scudo (hp = % vita propria)
  //  heal[]     {flat, hp, every}                                    cura periodica
  //  healFromDmg, omnivamp               cure dal danno inflitto
  //  cast[]     {flat, ad, ap, maxHp, kind, cd, mult}                abilità con ricarica `cd` (la prima sempre, poi a ogni ricarica)
  //  rebirth                             resurrezione (vita di base)
  //  bonusAS, bonusCrit, bonusAH         velocità d'attacco, critico (punti %), velocità abilità, medi
  //  bonusArmP/M, armMultP/M             armature piatte e moltiplicatore (%)
  //  dr                                  frazione di danno subito evitata (max 0,4 in somma)
  //  ampUlt, ultHaste, cdPct             danno e velocità dell'ultimate; % di ricarica tolta alle non ultimate
  //  basicMult, apsMult                  moltiplicatori su danno e velocità degli attacchi base
  const FX = {
    // --- Potenza e danno aggiuntivo -------------------------------------------------------------
    "Oblivion Crown": { apMult: 0.25 }, // «Aumenta la tua Potenza Magica del 25%»
    "Wraith Leggings": { ampAbil: 0.12 }, // «Le abilità infliggono il 12% di danno magico in più»
    "Overseer": { ampAll: 0.15, healFromDmg: 0.25 * 0.5, note: "cura 25% del danno agli eroi: dimezzato (non tutto il danno è su eroi)" },
    "Soulbinder": { ampAbil: 0.08 * 0.5, note: "8% solo da 1450+ di distanza: metà del tempo" },
    "Imperator": { critDmg: 0.30 }, // «I colpi critici infliggono il 30% in più»
    "Vanquisher": { ampAll: 0.04, approx: true, note: "esecuzione: la soglia non è nel testo, stimato 4% di danno medio in più" },
    "Manta Scythe": { ampAll: 0.08 * 0.3, note: "8% solo se il bersaglio è isolato: 30% del tempo" },
    "Tainted Blade": { ampAll: 0.05 * 0.6, note: "Hex: bersaglio subisce +5% per 3 s, attivo ~60%" },
    "Dynamo": { ampAll: 0.08 * 0.4, bonusAD: 20, bonusAP: 30, note: "+8% per 2,5 s dopo controllo (40% del tempo); +20 potenza fisica o +30 magica", approx: true },
    "Azure Core": { apMult: 0.035 * 0.7, shield: [{ flat: 100, ap: 0.12, every: 15 }], note: "+3,5% PM a 400 stack (70% della partita); scudo ogni ~15 s", approx: true },

    // --- Armatura: ignorata e ridotta -----------------------------------------------------------
    "Caustica": { ignoreM: 0.35 }, // «Ignora il 35% di Armatura Magica»
    "Demolisher": { ignoreP: 0.25 + 0.05, note: "25% + circa 5% dal bonus sugli attacchi base/critici" },
    "The Perforator": { ignoreP: 0.30 },
    "Magnify": { shredM: 0.06 * 5 }, // 6% per stack, fino a 5
    "Basilisk": { shredP: 0.045 * 6 }, // 4,5% per stack, fino a 6

    // --- Danno a ogni attacco base --------------------------------------------------------------
    "Sky Splitter": { onHit: [{ curHp: 0.05, min: 12, kind: "physical", ranged: 0.7 }] }, // 5% della vita attuale (3,5% a distanza)
    "Tainted Rounds": { onHit: [{ flat: 20, ad: 0.15, kind: "physical", mult: 1.4 }], approx: true, note: "rapporti non nel testo; +100% con bersaglio a poca vita: ×1,4 medio" },
    "Prophecy": { onHit: [{ flat: 20, ap: 0.15, kind: "magical" }] },
    "Rapture": { onHit: [{ flat: 20, maxHp: 0.025, ad: 0.15, kind: "physical" }], approx: true, note: "tipo e rapporti stimati" },
    "Overlord": { onHit: [{ maxHp: 0.01, kind: "physical" }], approx: true, note: "danno ad area sul colpo: solo la parte sul bersaglio" },
    "Lightning Hawk": { empowered: [{ flat: 40, ad: 0.2, kind: "physical", every: 2.5 }], approx: true, note: "100 stack di slancio: un attacco potenziato ogni ~2,5 s" },
    "Scattershot": { onHit: [{ ad: 0.4 * 2 * 0.5 * 0.5, kind: "physical" }], approx: true, note: "2 proiettili da 40%, metà dei colpi li usa" },
    "Augmentation": { empowered: [{ ad: 0.9 * 0.5, kind: "physical", every: 8 }], approx: true, note: "90% della potenza base (base = metà della totale); ogni ~8 s" },
    "Solaris": { empowered: [{ flat: 45, ad: 0.35, kind: "physical", every: 8 }], healFromDmg: 0.03, approx: true, note: "ricarica non nel testo: ogni ~8 s" },
    "Elafrost": { empowered: [{ flat: 70, kind: "magical", every: 10 }], approx: true },

    // --- Danno su abilità / periodico -----------------------------------------------------------
    "Tainted Scepter": { perCast: [{ flat: 15 * 1.5, ap: 0.15, kind: "magical" }], note: "Malice: 15 stack al massimo, ne conto 10 (dopo uccisioni e danni); 1,5 (+1% PM) per stack" },
    "Mutilator": { perCast: [{ maxHp: 0.01, kind: "physical" }] }, // 1% della vita massima a ogni abilità
    "Megacosm": { dpsPct: [{ pct: ((0.025 + 0.06 * 0.45) / 3) * 0.6, kind: "magical" }], note: "2,5% vita massima + 6% della vita bonus (stimata 45% della vita) in 3 s, attivo ~60%" },
    "Noxia": { periodic: [{ maxHp: 0.06, kind: "magical", every: 6, cond: 0.7 }], approx: true, note: "serve il bersaglio segnato; ricarica interna non nel testo" },
    "Combustion": { periodic: [{ flat: 50, ap: 0.18, kind: "magical", every: 8 }], approx: true, note: "ricarica non nel testo" },
    "Malady": { periodic: [{ flat: 20 + 4 * 6, ad: 0.15, kind: "physical", every: 8 }], approx: true, note: "20 (+15%) più 4 per stack (stimati 6)" },
    "Fire Blossom": { dpsPct: [], periodic: [{ flat: 15 * 1.2, maxHp: 0, kind: "magical", every: 1, cond: 0.7 }], approx: true, note: "15 al secondo con rampa fino a +40% (media ×1,2); attivo ~70%" },
    "Tainted Guard": { periodic: [{ flat: 30 / 3, kind: "physical", every: 1, cond: 0.5 }], approx: true, note: "sanguinamento quando colpito" },

    // --- Resistenza ---------------------------------------------------------------------------
    "Salvation": { shield: [{ hp: 0.25 * 0.85, every: 20 }], omnivamp: 0.10 * 0.3, note: "scudo 25% vita (ridotto del 50% a distanza: ×0,85 medio); omnivamp 10% per 6 s su 12 s", approx: true },
    "Forticus": { shield: [{ hp: 0.08, every: 15 }], approx: true, note: "scudo 8% e vita bonus temporanea" },
    "Rebirth": { rebirth: true },
    "Terminus": { shield: [{ hp: 0.04, every: 12 }], approx: true, note: "cure in eccesso diventano scudo: stimato" },
    "Orb Of Growth": { heal: [{ hp: 0.03 * 0.5, every: 20 }], note: "3% della vita mancante in 5 s (metà mancante)" },
    "Draconum": { heal: [{ hp: 0.06, flat: 60, every: 15 }], approx: true, note: "cura periodica" },

    // --- Utilità ------------------------------------------------------------------------------
    "Timewarp": { cdFlat: 1 }, // «sottrae 1 s alle ricariche non ultimate»

    // === Secondo gruppo (94 oggetti): stime dal testo ufficiale; valori mancanti nel testo = stima (approx) ============
    // Oggetti per alleati (scudi, cure, aure) e utilità senza numero di danno hanno la voce senza effetti: il modello non li vede.
    "Alternator": { ampAbil: 0.04, approx: true, note: "15% sull'abilità Alternate: una su quattro" },
    "Dust Devil": { bonusAS: 9, approx: true, note: "3% per colpo fino a 5 stack: 60% del massimo (15%)" },
    "Cursed Ring": { apsMult: 1.2, basicMult: 0.75, approx: true, note: "velocità d'attacco ×1,2 e attacchi base −25%" },
    "Tainted Bastion": { dr: 0.035, approx: true, note: "mitiga 3,5% del danno subito" },
    "Everbloom": { approx: true, note: "protezione per alleati: non modellata" },
    "Gaia Greaves": { onHit: [{ flat: 40, ad: 0.3, kind: "physical", mult: 0.3 }], approx: true, note: "danno bonus solo con le cariche di movimento: 30% dei colpi" },
    "Dread": { dr: 0.03, approx: true, note: "blocca 25% del danno magico per 3 s, poi 15 s di pausa" },
    "Fist Of Razuul": { empowered: [{ flat: 120, kind: "physical", every: 6 }], healFromDmg: 0.02, approx: true },
    "Necrosis": { ampUlt: 0.15, ultHaste: 25 },
    "Tainted Charm": { approx: true, note: "anti-cura e rallentamento: nessun numero di danno" },
    "Crystalline Cuirass": { bonusArmM: 18, approx: true, note: "5 armatura magica per stack, 5 stack: 70% del massimo" },
    "Dawnstar": { dr: 0.075, bonusAS: 9, approx: true, note: "riduce il danno dei nemici fino al 12,5%; 30% velocità d'attacco per 3 s" },
    "Lifecore": { approx: true, note: "cura gli alleati: non modellata" },
    "Deathstalker": { shredP: 12 / 95, approx: true, note: "3 armatura per colpo, 4 stack = 12 (su 95 di armatura di riferimento)" },
    "Raiment of Renewal": { heal: [{ hp: 0.015, every: 1 }], approx: true, note: "3% della vita mancante al secondo, vita mancante media 50%" },
    "Demon Edge": { ampAll: 0.03, approx: true, note: "45% di danno in più fino alla dimensione dello scudo nemico" },
    "Transference": { armMultP: 0.05, armMultM: 0.05, approx: true },
    "Marshal": { bonusAS: 15, onHit: [{ flat: 28, kind: "magical" }], note: "10 + 1 per livello, a livello 18" },
    "Giant's Ring": { cdFlat: 0.25, dr: 0.03, approx: true },
    "Oathkeeper": { empowered: [{ flat: 65, ap: 0.35, kind: "magical", every: 6 }], approx: true },
    "Ruination": { periodic: [{ flat: 100, kind: "true", every: 4, cond: 0.6 }], approx: true, note: "danno vero = 80% del mana drenato (mana nemico stimato)" },
    "Flux Matrix": { ampAll: 0.05, approx: true, note: "i bersagli subiscono +10% danno magico: metà dei colpi" },
    "Infernum": { periodic: [{ maxHp: 0.04, kind: "magical", every: 5 }], approx: true, note: "4% della vita massima a 4 stack" },
    "Spirit Of Amir": { apMult: 0.08, note: "fuori dalla giungla +8% potenza magica" },
    "Penumbra": { cdFlat: 1.5, approx: true, note: "sottrae 4 s alle ricariche ma la condizione non è nel testo" },
    "Vortex Stone": { shield: [{ hp: 0.09, every: 10 }], cdPct: 0.03, approx: true },
    "Plasma Blade": { bonusCrit: 12, note: "4% per stack, 5 stack: 60% del massimo" },
    "Dreambinder": { approx: true, note: "rallentamenti: nessun numero di danno" },
    "Tyranny": { bonusAH: 8, ultHaste: 20, note: "20 velocità abilità per 8 s: 40% del tempo" },
    "Devotion": { dr: 0.05, approx: true },
    "Storm Breaker": { empowered: [{ flat: 70, ad: 0.2, kind: "physical", every: 3 }], approx: true },
    "Spear Of Desolation": { ampAll: 0.05, ultHaste: 25, note: "10% di danno per 6 s all'attivazione: metà del tempo" },
    "Tainted Totem": { approx: true, note: "anti-cura per alleati: nessun numero di danno" },
    "Syonic Echo": { bonusAS: 12, approx: true },
    "Ashbringer": { cdPct: 0.2, approx: true, note: "8% di ricarica per colpo, una volta per abilità" },
    "Aegis Of Agawar": { armMultP: 0.12, armMultM: 0.12, note: "+10% armature, +20% sotto il 40% di vita" },
    "Truesilver Bracelet": { shield: [{ flat: 100, ap: 0.18, every: 12 }], periodic: [{ flat: 60, kind: "magical", every: 12 }], approx: true },
    "Omen": { empowered: [{ flat: 30, ad: 0.2, kind: "physical", every: 3 }], cdPct: 0.08, approx: true },
    "Mistmeadow Buckler": { dr: 0.05, bonusArmM: 10, approx: true },
    "Warden's Faith": { dr: 0.07, approx: true, note: "−20% danno critico subito; riduce del 8% la potenza fisica nemica" },
    "Equinox": { shield: [{ flat: 750, every: 20 }], approx: true, note: "scudo 350–750, qui livello 18; ricarica non nel testo" },
    "Vainglory": { armMultP: 0.09, armMultM: 0.09, note: "0,5% per stack fino a 10 più 12%" },
    "Spectra": { onHit: [{ flat: 20 }], periodic: [{ flat: 150, kind: "magical", every: 3 }], approx: true, note: "Prisma 30 + 4 per livello, ×1–2,5 in base alla vita mancante" },
    "Claw Of Hermes": { ampAbil: 0.07, perCast: [{ flat: 40, kind: "true" }], approx: true },
    "Resolution": { bonusAD: 3, approx: true },
    "Inquisition": { periodic: [{ flat: 65, kind: "magical", every: 10 }], approx: true },
    "Orion": { bonusAS: 30, ampAll: 0.06, approx: true, note: "velocità d'attacco = 80% della velocità abilità degli oggetti" },

    "Luxforge Lantern": { bonusAD: 15, note: "+1 per stack fino a 30: metà" },
    "Xenia": { approx: true, note: "scudo agli alleati: non modellato" },
    "Mindrazor": { empowered: [{ ad: 0.4, kind: "physical", every: 3 }], approx: true },
    "Mesmer": { dr: 0.05, approx: true, note: "blocca la prossima abilità nemica" },
    "Absolution": { dr: 0.06, approx: true, note: "25% di mitigazione per 3 s" },
    "Golem's Gift": { bonusAP: 16, bonusArmP: 16, note: "4 potenza magica e 4 armatura per stack, 5 stack" },
    "Tainted Trident": { ampAll: 0.05, approx: true },
    "Frosted Lure": { periodic: [{ flat: 80, kind: "magical", every: 10 }], shield: [{ flat: 120, every: 10 }], approx: true },
    "Cursed Scroll": { periodic: [{ flat: 20, maxHp: 0.035, kind: "magical", every: 5 }], bonusAS: 1.5, approx: true },
    "Vanguardian": { bonusArmP: 15, bonusArmM: 15 },
    "Nuclear Rounds": { ampAbil: 0.15, note: "10–20% di danno alle abilità" },
    "Enra's Blessing": { approx: true, note: "scudo agli alleati: non modellato" },
    "Spectral Schematics": { perCast: [{ flat: 40, curHp: 0.05, kind: "magical" }], approx: true },
    "Solstice": { periodic: [{ flat: 60, kind: "physical", every: 6 }], healFromDmg: 0.02, approx: true },
    "Windcaller": { approx: true, note: "velocità per alleati: non modellata" },
    "Void Conduit": { omnivamp: 0.06 },
    "Echelon Cloak": { ampAll: 0.08 * 0.3, note: "8% dopo il mimetismo: 30% del tempo" },
    "World Breaker": { ampAll: 0.07, apMult: 0.05, note: "2% per stack fino a 6: 60% del massimo" },
    "Amulet Of Chaos": { cdPct: 0.06, approx: true, note: "65% di ricarica delle abilità base una volta ogni tanto" },
    "Catalytic Drive": { approx: true, note: "esegue minion: nessun numero contro eroi" },
    "Volcanica": { cdFlat: 0.5, approx: true },
    "Unbroken Will": { armMultP: 0.05, armMultM: 0.05, approx: true, note: "+25% armature per 2,5 s all'attivazione" },
    "Entropy": { perCast: [{ flat: 9, ap: 0.1, kind: "magical" }], approx: true },
    "Nightfall": { healFromDmg: 0.03, shield: [{ flat: 400, every: 20 }], approx: true },
    "Lunaria": { approx: true, note: "cura gli alleati: non modellata" },
    "Hexbound Bracers": { dr: 0.04, approx: true },
    "Onixian Quiver": { onHit: [{ ad: 0.5, kind: "physical" }], bonusCrit: 25, dr: 0.03, approx: true, note: "2 proiettili da 10–35% del danno" },
    "Citadel": { bonusArmP: 5, shredP: 0.2, approx: true },
    "Legacy": { dr: 0.05, approx: true },
    "Painweaver": { shredP: 0.08, approx: true, note: "2 penetrazione per stack, 4 stack" },
    "Berserker's Axe": { empowered: [{ flat: 50, ad: 0.4, kind: "physical", every: 8 }], approx: true },
    "Astral Catalyst": { ampAll: 0.03, approx: true },
    "Galaxy Greaves": { approx: true, note: "mobilità: nessun numero di danno" },
    "Earthshaker": { ampAbil: 0.08, note: "1,25% per stack fino a 10, il doppio più veloce in mischia" },
    "Lucky Feather": { approx: true, note: "oro e mostri: non modellato" },
    "Void Helm": { approx: true, note: "+20% cure ricevute: non modellato" },
    "Envy": { empowered: [{ ad: 0.75, kind: "physical", every: 8 }], approx: true, note: "il prossimo attacco è critico" },
    "Gaussian Greaves": { periodic: [{ flat: 100, ad: 0.3, kind: "physical", every: 10, cond: 0.4 }], approx: true },
    "Warp Stream": { ultHaste: 25 },
    "Lifebinder": { bonusAP: 20, approx: true, note: "2,5 potenza magica per stack: stack stimati" },
    "Vyzar Carapace": { periodic: [{ flat: 115, kind: "physical", every: 5 }], shield: [{ flat: 50, hp: 0.12, every: 8 }], approx: true },
    "Viper": { shredP: 0.045 * 6, ampAll: 0.10 },
    "Spellbreaker": { apMult: 0.15, dr: 0.04, approx: true },
    "Frostguard": { dr: 0.05, approx: true, note: "riduce la velocità d'attacco di chi ti colpisce, fino al 17,5%" },
    "Stonewall": { dr: 0.04, approx: true, note: "mitiga 5–10% del danno fisico" },
    "Crystal Tear": { bonusAP: 12, approx: true },
    "Crescelia": { empowered: [{ flat: 50, ap: 0.2, kind: "magical", every: 6 }], approx: true },
  };


  // === Passive degli eroi (56) ====================================================================================
  // Stesso linguaggio degli oggetti. Valori a livello 18; dove il testo non dà un numero (ricariche, quota di tempo in cui
  // l'effetto è attivo) è una STIMA mia, da verificare. Gli eroi senza voce utile hanno `{}`: la loro passiva non è
  // modellata (mobilità, visione, risorse, bonus per alleati).
  const HERO = {
    "wukong": {}, "wraith": {}, "renna": {}, "lt-belica": { bonusAH: 24, approx: true, note: "8 velocità abilità per ogni abilità al massimo (3-4 a fine partita)" },
    "rampage": { heal: [{ hp: 0.03 * 0.3, every: 12 }], approx: true },
    "adele": {}, "muriel": {}, "aurora": { periodic: [{ flat: 5, ap: 0.3, kind: "magical", every: 0.5, cond: 0.5 }], approx: true, note: "tempesta di ghiaccio dopo 4 colpi: 5 (+30%) a tick; il resto del testo è troncato" }, "ikra": {}, "scarlett": { cast: [{ flat: 183, ad: 1.26, kind: "physical", cd: 4.5, mult: 1.25 }], approx: true, note: "3 colpi da 61 + 42% a rango 5; l'ultimo fa fino a +125% in base alla vita mancante" }, "dekker": {}, "the-fey": {}, "riktor": {}, "zinx": { shield: [{ flat: 1300, every: 120 }], approx: true, note: "ultimate: resurrezione con 1300 di vita" }, "skylar": {}, "maco": {}, "eden": { bonusAD: 33, healFromDmg: 0.05, approx: true, note: "stance a distanza +33 potenza fisica; in mischia cura 22% del danno agli eroi (metà del tempo)" },
    "steel": { shield: [{ hp: 0.07, every: 10 }], bonusArmP: 8, bonusArmM: 8, approx: true },
    "grux": { onHit: [{ flat: 43, ad: 0.3, kind: "physical" }], approx: true, note: "sanguinamento a ogni colpo, fino a 6 stack" },
    "greystone": { dr: 0.05, approx: true, note: "devia un attacco base ogni ~5-15 s" },
    "countess": { periodic: [{ maxHp: 0.04, kind: "true", every: 5, cond: 0.7 }], cast: [{ flat: 265, maxHp: 0.075, kind: "magical", cd: 85 }], approx: true, note: "ultimate: 265 + 5% (+2,5%) della vita massima, soppressione 0,75 s" },
    "akeron": { healFromDmg: 0.02, approx: true },
    "kallari": { periodic: [{ flat: 105, maxHp: 0.028, kind: "true", every: 10 }], note: "15 + 5 per livello; più 7% (+2%) della vita mancante (metà)" },
    "serath": { cdPct: 0.1, approx: true },
    "khaimera": { cdPct: 0.12, cast: [{ flat: 195, ad: 0.8, kind: "physical", cd: 11, mult: 1.4 }], approx: true, note: "balzo: 195 + 80%, fino a 2× in base alla vita mancante (media ×1,4)" },
    "bayle": { bonusAS: 10, approx: true, note: "Berserk sotto il 35% di vita, 7 s: un quarto dello scontro" },
    "neon": { ampAbil: 0.1, approx: true },
    "valmont": { perCast: [{ flat: 40, ap: 0.15, kind: "magical" }], approx: true },
    "gadget": { bonusAP: 25, approx: true, note: "1 potenza magica ogni 6 stack" },
    "boris": { bonusAS: 30, approx: true, note: "fino a 4 contenitori da 16%: media 50%" },
    "sparrow": { onHit: [{ maxHp: 0.015, kind: "physical" }], note: "0,25% della vita massima per stack, fino a 8 stack (media 6)" },
    "morigesh": { dpsPct: [{ pct: 0.0067, kind: "magical" }], note: "0,14% a 0,5 s per stack, fino a 4, attivo 60%" },
    "revenant": { ampAll: 0.08, critDmg: -0.15, periodic: [{ maxHp: 0.04, kind: "physical", every: 5 }], approx: true, note: "potenza fisica +11,5%; danno critico fisso al 160% (meno di 175%); l'ultimo colpo fa il 10% della vita mancante" },
    "kaelen": { dpsPct: [{ pct: 0.005, kind: "true" }], approx: true, note: "0,5% vita massima a 0,5 s sul ghiaccio, metà del tempo" },
    "howitzer": { empowered: [{ flat: 105, ap: 0.32, kind: "magical", every: 8 }], approx: true },
    "crunch": { empowered: [{ ap: 0.28, ad: 0.3, kind: "magical", every: 5 }], cdPct: 0.05, approx: true },
    "iggy-scorch": { periodic: [{ flat: 17, kind: "magical", every: 1, cond: 0.5 }], approx: true },
    "yurei": { onHit: [{ ad: 0.5, kind: "physical", mult: 0.5 }], bonusAS: 19, approx: true },
    "kwang": { empowered: [{ flat: 139, ap: 0.2, kind: "magical", every: 4 }], bonusAS: 18, cast: [{ flat: 195, ap: 0.45, kind: "magical", cd: 11, mult: 1.5 }], approx: true, note: "scatto 195 + 45%; richiamo della lama ripete il danno (×1,5)" },
    "twinblast": { bonusAS: 14, empowered: [{ ad: 0.425, kind: "physical", every: 3 }], approx: true, note: "il prossimo attacco spara 3 volte (142,5% totale)" },
    "drongo": { dpsPct: [{ pct: 0.0068, kind: "physical" }], approx: true, note: "2,25% vita massima in 3 s su critici e abilità" },
    "terra": { ampAbil: 0.05, approx: true },
    "yin": { bonusAS: 25, note: "fino a 36% con 6 stack (70%)" },
    "sevarog": { omnivamp: 0.05, shredM: 0.15, approx: true, note: "tier 1-2 delle anime" },
    "argus": { perCast: [{ flat: 20, ap: 0.1, kind: "magical" }], approx: true },
    "mourn": { empowered: [{ flat: 156, ap: 0.5, kind: "magical", every: 8 }], heal: [{ hp: 0.09, every: 8 }], approx: true },
    "gideon": { empowered: [{ flat: 355, ap: 0.2, kind: "magical", every: 8 }], approx: true },
    "narbash": { bonusAD: 40, bonusArmP: 40, bonusArmM: 40, approx: true, note: "bonus per ogni eroe vicino: ne conto 3" },
    "phase": { ampAll: 0.04, approx: true },
    "zarus": { ampAll: 0.06, approx: true, note: "1% potenza fisica per stack, fino a 8" },
    "feng-mao": { ignoreP: 0.1, approx: true, note: "+40% penetrazione fisica" },
    "legion": { bonusAH: 15, approx: true },
    "shinbi": { onHit: [{ flat: 12, ad: 0.1, ap: 0.1, kind: "magical" }], empowered: [{ ad: 1.5, kind: "physical", every: 9 }], approx: true },
    "kira": { periodic: [{ flat: 60, curHp: 0.05, kind: "physical", every: 8 }], approx: true },
    "grim-exe": { onHit: [{ flat: 15, ad: 0.3, kind: "true", mult: 0.5 }], approx: true },
    "murdock": { empowered: [{ ad: 0.48, kind: "physical", every: 5 }], approx: true },
  };

  FIRST = new Set(Object.keys(FX).slice(0, 40));
  const empty = () => ({ apMult: 0, bonusAD: 0, bonusAP: 0, ampAll: 0, ampAbil: 0, ignoreP: 0, ignoreM: 0, shredP: 0, shredM: 0, critDmg: 0, cdFlat: 0, onHit: [], empowered: [], perCast: [], periodic: [], dpsPct: [], shield: [], heal: [], cast: [], healFromDmg: 0, omnivamp: 0, rebirth: false, any: false, bonusAS: 0, bonusCrit: 0, bonusArmP: 0, bonusArmM: 0, armMultP: 0, armMultM: 0, dr: 0, ampUlt: 0, ultHaste: 0, cdPct: 0, bonusAH: 0, basicMult: 1, apsMult: 1 });

  // Somma gli effetti degli oggetti (oggetti del motore o nomi)
  // Somma gli effetti degli oggetti (oggetti del motore o nomi) e della passiva dell'eroe (slug)
  function aggregate(items, heroSlug) {
    const a = empty();
    const add = (f) => {
      a.any = true;
      for (const k of ["apMult", "bonusAD", "bonusAP", "ampAll", "ampAbil", "critDmg", "cdFlat", "healFromDmg", "omnivamp", "bonusAS", "bonusCrit", "bonusArmP", "bonusArmM", "armMultP", "armMultM", "ampUlt", "ultHaste", "cdPct", "bonusAH"]) a[k] += f[k] || 0;
      a.dr = Math.min(0.4, a.dr + (f.dr || 0));
      a.basicMult *= f.basicMult || 1;
      a.apsMult *= f.apsMult || 1;
      a.ignoreP = 1 - (1 - a.ignoreP) * (1 - (f.ignoreP || 0));
      a.ignoreM = 1 - (1 - a.ignoreM) * (1 - (f.ignoreM || 0));
      a.shredP = Math.min(0.5, a.shredP + (f.shredP || 0));
      a.shredM = Math.min(0.5, a.shredM + (f.shredM || 0));
      for (const k of ["onHit", "empowered", "perCast", "periodic", "dpsPct", "shield", "heal", "cast"]) if (f[k]) a[k].push(...f[k]);
      if (f.rebirth) a.rebirth = true;
    };
    for (const it of items) {
      const name = typeof it === "string" ? it : it.data.displayName;
      const f = FX[name];
      if (!f) continue;
      if (ONLY_EXACT && f.approx) continue; // PRED_FXEXACT=1: solo le voci con numeri letti dal testo
      if (ONLY_FIRST && !FIRST.has(name)) continue; // PRED_FXFIRST=1: solo i primi 40
      add(f);
    }
    if (heroSlug && HERO[heroSlug] && !ENV.PRED_NOHEROFX) add(HERO[heroSlug]); // PRED_NOHEROFX=1 disattiva le passive degli eroi
    return a;
  }

  const api = { FX, HERO, aggregate, SHRED_UPTIME, covered: () => Object.keys(FX) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PredItemFx = api;
})(typeof self !== "undefined" ? self : this);
