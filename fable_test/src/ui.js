// HTML/CSS HUD overlaying the canvas: squad roster, action bar, targeting
// cards, combat log, banners, floating damage text, modals.

import { WEAPONS } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      mission: $('mission'), objective: $('objective'), turninfo: $('turninfo'),
      squad: $('squad'), actionbar: $('actionbar'), endturn: $('endturn'),
      unitinfo: $('unitinfo'), targets: $('targets'), hint: $('hint'),
      log: $('log'), banner: $('banner'), floats: $('floats'),
      modal: $('modal'), help: $('help'),
      btnHelp: $('btnHelp'), btnMute: $('btnMute'), btnRestart: $('btnRestart'),
    };
    this.floats = [];
    this.bannerTimer = null;
  }

  bind(game, rig, fx, { onRestart }) {
    this.game = game; this.rig = rig; this.fx = fx; this.onRestart = onRestart;
    this.el.endturn.onclick = () => game.endTurn();
    this.el.btnHelp.onclick = () => this.toggleHelp();
    this.el.btnRestart.onclick = () => onRestart(false);
    this.el.btnMute.onclick = () => {
      fx.sounds.muted = !fx.sounds.muted;
      this.el.btnMute.textContent = fx.sounds.muted ? '🔇' : '🔊';
    };
    this.el.help.onclick = () => this.toggleHelp();
  }

  setMission(name, seed) {
    this.el.mission.textContent = `OPERATION ${name.toUpperCase()}`;
    this.el.mission.title = `seed: ${seed}`;
  }

  toggleHelp() { this.el.help.classList.toggle('open'); }

  // ------------------------------------------------------------ refresh

  refreshAll() {
    this.refreshSquad(); this.refreshActions(); this.refreshObjective(); this.refreshTurn();
  }

  refreshObjective() {
    const n = this.game.aliveEnemies().length;
    this.el.objective.textContent = n > 0
      ? `Neutralize all hostiles — ${n} remaining`
      : 'All hostiles neutralized';
  }

  refreshTurn() {
    const g = this.game;
    this.el.turninfo.textContent = `ROUND ${g.round} — ${g.phase === 'player' ? 'XCOM' : 'ALIEN'} TURN`;
    this.el.turninfo.classList.toggle('alien', g.phase !== 'player');
    this.el.endturn.disabled = g.phase !== 'player' || g.mode === 'busy' || g.mode === 'over';
  }

  pips(unit) {
    let h = '<span class="pips">';
    for (let i = 0; i < unit.maxHp; i++) {
      h += `<i class="${i < unit.hp ? 'on' : ''} ${unit.side === 'player' ? '' : 'foe'}"></i>`;
    }
    return h + '</span>';
  }

  statusIcons(u) {
    const s = [];
    if (u.poisoned > 0) s.push('<b class="st poison" title="Poisoned">☠</b>');
    if (u.overwatch) s.push('<b class="st ow" title="Overwatch">👁</b>');
    if (u.hunkered) s.push('<b class="st hk" title="Hunkered">🛡</b>');
    return s.join('');
  }

  refreshSquad() {
    const g = this.game;
    this.el.squad.innerHTML = '';
    for (const u of g.soldiers) {
      const card = document.createElement('div');
      card.className = 'card' + (u === g.selected ? ' sel' : '') + (!u.alive ? ' dead' : '') +
        (u.alive && u.ap === 0 ? ' spent' : '');
      const ap = u.alive ? '●'.repeat(u.ap) + '○'.repeat(2 - u.ap) : '';
      card.innerHTML = `
        <div class="row1"><span class="nick">'${u.nickname}'</span> ${u.name} <span class="cls">${u.label}</span></div>
        <div class="row2">${this.pips(u)} <span class="ap">${ap}</span>${this.statusIcons(u)}</div>
        <div class="row3">${WEAPONS[u.weapon].name} ${u.ammo}/${u.clip}
          ${u.grenades > 0 ? ` · ${u.grenades}🧨` : ''}${u.medkits > 0 ? ` · ${u.medkits}⚕` : ''}</div>`;
      if (u.alive) card.onclick = () => g.select(u);
      this.el.squad.appendChild(card);
    }
  }

  refreshActions() {
    const g = this.game;
    const u = g.selected;
    this.el.actionbar.innerHTML = '';
    if (u && u.alive) {
      this.el.unitinfo.innerHTML =
        `<b>'${u.nickname}' ${u.name}</b> — ${u.label} · ${u.hp}/${u.maxHp} HP · ${u.ap} AP`;
      for (const a of g.actionsFor(u)) {
        const b = document.createElement('button');
        b.className = 'act';
        b.disabled = !a.enabled || g.mode === 'busy';
        b.title = a.reason;
        b.innerHTML = `<span class="hot">${a.hot}</span>${a.label}`;
        b.onclick = () => g.triggerAction(a.id);
        this.el.actionbar.appendChild(b);
      }
    } else {
      this.el.unitinfo.textContent = '';
    }
  }

  // ----------------------------------------------------------- targeting

  showTargets(list, idx) {
    const g = this.game;
    this.el.targets.innerHTML = '';
    this.el.targets.classList.add('open');
    list.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'tcard' + (i === idx ? ' sel' : '');
      const tag = t.shot.flanked ? '<span class="flank">FLANKED</span>'
        : t.shot.cover !== 'none' ? `<span class="cov">${t.shot.cover.toUpperCase()} COVER</span>` : '';
      card.title = t.shot.breakdown.map(b => `${b.label}: ${b.val > 0 ? '+' : ''}${b.val}`).join('\n');
      card.innerHTML = `
        <div class="tname">${t.enemy.label}</div>
        <div>${this.pips(t.enemy)}</div>
        <div class="hitpc">${t.shot.hit}%</div>
        <div class="crit">crit ${t.shot.crit}% ${tag}</div>`;
      card.onclick = () => (i === idx ? g.confirmFire() : g.setTargetIdx(i));
      this.el.targets.appendChild(card);
    });
  }

  hideTargets() {
    this.el.targets.classList.remove('open');
    this.el.targets.innerHTML = '';
  }

  // ------------------------------------------------------- transient fx

  hint(text) { this.el.hint.textContent = text || ''; }

  banner(text, kind = 'player') {
    const b = this.el.banner;
    b.textContent = text;
    b.className = 'show ' + kind;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = ''; }, 1700);
  }

  log(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    this.el.log.prepend(div);
    while (this.el.log.children.length > 30) this.el.log.lastChild.remove();
  }

  float(worldPos, text, cls = 'dmg') {
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    this.el.floats.appendChild(el);
    this.floats.push({ el, world: { x: worldPos.x, y: worldPos.y + 0.6, z: worldPos.z }, t: 0, dur: 1.25 });
  }

  tick(dt) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      const p = this.rig.worldToScreen(f.world, window.innerWidth, window.innerHeight);
      const k = f.t / f.dur;
      f.el.style.transform = `translate(${p.x}px, ${p.y - k * 46}px) translate(-50%,-100%)`;
      f.el.style.opacity = `${Math.max(0, 1 - k * k)}`;
      if (f.t >= f.dur || p.behind) { f.el.remove(); this.floats.splice(i, 1); }
    }
  }

  modal(win, stats) {
    const m = this.el.modal;
    m.classList.add('open');
    m.innerHTML = `
      <div class="panel">
        <h1 class="${win ? 'win' : 'lose'}">${win ? 'MISSION ACCOMPLISHED' : 'SQUAD WIPED'}</h1>
        <p>${win ? 'All hostiles neutralized. Good work, Commander.' : 'Contact lost with the squad. The Avenger pulls out.'}</p>
        <div class="stats">
          <div><b>${stats.rounds}</b><span>rounds</span></div>
          <div><b>${stats.lost}</b><span>soldiers lost</span></div>
          <div><b>${stats.acc}%</b><span>squad accuracy</span></div>
        </div>
        <div class="btns">
          <button id="mRetry">Retry this map</button>
          <button id="mNew" class="primary">New mission</button>
        </div>
      </div>`;
    m.querySelector('#mRetry').onclick = () => this.onRestart(true);
    m.querySelector('#mNew').onclick = () => this.onRestart(false);
  }
}
