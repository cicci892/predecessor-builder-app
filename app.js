(function () {
  "use strict";
  const E = window.PredEngine;
  const data = window.PRED_DATA;
  const ctx = E.makeContext(data, window.PRED_REF);
  const $ = (id) => document.getElementById(id);

  const heroes = data.heroes.slice().sort((a, b) => a.data.displayName.localeCompare(b.data.displayName));
  const state = { hero: null, role: null, style: null, enemy: "mixed", opp: "", oppRole: null, oppStyle: null };

  // Ripristina l'ultima scelta
  try { Object.assign(state, JSON.parse(localStorage.getItem("pb-state") || "{}")); } catch (e) {}
  if (state.hero !== "" && !heroes.some((h) => h.slug === state.hero)) state.hero = heroes[0].slug;
  if (state.opp && !heroes.some((h) => h.slug === state.opp)) state.opp = "";

  const heroSel = $("hero");
  heroSel.innerHTML = `<option value="">Non ancora scelto (mostrami i counter)</option>` + heroes.map((h) => `<option value="${h.slug}">${esc(h.data.displayName)}</option>`).join("");
  heroSel.value = state.hero;
  const oppSel = $("opp");
  oppSel.innerHTML = `<option value="">Nessuno / non lo so</option>` + heroes.map((h) => `<option value="${h.slug}">${esc(h.data.displayName)}</option>`).join("");
  oppSel.value = state.opp;
  $("enemy").innerHTML = Object.entries(E.ENEMY_MIX).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  if (!E.ENEMY_MIX[state.enemy]) state.enemy = "mixed";
  $("enemy").value = state.enemy;
  $("updated").textContent = (data.updated || "").slice(0, 10);

  heroSel.onchange = () => { state.hero = heroSel.value; state.role = null; state.style = null; render(); };
  oppSel.onchange = () => { state.opp = oppSel.value; state.oppRole = null; state.oppStyle = null; render(); };
  $("enemy").onchange = (e) => { state.enemy = e.target.value; render(); };

  const R = window.PredRich;
  // Tutto il testo degli effetti (nome + righe tradotte con simboli colorati)
  const fxHtml = (effects) => (effects || []).map((e) => { const body = R.richHtml(e.raw || e.text); return body ? `<div class="fxb">${e.name ? `<b class="fxn">${esc(e.name)}</b>` : ""}${body}</div>` : ""; }).join("");
  const img = (icon, size) => (icon ? `<img class="ic" src="https://pred.gg/assets/${icon}_${size || 64}.webp" loading="lazy" alt="" onerror="this.remove()">` : "");
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const label = (s) => E.STAT_LABELS[s] || s;
  const fmt = (s) => `${s.value}${s.showPercent ? "%" : ""} ${label(s.stat)}`;
  const fmtStat = (stat, v) => `${Math.round(v * 10) / 10} ${label(stat)}`;

  function chips(el, entries, current, onPick) {
    el.innerHTML = entries.map(([k, t]) => `<button class="chip${k === current ? " on" : ""}" data-k="${k}">${esc(t)}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => (b.onclick = () => onPick(b.dataset.k)));
  }

  // --- Scontro 1 contro 1: etichette ------------------------------------------------------
  // ratio > 1: chi è "a" elimina l'altro più in fretta. Solo una stima del modello, non un esito di partita.
  function verdict(ratio) {
    const x = Math.min(ratio >= 1 ? ratio : 1 / ratio, 9.9).toFixed(1);
    if (ratio >= 1.5) return { cls: "good", text: `Vantaggio netto ×${x}` };
    if (ratio >= 1.15) return { cls: "good", text: `Vantaggio ×${x}` };
    if (ratio > 1 / 1.15) return { cls: "even", text: "Alla pari" };
    if (ratio > 1 / 1.5) return { cls: "bad", text: `Svantaggio ×${x}` };
    return { cls: "bad", text: `Svantaggio netto ×${x}` };
  }
  const vdHtml = (ratio) => { const v = verdict(ratio); return `<span class="vd ${v.cls}">${esc(v.text)}</span>`; };
  // Winrate reale dello scontro (E.counterpicks / E.recommendVs, campo `real`): colore dalla winrate corretta per i campioni piccoli
  const realVd = (r) => `<span class="vd ${r.wrAdj >= 52 ? "good" : r.wrAdj <= 48 ? "bad" : "even"}">${r.winrate}% vittorie</span>`;
  const realMeta = (r) => `${r.matches} partite · ${esc(r.reliability)}`;

  const miniBuild = (r) =>
    `<div class="mini">${r.crest ? `<span>${img(r.crest.icon)}${esc(r.crest.name)}</span>` : ""}${r.items.map((it) => `<span>${img(it.icon)}${esc(it.name)}</span>`).join("")}</div>`;

  const dmgKind = (r) => (r.damage === "physical" ? "fisico" : "magico");
  const abilitiesHtml = (hero) =>
    hero.data.abilities
      .filter((a) => a.simplifiedDescription)
      .map((a) => `<div class="abil"><b>${esc(a.key[0] + a.key.slice(1).toLowerCase())} · ${esc(a.name)}</b>${R.plainHtml(a.simplifiedDescription)}</div>`).join("");

  // Dati reali dalle partite: "min 16 · 54% su 328 partite · solido"
  const mm = (sec) => (sec ? Math.round(sec / 60) + "'" : "");
  const realLine = (x) => (x ? `<span class="real ${x.reliability === "pochi dati" ? "weak" : ""}">${x.time ? "min " + mm(x.time) + " · " : ""}${x.winrate}% su ${x.matches} partite · ${esc(x.reliability)}</span>` : "");
  function skillHtml(real) {
    const so = real && real.skillOrder;
    if (!so || !so.byLevel.length) return "";
    const names = so.abilities;
    const letter = (n) => String.fromCharCode(65 + names.indexOf(n));
    const list = names.map((n) => `<span class="sk"><b>${letter(n)}</b> ${esc(n)}</span>`).join("");
    const seq = so.byLevel.map((n, i) => `<span class="lv${[5, 10, 15].includes(i) ? " gap" : ""}" title="Livello ${i + 1}: ${esc(n)}"><i>${i + 1}</i>${letter(n)}</span>`).join("");
    return `<div class="card"><h3>Ordine abilità (il più scelto, livello per livello)</h3><div class="totals">${list}</div><div class="seq">${seq}</div></div>`;
  }

  // --- Schede ---------------------------------------------------------------------------------
  // Eroe scelto: build completa (con vsName se la build è calcolata contro un avversario)
  function buildCards(hero, r, vsName) {
    const m = hero.data.mainAttributes;
    const bar = (n, v) => `<div class="bar">${n} ${v}/10<i><b style="width:${Math.min(v, 10) * 10}%"></b></i></div>`;

    const items = r.items.map((it, i) => `
      <div class="item">
        <div class="top"><span class="nm">${img(it.icon)}<span><span class="num">${i + 1}.</span>${esc(it.name)}</span></span><span class="price">${it.price} oro</span></div>
        ${it.real ? `<div class="path">${realLine(it.real)}</div>` : ""}
        <div class="stats">${it.stats.map((s) => esc(fmt(s))).join(" · ")}</div>
        <div class="why">Cosa dà alla build: ${it.why.map((s) => esc(label(s))).join(", ")}</div>
        ${fxHtml(it.effects)}
        ${it.components.length ? `<div class="path">Si costruisce da: ${it.components.map((c) => esc(c.name)).join(", ")}</div>` : ""}
      </div>`).join("");

    const alts = r.alternatives.map((it) => `
      <div class="item">
        <div class="top"><span class="nm">${img(it.icon)}<span>${esc(it.name)}</span></span><span class="price">${it.price} oro</span></div>
        ${it.real ? `<div class="path">${realLine(it.real)}</div>` : ""}
        <div class="stats">${it.stats.map((s) => esc(fmt(s))).join(" · ")}</div>
        ${fxHtml(it.effects)}
      </div>`).join("");

    const totals = Object.entries(r.totals)
      .sort((a, b) => b[1] / (E.REFERENCE[b[0]] || 1) - a[1] / (E.REFERENCE[a[0]] || 1))
      .map(([s, v]) => `<span><b>${esc(fmtStat(s, v))}</b></span>`).join("");

    const pk = r.perks;
    const perkRow = (kind, p) => p ? `<div class="item"><div class="top"><span class="nm">${img(p.icon)}<span>${esc(p.name)}</span></span><span class="tag">${esc(kind)}${p.category ? " · " + esc(p.category) : ""}${p.level ? " · liv. " + p.level : ""}</span></div>${p.real ? `<div class="path">${realLine(p.real)}</div>` : ""}<div class="fxt">${R.richHtml(p.raw)}</div></div>` : "";
    const perksHtml =
      perkRow(r.real ? "Augment" : "Eroe", pk.hero) + perkRow("Eternal", pk.eternal) +
      pk.common.map((p, i) => perkRow("Comune " + (i + 1), p)).join("") +
      pk.blessings.map((p, i) => perkRow("Blessing minore " + (i + 1), p)).join("");
    const eternalAlt = pk.eternalAlt.map((p) => perkRow("Eternal alternativo", p)).join("");
    const augmentAlt = (pk.augmentAlt || []).map((p) => perkRow("Augment alternativo", p)).join("");
    const prof = r.profile;
    const profTxt = `Scaling abilità: potenza magica +${Math.round(prof.apRatio)}% · potenza fisica +${Math.round(prof.adRatio)}% · controllo ${prof.cc} · mobilità ${prof.mobility} · cure/scudi ${prof.heal + prof.shield} · scaling salute propria +${Math.round(prof.healthSelf)}% · % salute bersaglio +${Math.round(prof.healthTarget)}%`;

    const an = r.analysis;
    const pc = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
    const top = (key, n) => an.sens.slice().sort((x, y) => y[key] - x[key]).slice(0, n).filter((x) => x[key] > 0.004);
    const row = (x, key) => `<span><b>${esc(label(x.stat))}</b> ${pc(x[key])}</span>`;
    const abilRates = an.abilities.map((x) => `${esc(x.key[0] + x.key.slice(1).toLowerCase())} ${Math.round((100 * x.rate) / an.D)}%`).join(" · ");
    const analysisHtml = `
      <div class="stats">Il danno viene da: attacchi base ${Math.round((100 * an.Dbasic) / an.D)}% · ${abilRates}</div>
      <div class="path">Aggiungere un oggetto "tipo" a questa build aumenta:</div>
      <div class="totals"><span>Danno:</span>${top("dD", 4).map((x) => row(x, "dD")).join("")}</div>
      <div class="totals"><span>Resistenza:</span>${top("dEHP", 3).map((x) => row(x, "dEHP")).join("")}</div>
      ${an.sens.some((x) => x.dU > 0.01) ? `<div class="totals"><span>Utilità:</span>${top("dU", 2).map((x) => row(x, "dU")).join("")}</div>` : ""}`;

    return `
      <div class="card">
        <div class="hero-head">${img(hero.data.icon, 128)}<h2>${esc(hero.data.displayName)}</h2>
          <span class="tag">${hero.data.classes.map(esc).join(", ")} · danno ${dmgKind(r)} · ${esc(E.ROLES[r.role])} · ${esc(E.STYLES[r.style])}</span></div>
        <div class="path">${esc(profTxt)}</div>
        <div class="bars">${bar("Potenza fisica", m.attackPower)}${bar("Potenza magica", m.abilityPower)}${bar("Resistenza", m.durability)}${bar("Mobilità", m.mobility)}</div>
      </div>
      ${r.crest ? `<div class="card"><h3>Cristallo di partenza</h3>
        <div class="item"><div class="top"><span class="nm">${img(r.crest.icon, 128)}<span>${esc(r.crest.name)}</span></span>${r.real && r.real.crestFinal ? `<span class="tag">poi evolve in ${esc(r.real.crestFinal.name)}</span>` : ""}</div>
        ${r.real && r.real.crestFinal ? `<div class="path">Evoluzione più scelta: ${esc(r.real.crestFinal.name)} · ${realLine(r.real.crestFinal)}</div>` : ""}
        <div class="stats">${r.crest.stats.map((s) => esc(fmt(s))).join(" · ")}</div>
        ${fxHtml(r.crest.effects)}</div></div>` : ""}
      <div class="card"><h3>Build ${r.real ? "più usata e vincente" : "consigliata"}${vsName ? " contro " + esc(vsName) : ""} (6 oggetti · ${r.totalPrice} oro)</h3>${r.real ? `<div class="path">Dalle partite ranked della versione ${esc(r.real.source.version)} (${esc(r.real.source.filter)}). L'ordine è quello di acquisto, con il minuto medio.</div>` : `<div class="path">Eroe senza dati di partite: build calcolata dal modello.</div>`}<div class="legend">Simboli: ${R.LEGEND}</div>${items}
        ${r.tonic ? `<div class="path" style="margin-top:8px">Consumabile suggerito: ${esc(r.tonic.name)} (${r.tonic.price} oro)</div>` : ""}</div>
      ${skillHtml(r.real)}
      <div class="card"><h3>Cosa scala di più per ${esc(hero.data.displayName)}</h3>${analysisHtml}</div>
      <div class="card"><h3>Perk ed Eternal</h3>${perksHtml}<details><summary>Altri Eternal${augmentAlt ? " e augment" : ""}</summary>${augmentAlt}${eternalAlt}</details></div>
      <div class="card"><h3>Statistiche totali</h3><div class="totals">${totals}</div></div>
      <div class="card"><details><summary>Alternative</summary>${alts}</details></div>
      <div class="card"><details><summary>Abilità di ${esc(hero.data.displayName)}</summary>${abilitiesHtml(hero)}</details></div>`;
  }

  // Avversario: chi è, da dove viene il suo danno, la sua build stimata e le sue abilità
  function opponentCard(opp, res, note) {
    const an = res.analysis;
    const abilRates = an.abilities.map((x) => `${esc(x.key[0] + x.key.slice(1).toLowerCase())} ${Math.round((100 * x.rate) / an.D)}%`).join(" · ");
    return `
      <div class="card">
        <h3>Avversario</h3>
        <div class="hero-head">${img(opp.data.icon, 128)}<h2>${esc(opp.data.displayName)}</h2>
          <span class="tag">${opp.data.classes.map(esc).join(", ")} · danno ${dmgKind(res)} (~${Math.round(an.physShare * 100)}% fisico) · ${esc(E.ROLES[res.role])} · ${esc(E.STYLES[res.style])}</span></div>
        <div class="stats">Il suo danno viene da: attacchi base ${Math.round((100 * an.Dbasic) / an.D)}% · ${abilRates}</div>
        <div class="path">${esc(note)}</div>
        ${miniBuild(res)}
        <details style="margin-top:8px"><summary>Abilità di ${esc(opp.data.displayName)}</summary>${abilitiesHtml(opp)}</details>
      </div>`;
  }

  const tipsHtml = (tips) => `<ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const REAL_NOTE = "Winrate dalle partite ranked di pred.gg (versione 1.18, tutti i livelli), contro chi affronta davvero questo eroe nel suo ruolo. Non isola la corsia e riflette anche la forza generale dell'eroe. Con pochi dati è corretta verso il 50%. I consigli «Come contrastarlo» e le build vengono dal modello.";
  const LIMITS = "Stima del modello su uno scontro 1 contro 1 a fine partita (livello 18) con le build consigliate. Non vede mobilità, controllo di gruppo, mappa né aiuto della squadra, e non nasce da partite vinte.";

  // Eroe e avversario scelti: scontro, cosa cambia nella build, come contrastarlo
  function versusCard(hero, opp, rv) {
    const d = rv.duel, rr = rv.real;
    const first = d.ratio >= 1 ? hero : opp, second = d.ratio >= 1 ? opp : hero;
    const x = Math.min(d.ratio >= 1 ? d.ratio : 1 / d.ratio, 9.9).toFixed(1);
    const modelLine = Math.abs(d.ratio - 1) < 0.13
      ? `Con le build consigliate, ${esc(hero.data.displayName)} e ${esc(opp.data.displayName)} si equivalgono.`
      : `Con le build consigliate, ${esc(first.data.displayName)} elimina ${esc(second.data.displayName)} circa ×${x} più in fretta del contrario.`;
    // Con dati reali conta la winrate; il modello resta solo dove i dati mancano (e lo si dice)
    const line = rr
      ? `Nelle partite ranked ${esc(hero.data.displayName)} vince il ${rr.winrate}% contro ${esc(opp.data.displayName)} (${realMeta(rr)}).`
      : `Nessuna partita registrata in questo scontro. ${modelLine}`;
    const vd = rr ? realVd(rr) : vdHtml(d.ratio);
    const note = rr ? REAL_NOTE : LIMITS + " Per questo scontro non ci sono dati reali: dove ci sono, il modello concorda con la realtà in meno della metà dei casi.";
    const sw = rv.swap, idea = rv.idea;
    const pctTxt = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
    const effectTxt = (s) => `Stima del modello: danno ${pctTxt(s.effect.damage)}, vita effettiva ${pctTxt(s.effect.ehp)}.`;
    const changes = sw
      ? `La build resta quella standard, con un solo cambio: entra <b>${esc(sw.added)}</b> al posto di ${esc(sw.removed)}, perché ${esc(opp.data.displayName)} ${esc(sw.reason)}. ${sw.real ? `${esc(sw.added)} lo usi davvero: ${sw.real.winrate}% su ${sw.real.matches} partite (${esc(sw.real.reliability)}). ` : ""}${effectTxt(sw)}`
      : `Contro ${esc(opp.data.displayName)} la build standard non cambia: nessun oggetto che questo eroe usa davvero migliora abbastanza il modello da giustificare un cambio.`;
    const ideaHtml = idea
      ? `<div class="path"><b>Da verificare:</b> ${esc(idea.added)} (al posto di ${esc(idea.removed)}), perché ${esc(opp.data.displayName)} ${esc(idea.reason)}. ${effectTxt(idea)} Nessuno lo compra con questo eroe nelle partite registrate: viene solo dal calcolo, non è provato.</div>`
      : "";
    return `
      <div class="card">
        <h3>${esc(hero.data.displayName)} contro ${esc(opp.data.displayName)}</h3>
        <div class="top item" style="border:0;padding:0"><span>${line}</span>${vd}</div>
        <div class="path">${changes}</div>
        ${ideaHtml}
        <div class="path" style="margin-top:10px"><b>Come contrastarlo</b></div>
        ${tipsHtml(rv.tips)}
        <div class="note">${esc(note)}</div>
      </div>`;
  }

  // Eroe non ancora scelto: classifica dei counterpick, con la build di ciascuno
  function counterListCard(opp, base, list) {
    const row = (c, i) => `
      <div class="item">
        <div class="top"><span class="nm">${img(c.hero.data.icon)}<span><span class="num">${i + 1}.</span>${esc(c.hero.data.displayName)}</span></span>${realVd(c.real)}</div>
        <div class="stats">${realMeta(c.real)} · ${c.hero.data.classes.map(esc).join(", ")} · danno ${dmgKind(c.build)} · ${esc(E.ROLES[base.role])} · ${esc(E.STYLES[base.style])}</div>
        ${miniBuild(c.build)}
        ${c.build.swap ? `<div class="path">Oggetto da situazione: ${esc(c.build.swap.added)} (al posto di ${esc(c.build.swap.removed)})</div>` : ""}
        <button class="chip open" data-slug="${c.hero.slug}">Apri la build completa contro ${esc(opp.data.displayName)}</button>
      </div>`;
    const compact = (c, i) => `<div class="compact"><span>${i + 9}. ${esc(c.hero.data.displayName)}</span>${realVd(c.real)}<span class="stats">${realMeta(c.real)}</span><button class="chip open" data-slug="${c.hero.slug}">Apri</button></div>`;
    const noData = (c) => `<div class="compact"><span>${esc(c.hero.data.displayName)}</span><button class="chip open" data-slug="${c.hero.slug}">Apri</button></div>`;
    const ranked = list.filter((c) => c.real), unranked = list.filter((c) => !c.real);
    const top = ranked.slice(0, 8), rest = ranked.slice(8);
    return `
      <div class="card">
        <h3>Counterpick di ${esc(E.ROLES[base.role])} contro ${esc(opp.data.displayName)} (${ranked.length} con dati su ${list.length})</h3>
        <div class="path">Ordinati per winrate reale contro ${esc(opp.data.displayName)}.</div>
        ${ranked.length ? "" : `<div class="path">Nessun eroe di questo ruolo ha partite registrate contro ${esc(opp.data.displayName)}: i dati di pred.gg riguardano chi lo affronta davvero. Prova il ruolo ${esc(E.ROLES[base.oppRole])}, quello dell'avversario.</div>`}
        ${top.map(row).join("")}
        ${rest.length ? `<details><summary>Altri ${rest.length} eroi con dati</summary>${rest.map(compact).join("")}</details>` : ""}
        ${unranked.length ? `<details><summary>${unranked.length} eroi senza dati (non ordinabili)</summary>${unranked.map(noData).join("")}</details>` : ""}
        <div class="note">${esc(REAL_NOTE)} Build mostrate valutate nel ruolo e nello stile scelti sopra.</div>
      </div>`;
  }

  let runId = 0; // un calcolo avviato prima di un cambio di scelta viene scartato
  const loading = (txt) => `<div class="card"><div class="path" id="prog">${esc(txt)}</div></div>`;

  function wireOpenButtons() {
    $("result").querySelectorAll("button.open").forEach((b) => (b.onclick = () => {
      state.hero = b.dataset.slug; heroSel.value = state.hero;
      render();
      window.scrollTo(0, 0);
    }));
  }

  function render() {
    const hero = heroes.find((h) => h.slug === state.hero) || null;
    const opp = heroes.find((h) => h.slug === state.opp) || null;
    const roleKeys = hero ? hero.data.roles.filter((r) => E.ROLES[r]) : Object.keys(E.ROLES);
    if (!roleKeys.includes(state.role)) state.role = hero ? roleKeys[0] : "MIDLANE";
    if (!state.style) state.style = E.defaultStyle(state.role);
    try { localStorage.setItem("pb-state", JSON.stringify(state)); } catch (e) {}
    heroSel.value = state.hero;
    oppSel.value = state.opp;

    chips($("roles"), roleKeys.map((r) => [r, E.ROLES[r]]), state.role, (r) => { state.role = r; state.style = E.defaultStyle(r); render(); });
    chips($("styles"), Object.entries(E.STYLES), state.style, (s) => { state.style = s; render(); });

    // Ruolo e stile dell'avversario (di default: stesso ruolo nostro, stile tipico del ruolo)
    $("oppctl").hidden = !opp;
    $("enemyrow").hidden = !!opp;
    let oppRole = null, oppStyle = null;
    if (opp) {
      const oppRoles = opp.data.roles.filter((r) => E.ROLES[r]);
      oppRole = E.opponentRole(opp, state.role, state.oppRole);
      oppStyle = state.oppStyle || E.defaultStyle(oppRole);
      chips($("oroles"), oppRoles.map((r) => [r, E.ROLES[r]]), oppRole, (r) => { state.oppRole = r; state.oppStyle = null; render(); });
      chips($("ostyles"), Object.entries(E.STYLES), oppStyle, (s) => { state.oppStyle = s; render(); });
    }

    const token = ++runId;
    const out = $("result");
    const later = (fn) => setTimeout(() => { if (token === runId) fn(); }, 20); // lascia disegnare "Calcolo…" prima del lavoro pesante

    if (!hero && !opp) {
      out.innerHTML = `<div class="card"><div class="path">Scegli il tuo eroe per la build consigliata. Se conosci l'avversario di corsia, sceglilo: avrai build su misura e, se non hai ancora scelto l'eroe, i migliori counterpick.</div></div>`;
      return;
    }

    if (!hero) {
      // Solo avversario: classifica dei counterpick nel ruolo e stile scelti
      out.innerHTML = loading("Calcolo i counterpick…");
      later(() => {
        const base = E.prepareCounter(ctx, opp.slug, { role: state.role, style: state.style, oppRole, oppStyle });
        const n = base.candidates.length, list = [];
        let i = 0;
        (function step() {
          if (token !== runId) return;
          const t0 = performance.now();
          while (i < n && performance.now() - t0 < 40) list.push(E.counterpickOne(ctx, base, base.candidates[i++]));
          if (i < n) {
            const p = $("prog"); if (p) p.textContent = `Calcolo i counterpick… ${i}/${n}`;
            setTimeout(step, 0);
            return;
          }
          list.sort(E.byAdvantage);
          const tips = E.counterTips(ctx, base.oppBuild, null);
          out.innerHTML =
            counterListCard(opp, base, list) +
            `<div class="card"><h3>Come contrastare ${esc(opp.data.displayName)}</h3>${tipsHtml(tips)}</div>` +
            opponentCard(opp, base.oppBuild, "Build stimata dell'avversario nel ruolo e nello stile indicati sopra.");
          wireOpenButtons();
        })();
      });
      return;
    }

    if (!opp) {
      const r = E.recommend(ctx, state.hero, { role: state.role, style: state.style, enemy: state.enemy });
      out.innerHTML = buildCards(hero, r);
      return;
    }

    // Eroe e avversario
    out.innerHTML = loading("Calcolo la build contro " + opp.data.displayName + "…");
    later(() => {
      const rv = E.recommendVs(ctx, hero.slug, opp.slug, { role: state.role, style: state.style, oppRole, oppStyle });
      out.innerHTML =
        versusCard(hero, opp, rv) +
        buildCards(hero, rv.me, opp.data.displayName) +
        opponentCard(opp, rv.opp, `Build stimata dell'avversario contro ${hero.data.displayName}, nel ruolo e nello stile indicati sopra.`);
    });
  }

  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
