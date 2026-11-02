/* =====================================================================
   Basket101 · cuenta con Google + marcas por juego + ranking mundial
   ---------------------------------------------------------------------
   ÚNICO SITIO QUE TIENES QUE EDITAR: pega aquí la configuración de tu
   app web de Firebase (Consola Firebase → ⚙ Configuración del proyecto →
   Tus apps → SDK setup and configuration → "Config").
   Mientras esté sin rellenar, los juegos funcionan igual y las marcas
   se guardan solo en el móvil.
   ===================================================================== */
const HG_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBgZ0TstfpYR5-4Jyrh8xuCLbmAAFxrrPs",
  authDomain: "futclass-a483e.firebaseapp.com",
  projectId: "futclass-a483e",
  storageBucket: "futclass-a483e.firebasestorage.app",
  messagingSenderId: "913284671639",
  appId: "1:913284671639:web:c2ded5adb4a93cbd9c21d2"
};
/* ===================================================================== */

(function(){
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const LOCAL_KEY = 'hg_marks_v1';
  const ALIAS_KEY = 'hg_alias_v1';
  const FRIENDS_KEY = 'hg_friends_v1';
  const THEME_KEY = 'fc_theme';
  const SFX_KEY = 'fc_sfx';
  const GAMES = {
    
    nbastats:    { name:'StatsHunter',  em:'📊', kind:'score', native:'nbastats',  sport:'nba' },
    nbatrophy:   { name:'TrophyHunter', em:'🏆', kind:'score', native:'nbatrophy', sport:'nba' },
    nbaorder:    { name:'NBAorder',     em:'🔢', kind:'score', native:'nbaorder',  sport:'nba' },
    nbamulti:    { name:'MultiHunter NBA', em:'🎰', kind:'score', native:'nbamulti', sport:'nba' },
    nbaraya:     { name:'TresEnRaya NBA', em:'⭕', kind:'mines', sport:'nba' },
    nbawordle:   { name:'NBAwordle', em:'🔤', kind:'mines', sport:'nba' },
    nbarayaonline:{ name:'TresEnRaya NBA online', em:'🌐', kind:'mines', sport:'nba' },
  };
  const SPORTS = [{ id:'futbol', label:'⚽ Fútbol' }, { id:'nba', label:'🏀 NBA' }];
  const sportOf = id => (GAMES[id] && GAMES[id].sport) || 'futbol';
  // agrupa las líneas por deporte (primero el del menú en el que estás)
  function bySport(render){
    const cur = /^(nba|statshunter|trophyhunter|nbaorder|nbamulti|nbaraya|nbawordle)\.html$/.test(location.pathname.split('/').pop() || '') ? 'nba' : 'futbol';
    const used = SPORTS.filter(sp => Object.keys(GAMES).some(id => sportOf(id) === sp.id));
    return used.sort((a, b) => (b.id === cur) - (a.id === cur)).map(sp =>
      (used.length > 1 ? `<div class="hg-sport">${sp.label}</div>` : '') + Object.keys(GAMES).filter(id => sportOf(id) === sp.id).map(render).join('')).join('');
  }
  const configured = !/PEGA_AQUI|TU_PROYECTO/.test(JSON.stringify(HG_FIREBASE_CONFIG));

  let auth = null, db = null, user = null, ready = false;
  const listeners = [];

  /* ---------- local mirror ---------- */
  function today(){ return new Date().toISOString().slice(0,10); }
  function readLocal(){
    let m = null;
    try{ m = JSON.parse(localStorage.getItem(LOCAL_KEY)); }catch(e){}
    if(!m || typeof m !== 'object'){
      m = {};
      // first run: keep the bests the player already had before accounts existed
      for(const id in GAMES){
        const g = GAMES[id];
        if(g.native){
          let best = null, played = 0;
          try{
            const b = localStorage.getItem(g.native + '_best_classic');
            if(b !== null) best = parseInt(b,10);
            played = (parseInt(localStorage.getItem(g.native + '_played_classic')||'0',10)||0)
                   + (parseInt(localStorage.getItem(g.native + '_played_daily')||'0',10)||0);
          }catch(e){}
          if(best !== null || played) m[id] = { best, played };
        }
      }
      writeLocal(m);
    }
    return m;
  }
  function writeLocal(m){ try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(m)); }catch(e){} }

  function mergeGame(a, b){
    a = a || {}; b = b || {};
    const out = {};
    const max = (x,y) => (x==null ? y : y==null ? x : Math.max(x,y));
    const min = (x,y) => (x==null ? y : y==null ? x : Math.min(x,y));
    out.best = max(a.best, b.best);
    out.played = max(a.played, b.played) || 0;
    out.wins = max(a.wins, b.wins);
    out.bestTime = min(a.bestTime, b.bestTime);
    out.streak = max(a.streak, b.streak);
    out.bestStreak = max(a.bestStreak, b.bestStreak);
    if(a.catStats || b.catStats){
      const cs = {};
      new Set([...Object.keys(a.catStats||{}), ...Object.keys(b.catStats||{})]).forEach(k => {
        const x = (a.catStats||{})[k] || {}, y = (b.catStats||{})[k] || {};
        cs[k] = { plays: max(x.plays,y.plays) || 0, wins: max(x.wins,y.wins) || 0 };
      });
      out.catStats = cs;
    }
    // daily: the most recent date wins; same date → higher score
    if(a.dailyDate || b.dailyDate){
      if((a.dailyDate||'') > (b.dailyDate||'')){ out.dailyDate = a.dailyDate; out.dailyBest = a.dailyBest; }
      else if((b.dailyDate||'') > (a.dailyDate||'')){ out.dailyDate = b.dailyDate; out.dailyBest = b.dailyBest; }
      else { out.dailyDate = a.dailyDate; out.dailyBest = max(a.dailyBest, b.dailyBest); }
    }
    Object.keys(out).forEach(k => { if(out[k] === undefined || out[k] === null) delete out[k]; });
    return out;
  }
  function mergeAll(a, b){
    const out = {};
    new Set([...Object.keys(a||{}), ...Object.keys(b||{})]).forEach(id => {
      if(GAMES[id]) out[id] = mergeGame((a||{})[id], (b||{})[id]);
    });
    return out;
  }

  /* ---------- theme (dark mode) ---------- */
  function getTheme(){ try{ return localStorage.getItem(THEME_KEY) || 'light'; }catch(e){ return 'light'; } }
  function applyTheme(t){ try{ document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); }catch(e){} }
  function toggleTheme(){
    const t = getTheme() === 'dark' ? 'light' : 'dark';
    try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
    applyTheme(t);
    emit();
  }
  applyTheme(getTheme());

  /* ---------- sound effects ---------- */
  function sfxEnabled(){ try{ return localStorage.getItem(SFX_KEY) !== 'off'; }catch(e){ return true; } }
  function toggleSfx(){
    try{ localStorage.setItem(SFX_KEY, sfxEnabled() ? 'off' : 'on'); }catch(e){}
    emit();
  }
  let actx = null;
  function tone(freq, start, dur, type, gain){
    try{
      if(!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
      if(actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + start;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain==null?0.16:gain, t0+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      osc.connect(g); g.connect(actx.destination);
      osc.start(t0); osc.stop(t0+dur+0.03);
    }catch(e){}
  }
  function buzz(pattern){ try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){} }
  function playSfx(kind){
    if(!sfxEnabled()) return;
    buzz(kind === 'correct' ? 12 : kind === 'wrong' ? [40, 40, 60] : [20, 50, 20, 50, 90]);
    if(kind === 'correct') tone(880, 0, .14, 'triangle');
    else if(kind === 'wrong'){ tone(190, 0, .22, 'sawtooth', .12); tone(130, .06, .26, 'sawtooth', .1); }
    else if(kind === 'win'){ tone(523, 0, .13, 'triangle'); tone(659, .12, .13, 'triangle'); tone(784, .24, .3, 'triangle'); }
  }

  /* ---------- in-app toast + dialogs (instead of alert/prompt/confirm) ---------- */
  let toastEl = null, toastTimer = null;
  function toast(msg, ms){
    ensureUI();
    if(!toastEl){
      toastEl = document.createElement('div');
      toastEl.className = 'hg-toast'; toastEl.setAttribute('role','status'); toastEl.setAttribute('aria-live','polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2600);
  }
  // dialog({title, text, input, value, ok, cancel, danger}) -> Promise<true|false|string|null>
  function dialog(o){
    ensureUI();
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'hg-dlg-ov';
      wrap.innerHTML = `<div class="hg-dlg" role="dialog" aria-modal="true">
        ${o.title ? `<h3>${esc(o.title)}</h3>` : ''}
        ${o.text ? `<p>${esc(o.text).replace(/\n/g,'<br>')}</p>` : ''}
        ${o.input ? `<input type="text" maxlength="${o.maxlength||40}" value="${esc(o.value||'')}">` : ''}
        <div class="hg-row">
          ${o.cancel === false ? '' : `<button class="hg-btn" data-r="0">${esc(o.cancel||'Cancelar')}</button>`}
          <button class="hg-btn pri${o.danger?' danger':''}" data-r="1">${esc(o.ok||'Aceptar')}</button>
        </div></div>`;
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('input');
      const done = r => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(r); };
      const ok = () => done(o.input ? inp.value : true);
      const no = () => done(o.input ? null : false);
      function onKey(e){ if(e.key === 'Escape') no(); if(e.key === 'Enter') ok(); }
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', e => { if(e.target === wrap) no(); });
      wrap.querySelector('[data-r="1"]').addEventListener('click', ok);
      const c = wrap.querySelector('[data-r="0"]'); if(c) c.addEventListener('click', no);
      setTimeout(() => { if(inp){ inp.focus(); inp.select(); } else wrap.querySelector('[data-r="1"]').focus(); }, 30);
    });
  }
  const info = (text, title) => dialog({ title, text, cancel:false, ok:'Entendido' });

  /* ---------- share a result ---------- */
  function shareText(text){
    if(navigator.share){ navigator.share({ text }).catch(()=>{}); return; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(
        () => toast('📋 Resultado copiado. Pégalo donde quieras.'),
        () => dialog({ title:'Comparte tu resultado', text:'Copia este texto:', input:true, value:text, maxlength:300, cancel:false, ok:'Hecho' })
      );
      return;
    }
    dialog({ title:'Comparte tu resultado', text:'Copia este texto:', input:true, value:text, maxlength:300, cancel:false, ok:'Hecho' });
  }
  function shareResult(o){
    const url = location.origin + location.pathname.replace(/[^/]*$/, '');
    const text = `${o.emoji||'🏀'} Basket101 · ${o.game} · ${o.detail}\n${url}`;
    shareText(text);
  }

  /* ---------- cloud ---------- */
  function userDoc(){ return db.collection('users').doc(user.uid); }
  function playerDoc(){ return db.collection('players').doc(user.uid); }

  /* ---------- ranking alias (public name) ---------- */
  function cleanAlias(a){ return String(a||'').replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,20); }
  function defaultAlias(){
    const parts = String((user && user.displayName) || 'Jugador').trim().split(/\s+/);
    return cleanAlias(parts.length > 1 ? parts[0] + ' ' + parts[parts.length-1][0] + '.' : parts[0]);
  }
  let alias = null;
  function getAlias(){ return alias || localStorage.getItem(ALIAS_KEY) || defaultAlias(); }
  function rankValue(id, g){
    if(!g) return null;
    return GAMES[id].kind === 'score' ? (g.best != null ? g.best : null) : (g.wins || null);
  }
  async function pushRanking(merged){
    if(!user || !db) return;
    const name = getAlias();
    for(const id in GAMES){
      const v = rankValue(id, merged[id]);
      if(v == null) continue;
      try{
        const ref = db.collection('rank_' + id).doc(user.uid);
        const cur = await ref.get();
        const curScore = cur.exists ? cur.data().score : -1;
        if(v > curScore || (cur.exists && cur.data().name !== name)){
          await ref.set({ name, score: Math.max(v, curScore), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
      }catch(e){ console.warn('[Basket101] ranking', id, e); }
    }
  }
  async function syncPlayerDoc(){
    if(!user || !db) return;
    try{
      const a = getAlias();
      await playerDoc().set({ alias: a, alias_lc: a.toLowerCase(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }catch(e){ console.warn('[Basket101] players', e); }
  }
  async function editAlias(){
    if(!user) return;
    const a = cleanAlias(await dialog({ title:'Nombre en el ranking', text:'Es el nombre que verán los demás (máx. 20 caracteres).', input:true, value:getAlias(), maxlength:20, ok:'Guardar' }));
    if(!a) return;
    alias = a; localStorage.setItem(ALIAS_KEY, a);
    try{ await userDoc().set({ alias: a }, { merge:true }); }catch(e){}
    await pushRanking(readLocal());
    await syncPlayerDoc();
    emit();
    toast('✅ Nombre actualizado');
  }

  /* ---------- friends ---------- */
  function readFriends(){
    try{ const a = JSON.parse(localStorage.getItem(FRIENDS_KEY)); return Array.isArray(a) ? a : []; }catch(e){ return []; }
  }
  function writeFriends(list){ try{ localStorage.setItem(FRIENDS_KEY, JSON.stringify(list)); }catch(e){} }
  async function addFriend(name){
    if(!user){ toast('Inicia sesión para añadir amigos.'); return; }
    const lc = cleanAlias(name).toLowerCase();
    if(!lc) return;
    try{
      const snap = await db.collection('players').where('alias_lc', '==', lc).limit(5).get();
      const matches = [];
      snap.forEach(d => { if(d.id !== user.uid) matches.push({ uid:d.id, alias:d.data().alias }); });
      if(!matches.length){
        await info('Comprueba que esté escrito igual y que haya jugado al menos una vez con sesión iniciada.', 'No encontramos ese nombre');
        return;
      }
      const pick = matches[0];
      const list = readFriends();
      if(list.some(f => f.uid === pick.uid)){ toast(`${pick.alias} ya está en tu lista de amigos.`); return; }
      list.push(pick);
      writeFriends(list);
      try{ await userDoc().set({ friends: list }, { merge:true }); }catch(e){}
      toast(matches.length > 1
        ? `👥 Añadido ${pick.alias} (hay varios con ese nombre; se añadió uno).`
        : `👥 ${pick.alias} añadido a tus amigos.`, 3500);
      emit();
    }catch(e){ toast('No se pudo buscar ese nombre. ¿Tienes conexión?'); }
  }
  async function removeFriend(uid){
    const list = readFriends().filter(f => f.uid !== uid);
    writeFriends(list);
    if(user){ try{ await userDoc().set({ friends: list }, { merge:true }); }catch(e){} }
    emit();
  }
  async function friendsRanking(gameId, period){
    if(!user || !db || !GAMES[gameId]) return [];
    const ids = [user.uid, ...readFriends().map(f => f.uid)].slice(0, 10);
    try{
      const snap = await db.collection(period === 'today' ? dailyCol(gameId) : 'rank_' + gameId)
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids).get();
      const rows = [];
      snap.forEach(d => rows.push({ uid: d.id, name: d.data().name, score: d.data().score }));
      rows.sort((a,b) => b.score - a.score);
      return rows;
    }catch(e){ console.warn('[Basket101] friendsRanking', e); return []; }
  }

  async function pushCloud(){
    if(!user || !db) return;
    try{
      const snap = await userDoc().get();
      const cloud = (snap.exists && snap.data().games) || {};
      if(snap.exists && snap.data().alias){ alias = snap.data().alias; localStorage.setItem(ALIAS_KEY, alias); }
      if(snap.exists && Array.isArray(snap.data().friends)) writeFriends(snap.data().friends);
      const mergedLog = mergeLogs(readLog(), (snap.exists && snap.data().dailyLog) || {});
      writeLog(mergedLog);
      const merged = mergeAll(cloud, readLocal());
      writeLocal(merged);
      await userDoc().set({
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        games: merged,
        alias: getAlias(),
        friends: readFriends(),
        dailyLog: readLog(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true });
      await pushRanking(merged);
      await syncPlayerDoc();
      for(const id in merged){
        const v = merged[id];
        if(v && v.dailyDate === today() && v.dailyBest != null) await pushDaily(id, v.dailyBest);
      }
      // keep each game's own "Mejor puntuación" in sync with the cloud best
      for(const id in GAMES){
        const g = GAMES[id], b = merged[id] && merged[id].best;
        if(g.native && b != null){
          const k = g.native + '_best_classic';
          const cur = parseInt(localStorage.getItem(k) || '-1', 10);
          if(b > cur) localStorage.setItem(k, b);
        }
      }
    }catch(e){ console.warn('[Basket101] no se pudo sincronizar', e); }
    emit();
  }

  /* ---------- public: report a finished game ---------- */
  function report(gameId, r){
    if(!GAMES[gameId]) return;
    const m = readLocal();
    const g = Object.assign({}, m[gameId] || {});
    g.played = (g.played || 0) + 1;
    if(GAMES[gameId].kind === 'score'){
      const s = Number(r.score) || 0;
      if(r.mode === 'daily'){
        // el reto diario cuenta una sola vez: el primer resultado del día es el que vale
        if(g.dailyDate !== today()){ g.dailyDate = today(); g.dailyBest = s; }
      } else {
        g.best = g.best == null ? s : Math.max(g.best, s);
      }
    } else {
      if(r.win){
        g.wins = (g.wins || 0) + 1;
        const t = Number(r.time);
        if(!isNaN(t)) g.bestTime = g.bestTime == null ? t : Math.min(g.bestTime, t);
        g.streak = (g.streak || 0) + 1;
        g.bestStreak = Math.max(g.bestStreak || 0, g.streak);
      } else {
        g.streak = 0;
      }
      if(r.catName){
        g.catStats = g.catStats || {};
        const cs = Object.assign({ plays:0, wins:0 }, g.catStats[r.catName]);
        cs.plays++; if(r.win) cs.wins++;
        g.catStats[r.catName] = cs;
      }
    }
    m[gameId] = g;
    writeLocal(m);
    if(r.mode === 'daily') recordDaily(gameId, r);
    emit();
    pushCloud();
  }

  /* ---------- reto diario: una vez al día + ranking diario ---------- */
  const DSTATE_KEY = 'fc_daily_state_v1', DPUSH_KEY = 'fc_daily_pushed_v1';
  function readDS(){ try{ return JSON.parse(localStorage.getItem(DSTATE_KEY)) || {}; }catch(e){ return {}; } }
  function writeDS(o){ try{ localStorage.setItem(DSTATE_KEY, JSON.stringify(o)); }catch(e){} }
  function dailyCol(id, d){ return `daily_${id}_${d || today()}`; }
  // los retos del día. En los "hunter" hay que llegar a un mínimo de puntos (la medalla de bronce);
  // en TrofeoMinas y TresEnRaya hay que ganar.
  const DAILY = [
    { id:'nbastats',  file:'statshunter.html',  goal:29000 },
    { id:'nbatrophy', file:'trophyhunter.html', goal:10 },
    { id:'nbamulti',  file:'nbamulti.html',     goal:20 },
    { id:'nbaraya',   file:'nbaraya.html' },
    { id:'nbawordle', file:'nbawordle.html' },
  ];
  const ND = DAILY.length;
  const LOG_KEY = 'fc_daily_log_v1';
  // objetivo = medalla de bronce (la recalcula build_nba.py en datos-nba.js; si esa página no lo carga, se usa el de DAILY)
  function goalOf(id){ const d = DAILY.find(x => x.id === id); if(!d || d.goal == null) return null;
    const t = window.FC_NBA && FC_NBA.targets && FC_NBA.targets[id]; return t ? t[0] : d.goal; }
  function readLog(){ try{ const l = JSON.parse(localStorage.getItem(LOG_KEY)); return l && typeof l === 'object' ? l : {}; }catch(e){ return {}; } }
  function writeLog(l){
    const days = Object.keys(l).sort();
    while(days.length > 400) delete l[days.shift()];
    try{ localStorage.setItem(LOG_KEY, JSON.stringify(l)); }catch(e){}
  }
  function mergeLogs(a, b){
    const out = {};
    new Set([...Object.keys(a||{}), ...Object.keys(b||{})]).forEach(d => {
      out[d] = Object.assign({}, (b||{})[d] || {}, (a||{})[d] || {});   // si ya había resultado, se queda el primero guardado
    });
    return out;
  }
  function recordDaily(id, r){
    const l = readLog(), d = today();
    l[d] = l[d] || {};
    if(!l[d][id]){
      if(GAMES[id] && GAMES[id].kind === 'score'){
        const sc = Number(r.score) || 0, g = r.goal != null ? Number(r.goal) : goalOf(id);
        l[d][id] = { s: sc, g, w: sc >= g ? 1 : 0 };
      } else {
        l[d][id] = { w: r.win ? 1 : 0 };
        if(r.time != null) l[d][id].t = Number(r.time) || 0;
      }
      writeLog(l);
    }
    const st = readDS(); st[id] = Object.assign({}, st[id], { date: d, done: true }); writeDS(st);
  }
  function dailyResult(id, d){ const l = readLog()[d || today()]; return l ? l[id] || null : null; }
  function dailyCanStart(id){
    if(dailyDone(id)) return false;
    const st = readDS()[id];
    return !(st && st.date === today());
  }
  function dailyProgress(id, total, done, goal){
    const st = readDS(); st[id] = { date: today(), total, done: !!done, goal: goal != null ? goal : goalOf(id) }; writeDS(st);
  }
  // si se dejó a medias (se cerró la app, se recargó...), cuenta lo que llevaba: en los hunter,
  // los puntos que tenía; en TrofeoMinas y TresEnRaya, como perdido
  function finalizeAbandonedDaily(id){
    const st = readDS()[id];
    if(!(st && st.date === today() && !st.done && !dailyDone(id))) return;
    if(GAMES[id] && GAMES[id].kind === 'score') report(id, { score: st.total || 0, mode: 'daily', goal: st.goal });
    else report(id, { win: false, mode: 'daily' });
  }
  function resultText(id, r){
    if(!r) return '';
    if(r.s != null) return `${r.w ? '✅ Superado' : '❌ No superado'}: ${fmt(r.s)} de ${fmt(r.g)} puntos`;
    return r.w ? '✅ Ganado' : '❌ Perdido';
  }
  async function explainBlocked(id){
    finalizeAbandonedDaily(id);
    const r = dailyResult(id), isScore = GAMES[id] && GAMES[id].kind === 'score';
    const go = await dialog({ title:'📅 Reto de hoy ya jugado',
      text:`Hoy: ${resultText(id, r) || 'jugado'}.\nEl reto del día solo se puede jugar una vez: mañana habrá uno nuevo. Mientras, puedes jugar partidas normales.`,
      ok: isScore ? 'Ver ranking de hoy' : 'Ver mi calendario', cancel:'Jugar normal' });
    if(go){ if(isScore) location.href = 'ranking.html?juego=' + id + '&hoy=1'; else openStats(); }
  }
  // migra el resultado de hoy de la versión anterior (solo guardaba la puntuación)
  function migrateLegacyDaily(){
    const m = readLocal(), l = readLog(), d = today();
    DAILY.forEach(x => {
      const v = m[x.id];
      if(v && v.dailyDate === d && v.dailyBest != null && !(l[d] && l[d][x.id])){
        l[d] = l[d] || {}; l[d][x.id] = { s: v.dailyBest, g: x.goal, w: v.dailyBest >= x.goal ? 1 : 0 };
      }
    });
    writeLog(l);
  }
  function readPushed(){ try{ return JSON.parse(localStorage.getItem(DPUSH_KEY)) || {}; }catch(e){ return {}; } }
  async function pushDaily(id, score){
    if(!user || !db || !GAMES[id] || GAMES[id].kind !== 'score') return;
    const key = id + '_' + today() + '_' + user.uid, pushed = readPushed();
    if(pushed[key]) return;
    try{
      const ref = db.collection(dailyCol(id)).doc(user.uid);
      const cur = await ref.get();
      if(!cur.exists) await ref.set({ name: getAlias(), score: Number(score) || 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      pushed[key] = 1;
      Object.keys(pushed).forEach(k => { if(!k.includes(today())) delete pushed[k]; });
      localStorage.setItem(DPUSH_KEY, JSON.stringify(pushed));
    }catch(e){ console.warn('[Basket101] ranking diario', e); }
  }


  /* ---------- límite diario de partidas + anuncio con recompensa ----------
     Cada juego tiene LIMIT.perDay partidas al día (se renuevan a medianoche, hora del móvil).
     Al acabarse, un anuncio con recompensa da LIMIT.adBonus partidas más.
     No gastan partidas: el reto del día, los duelos ni el TresEnRaya online.
     ANUNCIOS: anuncios H5 de Google AdSense (Ad Placement API). Pon tu ID de editor
     de AdSense en ADS.client ('ca-pub-…'). Mientras esté vacío se muestra un anuncio
     de PRUEBA (cuenta atrás de 5 s) para poder probar el flujo. */
  const SIN_ANUNCIOS = !!window.__SIN_ANUNCIOS;   // web NBA: sin anuncios ni límite de partidas (lo pone build_web.py)
  const LIMIT = { perDay: 10, adBonus: 3 };
  const ADS = { client: 'ca-pub-4127491072128435', bannerSlot: '', test: false };   // bannerSlot: ID del bloque de anuncios (AdSense → Anuncios → Por bloque de anuncios → Display). Vacío = sin banner.   // test: true = anuncios de prueba de Google (data-adbreak-test)
  const PLAYS_KEY = 'fc_plays_v1';
  function localDay(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function readPlays(){ let p = readJSON(PLAYS_KEY, null); if(!p || p.date !== localDay()) p = { date: localDay(), g: {} }; return p; }
  function playsLeft(id){ const g = readPlays().g[id] || { u: 0, x: 0 }; return Math.max(0, LIMIT.perDay + g.x - g.u); }
  function playsUsed(id){ return (readPlays().g[id] || { u: 0 }).u; }
  function beginPlay(id){
    if(!GAMES[id] || SIN_ANUNCIOS) return true;
    const p = readPlays(), g = p.g[id] || (p.g[id] = { u: 0, x: 0 });
    if(LIMIT.perDay + g.x - g.u <= 0){ showLimit(id); return false; }
    g.u++; writeJSON(PLAYS_KEY, p); renderPlays();
    const left = LIMIT.perDay + g.x - g.u;
    if(left === 2 || left === 1) toast(`🎟️ Te ${left === 1 ? 'queda 1 partida' : 'quedan 2 partidas'} de ${GAMES[id].name} hoy`);
    else if(left === 0) toast(`🎟️ Es tu última partida de ${GAMES[id].name} por hoy`);
    return true;
  }
  function addPlays(id, n){ const p = readPlays(), g = p.g[id] || (p.g[id] = { u: 0, x: 0 }); g.x += n; writeJSON(PLAYS_KEY, p); renderPlays(); emit(); }
  async function showLimit(id){
    const name = GAMES[id] ? GAMES[id].name : 'este juego';
    const ok = await dialog({ title: '🎟️ Se acabaron las partidas de hoy',
      text: `Ya has jugado tus ${LIMIT.perDay} partidas de hoy a ${name}.\nMira un anuncio y consigue ${LIMIT.adBonus} partidas más, o vuelve mañana: se renuevan a medianoche.\n\nEl reto del día, los duelos y el online no gastan partidas.`,
      ok: `▶️ Ver anuncio (+${LIMIT.adBonus})`, cancel: 'Ahora no' });
    if(!ok) return false;
    const r = await showRewarded();
    if(r === 'viewed'){ addPlays(id, LIMIT.adBonus); sfxPlay('win'); toast(`🎉 ¡${LIMIT.adBonus} partidas más de ${name}!`); return true; }
    if(r === 'unavailable'){ addPlays(id, LIMIT.adBonus); toast(`Ahora mismo no hay anuncios: te regalamos ${LIMIT.adBonus} partidas 🎁`); return true; }
    toast('Tienes que ver el anuncio entero para conseguir las partidas.');
    return false;
  }
  function sfxPlay(k){ try{ api.sfx.play(k); }catch(e){} }
  // --- anuncios con recompensa (Ad Placement API de AdSense) ---
  let adsReady = null;
  function loadAds(){
    if(adsReady) return adsReady;
    adsReady = new Promise(resolve => {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adBreak = window.adConfig = function(o){ window.adsbygoogle.push(o); };
      if(document.querySelector('script[src*="adsbygoogle.js"]')){   // la página ya lo carga (p. ej. la portada): no se duplica
        try{ window.adConfig({ preloadAdBreaks: 'on', sound: 'on' }); }catch(e){}
        resolve(true); return;
      }
      const sc = document.createElement('script');
      sc.async = true; sc.crossOrigin = 'anonymous';
      sc.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS.client);
      sc.setAttribute('data-ad-client', ADS.client);
      sc.setAttribute('data-ad-frequency-hint', '30s');
      if(ADS.test) sc.setAttribute('data-adbreak-test', 'on');
      sc.onload = () => { try{ window.adConfig({ preloadAdBreaks: 'on', sound: 'on' }); }catch(e){} resolve(true); };
      sc.onerror = () => resolve(false);
      document.head.appendChild(sc);
    });
    return adsReady;
  }
  /* ---------- banner inferior (AdSense display 320x50) ----------
     Solo aparece cuando Google ya ha servido un anuncio; si no hay anuncio, no ocupa sitio. */
  function initBanner(){
    if(SIN_ANUNCIOS || !ADS.client || !ADS.bannerSlot || document.getElementById('hgBanner')) return;
    const st = document.createElement('style');
    st.textContent = '.hg-banner{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;justify-content:center;align-items:center;height:56px;'
      + 'padding-bottom:env(safe-area-inset-bottom,0);background:rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .25s;}'
      + '.hg-banner.on{opacity:1;pointer-events:auto;}'
      + '.hg-banner .adsbygoogle{display:inline-block;width:320px;height:50px;}'
      + 'body.hg-has-banner{padding-bottom:calc(58px + env(safe-area-inset-bottom,0)) !important;}';
    document.head.appendChild(st);
    const box = document.createElement('div');
    box.className = 'hg-banner'; box.id = 'hgBanner'; box.setAttribute('aria-label', 'Publicidad');
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.setAttribute('data-ad-client', ADS.client);
    ins.setAttribute('data-ad-slot', ADS.bannerSlot);
    if(ADS.test) ins.setAttribute('data-adtest', 'on');
    box.appendChild(ins);
    document.body.appendChild(box);
    const update = () => {
      const s = ins.getAttribute('data-ad-status');
      const on = s === 'filled';
      box.classList.toggle('on', on);
      document.body.classList.toggle('hg-has-banner', on);
    };
    new MutationObserver(update).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    loadAds().then(ok => {
      if(!ok) return;
      try{ (window.adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBanner); else initBanner();

  async function showRewarded(){
    if(!ADS.client) return demoAd();
    if(!navigator.onLine) return 'unavailable';
    const ok = await loadAds();
    if(!ok || typeof window.adBreak !== 'function') return 'unavailable';
    return new Promise(resolve => {
      let result = null, finished = false;
      const end = r => { if(finished) return; finished = true; clearTimeout(t); resolve(r); };
      const t = setTimeout(() => end(result || 'unavailable'), 15000);   // sin respuesta en 15 s: no hay anuncio
      try{
        window.adBreak({ type: 'reward', name: 'mas_partidas',
          beforeAd(){ clearTimeout(t); },
          beforeReward(showAdFn){ showAdFn(); },
          adViewed(){ result = 'viewed'; },
          adDismissed(){ result = 'dismissed'; },
          adBreakDone(info){ end(result || 'unavailable'); } });
      }catch(e){ end('unavailable'); }
    });
  }
  function demoAd(){
    ensureUI();
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'hg-dlg-ov hg-ad';
      wrap.innerHTML = `<div class="hg-dlg" role="dialog" aria-modal="true"><div class="hg-ad-box">📺<b>Anuncio de prueba</b><small>Aquí saldrá el anuncio de Google AdSense cuando configures tu ID de editor.</small></div>
        <div class="hg-row"><button class="hg-btn" data-r="0">Saltar</button><button class="hg-btn pri" data-r="1" disabled>Espera 5 s</button></div></div>`;
      document.body.appendChild(wrap);
      const b = wrap.querySelector('[data-r="1"]'); let n = 5;
      const iv = setInterval(() => { n--; if(n > 0){ b.textContent = `Espera ${n} s`; } else { clearInterval(iv); b.disabled = false; b.textContent = '✔ Recoger recompensa'; } }, 1000);
      b.onclick = () => { clearInterval(iv); wrap.remove(); resolve('viewed'); };
      wrap.querySelector('[data-r="0"]').onclick = () => { clearInterval(iv); wrap.remove(); resolve('dismissed'); };
    });
  }
  let playsEl = null;
  function renderPlays(){
    if(!playsEl) return;
    const id = pageGame(), left = playsLeft(id);
    playsEl.textContent = `🎟️ ${left}`;
    playsEl.className = 'hg-plays' + (left <= 2 ? ' low' : '');
    playsEl.setAttribute('aria-label', `Te quedan ${left} partidas de hoy`);
  }

  /* ---------- duelos: misma partida (misma semilla) para dos amigos ---------- */
  const DUELS_KEY = 'fc_duels_v1', DSTARTED_KEY = 'fc_duel_started_v1';
  const GAME_FILE = { nbastats:'statshunter.html', nbatrophy:'trophyhunter.html', nbamulti:'nbamulti.html', };
  function readJSON(k, d){ try{ return JSON.parse(localStorage.getItem(k)) || d; }catch(e){ return d; } }
  function writeJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function rememberDuel(id){ const l = readJSON(DUELS_KEY, []).filter(x => x !== id); l.unshift(id); writeJSON(DUELS_KEY, l.slice(0, 30)); }
  function baseUrl(){ return location.origin + location.pathname.replace(/[^/]*$/, ''); }
  function duelLink(gameId, id){ return baseUrl() + GAME_FILE[gameId] + '?duelo=' + id; }
  function duelProgress(id, total){ const st = readJSON(DSTARTED_KEY, {}); st[id] = total; writeJSON(DSTARTED_KEY, st); }
  function fmt(n){ return Number(n || 0).toLocaleString('es-ES'); }

  async function needLogin(text){
    if(user) return true;
    if(!configured){ toast('Los duelos necesitan conexión con el servidor.'); return false; }
    const ok = await dialog({ title:'Entra con Google', text, ok:'Entrar con Google', cancel:'Ahora no' });
    if(!ok) return false;
    await signIn();
    return !!user;
  }
  function pickOpponent(){
    ensureUI();
    return new Promise(resolve => {
      const friends = readFriends();
      const wrap = document.createElement('div');
      wrap.className = 'hg-dlg-ov';
      wrap.innerHTML = `<div class="hg-dlg" role="dialog" aria-modal="true">
        <h3>⚔️ ¿A quién retas?</h3>
        <p>Jugará con los mismos jugadores y en el mismo orden que tú. Gana quien sume más.</p>
        <div class="hg-pick">
          ${friends.map((f,i) => `<button class="hg-pick-b" data-i="${i}">👤 ${esc(f.alias)}</button>`).join('')}
          <button class="hg-pick-b link" data-i="link">📤 Enviar un enlace a quien quiera</button>
        </div>
        ${friends.length ? '' : '<p class="hg-pick-n">Consejo: añade amigos desde tu cuenta para retarles directamente.</p>'}
        <div class="hg-row"><button class="hg-btn" data-i="x">Cancelar</button></div></div>`;
      document.body.appendChild(wrap);
      const done = v => { wrap.remove(); resolve(v); };
      wrap.addEventListener('click', e => {
        if(e.target === wrap) return done(null);
        const b = e.target.closest('[data-i]'); if(!b) return;
        const i = b.dataset.i;
        done(i === 'x' ? null : i === 'link' ? 'link' : friends[+i]);
      });
    });
  }
  async function duelCreate(gameId, seed, score){
    if(!GAME_FILE[gameId]) return;
    if(!(await needLogin('Para retar a un amigo necesitas entrar con Google: así se guarda el resultado de los dos.'))) return;
    const choice = await pickOpponent();
    if(!choice) return;
    let ref;
    try{
      ref = db.collection('duels').doc();
      await ref.set({ game: gameId, seed: seed | 0, by: user.uid, byName: getAlias(),
        to: choice === 'link' ? '' : choice.uid, toName: choice === 'link' ? '' : choice.alias,
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await ref.collection('results').doc(user.uid).set({ name: getAlias(), score: Number(score) || 0, at: firebase.firestore.FieldValue.serverTimestamp() });
    }catch(e){ console.warn('[Basket101] duelo', e); toast('No se pudo crear el duelo. ¿Tienes conexión?'); return; }
    rememberDuel(ref.id);
    const text = `⚔️ Te reto en Basket101 · ${GAMES[gameId].name}: hice ${fmt(score)} puntos con estos jugadores. ¿Me superas?\n${duelLink(gameId, ref.id)}`;
    if(choice === 'link'){ shareText(text); return; }
    const send = await dialog({ title:'⚔️ Reto enviado', text:`${choice.alias} lo verá en «Duelos», en la portada de Basket101. Si quieres, mándale también el enlace.`, ok:'Enviar enlace', cancel:'Cerrar' });
    if(send) shareText(text);
  }
  async function loadResults(id){
    const snap = await db.collection('duels').doc(id).collection('results').get();
    const rows = []; snap.forEach(d => rows.push({ uid: d.id, name: d.data().name, score: d.data().score }));
    return rows.sort((a,b) => b.score - a.score);
  }
  async function submitDuelResult(id, score){
    await db.collection('duels').doc(id).collection('results').doc(user.uid)
      .set({ name: getAlias(), score: Number(score) || 0, at: firebase.firestore.FieldValue.serverTimestamp() });
    const st = readJSON(DSTARTED_KEY, {}); delete st[id]; writeJSON(DSTARTED_KEY, st);
  }
  function duelStatus(d, res){
    const mine = res.find(r => r.uid === (user && user.uid));
    const others = res.filter(r => r.uid !== (user && user.uid));
    if(!mine) return 'toplay';
    if(!others.length) return 'waiting';
    const best = Math.max(...others.map(r => r.score));
    return mine.score > best ? 'won' : mine.score < best ? 'lost' : 'tie';
  }
  function rivalName(d, res){
    const me = user && user.uid;
    const o = res.find(r => r.uid !== me);
    if(o) return o.name;
    return d.by === me ? (d.toName || 'tu rival') : d.byName;
  }
  function showDuelResult(d, res){
    ensureUI();
    const st = duelStatus(d, res), me = user && user.uid;
    const head = { won:'🏆 ¡Has ganado el duelo!', lost:'😬 Has perdido el duelo', tie:'🤝 ¡Empate!', waiting:'⏳ Esperando a tu rival', toplay:'⚔️ Duelo' }[st];
    const sub = st === 'waiting' ? `Cuando ${esc(rivalName(d, res))} juegue verás aquí quién ha ganado.` : `${GAMES[d.game].em} ${GAMES[d.game].name} · mismos jugadores y mismo orden`;
    const wrap = document.createElement('div');
    wrap.className = 'hg-dlg-ov';
    wrap.innerHTML = `<div class="hg-dlg hg-duel" role="dialog" aria-modal="true">
      <h3>${head}</h3><p>${sub}</p>
      <div class="hg-duel-rows">${res.map((r,i) => `<div class="hg-duel-r${r.uid===me?' me':''}"><span>${res.length>1 && i===0 && st!=='tie' ? '👑' : '⚔️'} ${esc(r.uid===me ? 'Tú' : r.name)}</span><b>${fmt(r.score)}</b></div>`).join('')}</div>
      <div class="hg-row">${st === 'waiting' ? '<button class="hg-btn" data-a="link">📤 Enviar enlace</button>' : ''}<button class="hg-btn pri" data-a="ok">Cerrar</button></div></div>`;
    document.body.appendChild(wrap);
    if(st === 'won') playSfx('win');
    wrap.addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if(e.target === wrap || (a && a.dataset.a === 'ok')) wrap.remove();
      if(a && a.dataset.a === 'link') shareText(`⚔️ Te reto en Basket101 · ${GAMES[d.game].name}. ¿Me superas?\n${duelLink(d.game, d.id)}`);
    });
  }
  async function duelFinish(gameId, info, score){
    try{
      await submitDuelResult(info.id, score);
      const snap = await db.collection('duels').doc(info.id).get();
      const d = Object.assign({ id: info.id }, snap.data());
      const res = await loadResults(info.id);
      setTimeout(() => showDuelResult(d, res), 700);
    }catch(e){ console.warn('[Basket101] duelo', e); toast('No se pudo guardar el resultado del duelo. Revisa tu conexión.'); }
  }
  async function openDuel(id){
    await boot(); await authReady;
    if(!(await needLogin('Te han retado a un duelo. Entra con Google para jugarlo y guardar tu resultado.'))) return;
    let snap;
    try{ snap = await db.collection('duels').doc(id).get(); }catch(e){ toast('No se pudo cargar el duelo. Revisa tu conexión.'); return; }
    if(!snap.exists){ info('Puede que el enlace esté mal copiado.', 'Duelo no encontrado'); return; }
    const d = Object.assign({ id }, snap.data());
    if(!window.FC_GAME || d.game !== window.FC_GAME.id){ location.replace(GAME_FILE[d.game] + '?duelo=' + id); return; }
    rememberDuel(id);
    let res = await loadResults(id);
    if(res.some(r => r.uid === user.uid)){ showDuelResult(d, res); return; }
    const started = readJSON(DSTARTED_KEY, {})[id];
    if(started != null){ await submitDuelResult(id, started); showDuelResult(d, await loadResults(id)); return; }
    const go = await dialog({ title:`⚔️ Duelo contra ${d.byName}`,
      text:`Te tocarán los mismos jugadores y en el mismo orden. Verás su puntuación al terminar. Solo tienes un intento: si sales a mitad, cuenta lo que llevabas.`,
      ok:'¡Jugar!', cancel:'Ahora no' });
    if(go) window.FC_GAME.playDuel({ id, seed: d.seed, rival: d.byName });
  }
  async function duelList(limit){
    limit = limit || 12;
    await boot(); await authReady;
    if(!user || !db) return null;
    const ids = new Set(readJSON(DUELS_KEY, []));
    try{
      const [a, b] = await Promise.all([
        db.collection('duels').where('to', '==', user.uid).limit(Math.max(20, limit)).get(),
        db.collection('duels').where('by', '==', user.uid).limit(Math.max(20, limit)).get() ]);
      const docs = {};
      a.forEach(x => docs[x.id] = x.data()); b.forEach(x => docs[x.id] = x.data());
      await Promise.all([...ids].filter(i => !docs[i]).slice(0, Math.max(10, limit)).map(async i => {
        try{ const x = await db.collection('duels').doc(i).get(); if(x.exists) docs[i] = x.data(); }catch(e){}
      }));
      const out = await Promise.all(Object.keys(docs).map(async i => {
        const d = Object.assign({ id: i }, docs[i]);
        const res = await loadResults(i);
        return { id: i, game: d.game, rival: rivalName(d, res), status: duelStatus(d, res), res,
          mine: (res.find(r => r.uid === user.uid) || {}).score, link: GAME_FILE[d.game] + '?duelo=' + i,
          t: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0 };
      }));
      const order = { toplay:0, waiting:1, won:2, lost:2, tie:2 };
      return out.filter(x => GAME_FILE[x.game]).sort((x,y) => order[x.status]-order[y.status] || y.t - x.t).slice(0, limit);
    }catch(e){ console.warn('[Basket101] duelos', e); return []; }
  }

  /* ---------- auth actions ---------- */
  async function signIn(){
    if(!configured){ toast('El inicio de sesión aún no está disponible.'); return; }
    await boot();
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt:'select_account' });
    try{
      await auth.signInWithPopup(provider);
    }catch(e){
      if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/cancelled-popup-request'].includes(e.code)){
        await auth.signInWithRedirect(provider);
      } else if(e.code !== 'auth/popup-closed-by-user'){
        toast(navigator.onLine === false ? 'Sin conexión: no se puede iniciar sesión.' : 'No se pudo iniciar sesión. Inténtalo de nuevo.', 3500);
      }
    }
  }
  async function signOut(){ if(auth) await auth.signOut(); closeMenu(); }

  async function deleteAccount(){
    if(!user) return;
    const okDel = await dialog({ title:'¿Borrar tu cuenta?', text:'Se eliminarán tus marcas guardadas en la nube y tu puesto en el ranking mundial. Esto no se puede deshacer.', ok:'Borrar', danger:true });
    if(!okDel) return;
    try{
      for(const id in GAMES){ try{ await db.collection('rank_' + id).doc(user.uid).delete(); }catch(e){} }
      // rankings diarios de los últimos 60 días
      const dels = [];
      for(let i = 0; i < 60; i++){
        const day = new Date(Date.now() - i*86400000).toISOString().slice(0,10);
        for(const id of ['nbastats','nbatrophy','nbamulti']) dels.push(db.collection(dailyCol(id, day)).doc(user.uid).delete().catch(()=>{}));
      }
      await Promise.all(dels);
      // salas de TresEnRaya online que creé
      try{ const tt = await db.collection('ttt').where('host','==',user.uid).get(); await Promise.all(tt.docs.map(x => db.collection('ttt').doc(x.id).delete().catch(()=>{}))); }catch(e){}
      // duelos: mis resultados y los duelos que creé
      try{
        const [a, b] = await Promise.all([db.collection('duels').where('to','==',user.uid).get(), db.collection('duels').where('by','==',user.uid).get()]);
        const ids = new Set(readJSON(DUELS_KEY, [])); a.forEach(x => ids.add(x.id)); b.forEach(x => ids.add(x.id));
        await Promise.all([...ids].map(id => db.collection('duels').doc(id).collection('results').doc(user.uid).delete().catch(()=>{})));
        await Promise.all(b.docs.map(x => db.collection('duels').doc(x.id).delete().catch(()=>{})));
      }catch(e){}
      try{ await playerDoc().delete(); }catch(e){}
      await userDoc().delete();
      try{ await user.delete(); }
      catch(e){
        if(e.code === 'auth/requires-recent-login'){
          await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
          await user.delete();
        } else throw e;
      }
      localStorage.removeItem(LOCAL_KEY); localStorage.removeItem(ALIAS_KEY); localStorage.removeItem(FRIENDS_KEY); localStorage.removeItem(DUELS_KEY); alias = null;
      closeMenu();
      toast('Tu cuenta y tus datos se han borrado.');
    }catch(e){ info('Inténtalo de nuevo en un momento.', 'No se pudo borrar la cuenta'); }
  }

  /* ---------- SDK boot ---------- */
  function loadScript(src){
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  let bootPromise = null, authResolve = null;
  const authReady = new Promise(r => { authResolve = r; });
  function boot(){
    if(!configured){ authResolve(); return Promise.resolve(); }
    if(bootPromise) return bootPromise;
    bootPromise = (async () => {
      try{
        await loadScript(SDK + 'firebase-app-compat.js');
        await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
        if(!firebase.apps.length) firebase.initializeApp(HG_FIREBASE_CONFIG);
        auth = firebase.auth();
        db = firebase.firestore();
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        auth.getRedirectResult().catch(()=>{});
        auth.onAuthStateChanged(u => {
          user = u; ready = true; if(!u) alias = null; emit(); authResolve();
          if(u) pushCloud();
        });
      }catch(e){
        console.warn('[HG] Firebase no disponible (¿sin conexión?)', e);
        ready = true; emit(); authResolve();
      }
    })();
    return bootPromise;
  }

  /* ---------- UI ---------- */
  function emit(){ renderChip(); renderDaily(); listeners.forEach(fn => { try{ fn(api.state()); }catch(e){} }); }

  const CSS = `
  .hg-chip{display:inline-flex;align-items:center;gap:7px;cursor:pointer;border:1px solid rgba(255,255,255,.24);
    background:rgba(255,255,255,.14);color:#fff;font:700 12.5px/1 var(--font,Poppins,system-ui,sans-serif);
    padding:4px 12px 4px 4px;border-radius:999px;transition:background .15s;max-width:190px;}
  .hg-chip:hover{background:rgba(255,255,255,.22);}
  .hg-chip .hg-av{width:24px;height:24px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden;}
  .hg-chip .hg-av img{width:100%;height:100%;object-fit:cover;}
  .hg-chip .hg-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .hg-gbtn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;border:1px solid #dadce0;
    border-radius:999px;padding:11px 18px;font:700 14px/1 var(--font,Poppins,system-ui,sans-serif);cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.08);}
  .hg-gbtn:hover{background:#f8f9fb;}
  .hg-menu-ov{position:fixed;inset:0;background:rgba(20,24,50,.5);display:none;align-items:center;justify-content:center;padding:16px;z-index:200;}
  .hg-menu-ov.show{display:flex;}
  .hg-menu{background:#fff;color:#1b2440;border-radius:22px;padding:22px 18px 16px;max-width:380px;width:100%;
    box-shadow:0 18px 40px rgba(28,45,110,.35);font-family:var(--font,Poppins,system-ui,sans-serif);}
  .hg-who{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
  .hg-who img,.hg-who .hg-ph{width:46px;height:46px;border-radius:50%;background:#eef1f8;flex:0 0 auto;object-fit:cover;}
  .hg-who b{display:block;font-size:15.5px;}
  .hg-who span{font-size:12px;color:#8791ab;font-weight:600;}
  .hg-marks{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}
  .hg-mark{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#eef1f8;border-radius:12px;padding:9px 12px;font-size:13px;font-weight:700;}
  .hg-mark .hg-l{display:flex;align-items:center;gap:8px;}
  .hg-mark .hg-v{color:#e8960a;font-weight:800;text-align:right;}
  .hg-mark .hg-v small{display:block;color:#8791ab;font-weight:600;font-size:10.5px;}
  .hg-row{display:flex;gap:8px;}
  .hg-btn{flex:1;border:none;border-radius:12px;padding:12px;font:700 13.5px/1 var(--font,Poppins,system-ui,sans-serif);cursor:pointer;background:#eef1f8;color:#1b2440;}
  .hg-btn.pri{background:linear-gradient(135deg,#5b86f5,#2f4ec4);color:#fff;}
  .hg-del{display:block;width:100%;margin-top:10px;background:none;border:none;color:#e24b4b;font:700 12px/1 var(--font,Poppins,system-ui,sans-serif);cursor:pointer;padding:8px;}
  .hg-alias{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;border:1px dashed #cfd6ea;background:#fff;border-radius:12px;padding:10px 12px;margin-bottom:10px;cursor:pointer;font:600 12px/1.2 var(--font,Poppins,system-ui,sans-serif);color:#8791ab;}
  .hg-alias b{color:#1b2440;font-size:13.5px;}
  .hg-rank{display:block;text-align:center;text-decoration:none;background:linear-gradient(120deg,#fff7e6,#ffefd2);border:1px solid rgba(232,150,10,.3);color:#b36f00;font:800 13.5px/1 var(--font,Poppins,system-ui,sans-serif);border-radius:12px;padding:12px;margin-bottom:12px;}
  .hg-note{font-size:11.5px;color:#8791ab;text-align:center;margin:0 0 12px;font-weight:600;}
  .hg-sport{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:.6;margin:12px 2px 4px;}
  .hg-plays{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.16);color:#fff;border-radius:999px;padding:6px 10px;font:800 12.5px var(--font,system-ui);cursor:pointer;white-space:nowrap;}
  /* móviles estrechos: en los juegos la barra de arriba lleva Menú + Reto del día + partidas + cuenta */
  @media (max-width:420px){ .backrow .hg-right{gap:5px;} .hg-plays{padding:6px 8px;} .backrow .hg-daily{padding:6px 9px;font-size:12px;} }
  @media (max-width:389px){ .backrow:has(.hg-plays) .hg-chip .hg-nm{display:none;} .backrow:has(.hg-plays) .hg-chip{padding-right:4px;} }
  @media (max-width:339px){ .backrow:has(.hg-plays) .backlink{font-size:0;gap:0;padding-left:10px;padding-right:12px;} .backrow:has(.hg-plays) .backlink .chev{font-size:17px;} }
  .hg-plays.low{background:#ffb020;color:#3a2600;border-color:#ffb020;}
  .hg-ad-box{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:40px;padding:22px 10px;margin-bottom:12px;border-radius:14px;background:repeating-linear-gradient(135deg,#eef1f8 0 12px,#e3e8f2 12px 24px);color:#1b2440;text-align:center;}
  .hg-ad-box b{font-size:17px;} .hg-ad-box small{font-size:12px;color:#5b6685;line-height:1.35;}
  .hg-btn[disabled]{opacity:.55;cursor:default;}
  .backrow{display:flex;align-items:center;justify-content:space-between;gap:10px;}
  .hg-toggles{display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px;}
  .hg-toggle{border:1px solid #eef1f8;background:#fff;border-radius:10px;width:34px;height:34px;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .hg-toggle.off{opacity:.4;}
  .hg-toggle.hg-lang{font:800 12px/1 var(--font,Poppins,system-ui,sans-serif);color:#1b2440;}
  .hg-links{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}
  .hg-link{display:block;text-align:center;text-decoration:none;background:#eef1f8;color:var(--ink,#1b2440);font:700 13.5px/1 var(--font,Poppins,system-ui,sans-serif);border-radius:12px;padding:11px;cursor:pointer;border:none;}
  .hg-back{background:none;border:none;color:#8791ab;font:700 12.5px/1 var(--font,Poppins,system-ui,sans-serif);cursor:pointer;padding:4px 0 12px;}
  .hg-stat{background:#eef1f8;border-radius:12px;padding:10px 12px;margin-bottom:8px;}
  .hg-stat b{font-size:13.5px;}
  .hg-stat-line{font-size:12px;color:#8791ab;font-weight:600;margin-top:3px;}
  .hg-fr-add{display:flex;gap:6px;margin-bottom:12px;}
  .hg-fr-add input{flex:1;border:1px solid #dfe4f2;border-radius:10px;padding:9px 10px;font:600 13px var(--font,Poppins,system-ui,sans-serif);min-width:0;}
  .hg-fr-add button{border:none;border-radius:10px;padding:9px 12px;background:linear-gradient(135deg,#5b86f5,#2f4ec4);color:#fff;font-weight:700;cursor:pointer;}
  .hg-friend{display:flex;align-items:center;justify-content:space-between;background:#eef1f8;border-radius:12px;padding:9px 12px;margin-bottom:6px;font-size:13px;font-weight:700;}
  .hg-friend button{border:none;background:none;color:#e24b4b;font-size:16px;cursor:pointer;padding:2px 4px;}
  :root[data-theme="dark"] .hg-menu{background:#1b2036;color:#eef1fb;}
  :root[data-theme="dark"] .hg-toggle{background:#252b47;border-color:#333c60;color:#eef1fb;}
  :root[data-theme="dark"] .hg-mark,:root[data-theme="dark"] .hg-link,:root[data-theme="dark"] .hg-stat,:root[data-theme="dark"] .hg-friend{background:#252b47;color:#eef1fb;}
  :root[data-theme="dark"] .hg-btn{background:#252b47;color:#eef1fb;}
  :root[data-theme="dark"] .hg-alias{background:#1b2036;border-color:#333c60;color:#9aa3c4;}
  :root[data-theme="dark"] .hg-alias b{color:#eef1fb;}
  :root[data-theme="dark"] .hg-fr-add input{background:#252b47;border-color:#333c60;color:#eef1fb;}

  /* toast + diálogos propios */
  .hg-toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;pointer-events:none;
    background:#1b2440;color:#fff;font:700 13.5px/1.35 var(--font,Poppins,system-ui,sans-serif);padding:12px 18px;border-radius:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:calc(100% - 32px);text-align:center;z-index:400;transition:opacity .2s,transform .2s;}
  .hg-toast.show{opacity:1;transform:translate(-50%,0);}
  .hg-dlg-ov{position:fixed;inset:0;background:rgba(20,24,50,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:300;}
  .hg-dlg{background:#fff;color:#1b2440;border-radius:20px;padding:20px 18px 16px;max-width:360px;width:100%;box-shadow:0 18px 40px rgba(28,45,110,.35);
    font-family:var(--font,Poppins,system-ui,sans-serif);animation:hgIn .18s ease-out;}
  .hg-dlg h3{margin:0 0 8px;font-size:17px;}
  .hg-dlg p{margin:0 0 14px;font-size:13.5px;line-height:1.5;color:#5b6685;font-weight:500;}
  .hg-dlg input{width:100%;border:1px solid #dfe4f2;border-radius:12px;padding:11px 12px;font:600 14px var(--font,Poppins,system-ui,sans-serif);margin-bottom:14px;}
  .hg-btn.danger{background:#e24b4b;color:#fff;}
  @keyframes hgIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
  :root[data-theme="dark"] .hg-dlg{background:#1b2036;color:#eef1fb;}
  :root[data-theme="dark"] .hg-dlg p{color:#b7bfdc;}
  :root[data-theme="dark"] .hg-dlg input{background:#252b47;border-color:#333c60;color:#eef1fb;}
  :root[data-theme="dark"] .hg-toast{background:#eef1fb;color:#1b2440;}

  /* calendario de retos */
  .hg-menu{max-height:92dvh;overflow-y:auto;}
  .hg-cal{background:#eef1f8;border-radius:14px;padding:12px;margin-bottom:10px;}
  .hg-cal-t{font-weight:800;font-size:14px;margin-bottom:6px;}
  .hg-cal-sum{display:flex;gap:6px;margin-bottom:8px;}
  .hg-cal-sum span{flex:1;background:#fff;border-radius:10px;padding:6px 4px;text-align:center;font-size:10.5px;font-weight:700;color:#8791ab;line-height:1.25;}
  .hg-cal-sum b{display:block;font-size:16px;color:#1b2440;}
  .hg-cal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
  .hg-cal-h b{font-size:13.5px;text-transform:capitalize;}
  .hg-cal-h button{border:none;background:#fff;border-radius:8px;width:30px;height:30px;font-size:17px;cursor:pointer;color:#1b2440;}
  .hg-cal-h button:disabled{opacity:.35;cursor:default;}
  .hg-cal-g{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
  .hg-cal-w{text-align:center;font-size:10px;font-weight:800;color:#8791ab;padding:2px 0;}
  .hg-day{border:none;background:#fff;border-radius:8px;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;cursor:pointer;padding:0;color:#1b2440;font:700 11.5px/1.1 var(--font,Poppins,system-ui,sans-serif);}
  .hg-day small{font-size:8.5px;font-weight:800;}
  .hg-day.fut{opacity:.35;cursor:default;}
  .hg-day.today{box-shadow:inset 0 0 0 2px #5b86f5;}
  .hg-day.sel{outline:2px solid #1b2440;outline-offset:1px;}
  .hg-day.lv0{background:#ffe1e1;} .hg-day.lv1{background:#e2f6ea;} .hg-day.lv2{background:#bfecd1;}
  .hg-day.lv3{background:#8fdeb0;} .hg-day.lv4{background:#4fca86;color:#fff;} .hg-day.lv5{background:#1f9d5c;color:#fff;}
  .hg-cal-d{background:#fff;border-radius:10px;padding:10px;margin-top:8px;}
  .hg-cal-d > b{display:block;font-size:13px;margin-bottom:6px;}
  .hg-cal-r{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:700;padding:4px 0;border-top:1px dashed #eef1f8;}
  .hg-cal-r small{font-size:11.5px;color:#8791ab;font-weight:700;}
  .hg-cal-r.w small{color:#15935a;} .hg-cal-r.l small{color:#d33;}
  .hg-cal-r a{color:#2f4ec4;}
  .hg-daily.lost{background:rgba(255,97,97,.28);border-color:rgba(255,97,97,.6);}
  :root[data-theme="dark"] .hg-cal{background:#252b47;}
  :root[data-theme="dark"] .hg-cal-sum span,:root[data-theme="dark"] .hg-day,:root[data-theme="dark"] .hg-cal-d,:root[data-theme="dark"] .hg-cal-h button{background:#1b2036;color:#eef1fb;}
  :root[data-theme="dark"] .hg-cal-sum b{color:#eef1fb;}
  :root[data-theme="dark"] .hg-day.lv0{background:#4a2530;} :root[data-theme="dark"] .hg-day.lv1{background:#1f3b30;} :root[data-theme="dark"] .hg-day.lv2{background:#22553f;}
  :root[data-theme="dark"] .hg-day.lv3{background:#257049;} :root[data-theme="dark"] .hg-day.lv4{background:#2a8c57;} :root[data-theme="dark"] .hg-day.lv5{background:#34b36e;}
  :root[data-theme="dark"] .hg-day.sel{outline-color:#eef1fb;}

  /* duelos */
  .hg-pick{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:46vh;overflow:auto;}
  .hg-pick-b{border:none;background:#eef1f8;color:#1b2440;border-radius:12px;padding:12px;font:700 14px/1.2 var(--font,Poppins,system-ui,sans-serif);text-align:left;cursor:pointer;}
  .hg-pick-b.link{background:linear-gradient(135deg,#5b86f5,#2f4ec4);color:#fff;}
  .hg-pick-n{font-size:12px !important;margin-top:-4px !important;}
  .hg-duel h3{text-align:center;font-size:19px;}
  .hg-duel p{text-align:center;}
  .hg-duel-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}
  .hg-duel-r{display:flex;justify-content:space-between;align-items:center;background:#eef1f8;border-radius:12px;padding:11px 14px;font-weight:700;font-size:14px;}
  .hg-duel-r b{font-size:18px;color:#e8960a;}
  .hg-duel-r.me{outline:2px solid #5b86f5;}
  :root[data-theme="dark"] .hg-pick-b:not(.link),:root[data-theme="dark"] .hg-duel-r{background:#252b47;color:#eef1fb;}

  /* chip "Reto del día" en los juegos */
  .hg-daily{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.14);
    color:#fff;font:700 12px/1 var(--font,Poppins,system-ui,sans-serif);padding:7px 11px;border-radius:999px;white-space:nowrap;}
  .hg-daily.on{background:#ffb020;border-color:#ffb020;color:#3a2600;}
  .hg-daily.done{background:rgba(32,201,117,.25);border-color:rgba(32,201,117,.6);}
  .backrow{flex-wrap:nowrap;}
  .backrow .hg-right{display:flex;gap:6px;align-items:center;margin-left:auto;min-width:0;}

  /* áreas táctiles de al menos 44px sin cambiar el aspecto */
  .circlebtn,.backlink,.hg-chip,.hg-daily,.hg-toggle{position:relative;}
  .circlebtn::after,.backlink::after,.hg-chip::after,.hg-daily::after,.hg-toggle::after{content:"";position:absolute;inset:-6px;}

  /* accesibilidad */
  :focus-visible{outline:3px solid #ffb020 !important;outline-offset:2px;}
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important;scroll-behavior:auto !important;}
  }
  `;
  const GLOGO = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

  function pl(n){ n = n||0; return n + (n === 1 ? ' partida' : ' partidas'); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------- calendario de retos diarios ---------- */
  let calOffset = 0, calSel = null;
  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  function dayLabel(d){ const [y, m, dd] = d.split('-'); return `${+dd}/${+m}/${y.slice(2)}`; }
  function dayWins(e){ return DAILY.filter(x => e && e[x.id] && e[x.id].w).length; }
  function dayPlayed(e){ return DAILY.filter(x => e && e[x.id]).length; }
  function calendarHTML(){
    const log = readLog(), t = today();
    const now = new Date(t + 'T00:00:00Z');
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + calOffset, 1));
    const y = first.getUTCFullYear(), mo = first.getUTCMonth();
    const daysIn = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;   // semana empieza en lunes
    const key = dd => `${y}-${String(mo+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    let cells = ['L','M','X','J','V','S','D'].map(d => `<span class="hg-cal-w">${d}</span>`).join('');
    for(let i = 0; i < lead; i++) cells += '<span></span>';
    for(let dd = 1; dd <= daysIn; dd++){
      const k = key(dd), e = log[k], p = dayPlayed(e), w = dayWins(e);
      const lv = p ? 'lv' + Math.round(w * 5 / ND) : '';
      cells += `<button class="hg-day ${lv}${k === t ? ' today' : ''}${k === calSel ? ' sel' : ''}${k > t ? ' fut' : ''}" data-day="${k}" ${k > t ? 'disabled' : ''}>
        <span>${dd}</span>${p ? `<small>${w}/${ND}</small>` : ''}</button>`;
    }
    // resumen
    const days = Object.keys(log).filter(d => dayPlayed(log[d])).sort();
    const perfect = days.filter(d => dayWins(log[d]) === ND).length;
    let streak = 0;
    for(let d = new Date(t + 'T00:00:00Z'); ; d = new Date(d.getTime() - 86400000)){
      const k = d.toISOString().slice(0,10);
      if(log[k] && dayPlayed(log[k])) streak++;
      else if(k !== t) break;
      if(streak > 400) break;
    }
    const sel = calSel || t, se = log[sel];
    const detail = `<div class="hg-cal-d">
      <b>${dayLabel(sel)}: ${dayPlayed(se) ? `${dayWins(se)} de ${ND} juegos ganados` : (sel === t ? 'todavía no has jugado ningún reto' : 'no jugaste ningún reto')}</b>
      ${DAILY.map(x => { const r = se && se[x.id], g = GAMES[x.id];
        return `<div class="hg-cal-r ${r ? (r.w ? 'w' : 'l') : ''}"><span>${r ? (r.w ? '✅' : '❌') : '▫️'} ${g.em} ${g.name}</span><small>${r ? (r.s != null ? `${fmt(r.s)} / ${fmt(r.g)}` : (r.w ? 'ganado' : 'perdido')) : (sel === t ? `<a href="${x.file}?diario=1">jugar</a>` : '—')}</small></div>`; }).join('')}
    </div>`;
    return `<div class="hg-cal">
      <div class="hg-cal-t">📅 Retos diarios</div>
      <div class="hg-cal-sum"><span><b>${days.length}</b> días jugados</span><span><b>${perfect}</b> perfectos (${ND}/${ND})</span><span><b>${streak}</b> ${streak === 1 ? 'día' : 'días'} seguidos</span></div>
      <div class="hg-cal-h"><button data-cal="-1" aria-label="Mes anterior">‹</button><b>${MONTHS[mo]} ${y}</b><button data-cal="1" aria-label="Mes siguiente" ${calOffset >= 0 ? 'disabled' : ''}>›</button></div>
      <div class="hg-cal-g">${cells}</div>
      ${detail}
    </div>`;
  }
  function openStats(){ ensureUI(); menuView = 'stats'; calOffset = 0; calSel = today(); renderMenu(); ov.classList.add('show'); }

  function statsHTML(){
    const m = readLocal();
    return calendarHTML() + bySport(id => {
      const g = GAMES[id], v = m[id] || {};
      if(g.kind === 'score'){
        return `<div class="hg-stat"><b>${g.em} ${g.name}</b><div class="hg-stat-line">${pl(v.played)} · mejor puntuación ${v.best!=null?v.best:'–'}</div></div>`;
      }
      const played = v.played || 0, wins = v.wins || 0;
      const pct = played ? Math.round(wins/played*100) : 0;
      let worst = null;
      Object.keys(v.catStats || {}).forEach(cat => {
        const cs = v.catStats[cat];
        if(cs.plays >= 2){
          const failRate = (cs.plays - cs.wins) / cs.plays;
          if(!worst || failRate > worst.failRate) worst = { cat, failRate };
        }
      });
      return `<div class="hg-stat"><b>${g.em} ${g.name}</b>
        <div class="hg-stat-line">${pl(played)} · ${pct}% de victorias</div>
        <div class="hg-stat-line">Racha actual: ${v.streak||0} · récord: ${v.bestStreak||0}</div>
        ${worst ? `<div class="hg-stat-line">Se te resiste: <b>${esc(worst.cat)}</b> (${Math.round(worst.failRate*100)}% de fallos)</div>` : ''}
      </div>`;
    });
  }

  function friendsHTML(){
    const list = readFriends();
    if(!list.length) return `<p class="hg-note">Todavía no has añadido a ningún amigo.</p>`;
    return list.map(f => `<div class="hg-friend"><span>${esc(f.alias)}</span><button data-rmf="${esc(f.uid)}" aria-label="Quitar a ${esc(f.alias)}">✕</button></div>`).join('');
  }

  function markLines(){
    const m = readLocal();
    return bySport(id => {
      const g = GAMES[id], v = m[id] || {};
      let main, sub;
      if(g.kind === 'score'){
        main = v.best != null ? v.best : '–';
        sub = pl(v.played) + (v.dailyDate === today() && v.dailyBest != null ? ` · hoy ${v.dailyBest}` : '');
      } else {
        main = `${v.wins||0} 🏆`;
        sub = pl(v.played) + (v.bestTime != null ? ` · récord ${v.bestTime}s` : '');
      }
      return `<div class="hg-mark"><span class="hg-l"><span>${g.em}</span>${g.name}</span><span class="hg-v">${main}<small>${sub}</small></span></div>`;
    });
  }

  let chipEl = null, ov = null, dailyEl = null;
  const PAGE_GAME = { 'statshunter.html':'nbastats', 'trophyhunter.html':'nbatrophy', 'nbaorder.html':'nbaorder', 'nbamulti.html':'nbamulti', 'nbaraya.html':'nbaraya', 'nbawordle.html':'nbawordle' };
  function pageFile(){ return (location.pathname.split('/').pop() || 'index.html'); }
  function pageGame(){ return PAGE_GAME[pageFile()] || null; }
  function dailyDone(id){ return !!dailyResult(id); }
  function dailyBest(id){ const r = dailyResult(id); return r && r.s != null ? r.s : null; }
  function inDaily(){ try{ return typeof mode !== 'undefined' && mode === 'daily'; }catch(e){ return false; } }
  function renderDaily(){
    if(!dailyEl) return;
    const id = pageGame(), done = dailyDone(id), on = inDaily();
    let duel = null; try{ duel = window.FC_GAME && window.FC_GAME.mode === 'duel' && window.FC_GAME.duel; }catch(e){}
    if(duel){ dailyEl.className = 'hg-daily on'; dailyEl.textContent = `⚔️ vs ${duel.rival || 'rival'}`; dailyEl.setAttribute('aria-label', 'Estás jugando un duelo'); return; }
    dailyEl.className = 'hg-daily' + (done ? ' done' : on ? ' on' : '');
    const res = dailyResult(id);
    dailyEl.className = 'hg-daily' + (done ? (res && res.w ? ' done' : ' lost') : on ? ' on' : '');
    dailyEl.textContent = done ? `📅 Hoy ${res && res.w ? '✅' : '❌'}${res && res.s != null ? ' ' + fmt(res.s) : ''}` : on ? '📅 Jugando el diario' : '📅 Reto del día';
    dailyEl.setAttribute('aria-label', on ? 'Estás jugando el reto del día' : done ? 'Reto del día completado hoy' : 'Jugar el reto del día');
  }
  async function startDaily(){
    try{ if(window.FC_GAME && window.FC_GAME.mode === 'duel'){ toast('Estás jugando un duelo: termínalo primero.'); return; } }catch(e){}
    if(inDaily()) { toast('Ya estás jugando el reto del día: mismos jugadores para todos hoy.'); return; }
    if(!dailyCanStart(pageGame())){ explainBlocked(pageGame()); return; }
    let midRound = false;
    try{ midRound = typeof step !== 'undefined' && step > 0 && typeof gameOver !== 'undefined' && !gameOver; }catch(e){}
    if(midRound && !(await dialog({ title:'¿Jugar el reto del día?', text:'Perderás el progreso de la partida actual.', ok:'Jugar' }))) return;
    const b = document.getElementById('modeDaily'); if(b) b.click();
    renderDaily();
  }
  function ensureUI(){
    if(!document.getElementById('hg-css')){
      const st = document.createElement('style'); st.id = 'hg-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const row = document.querySelector('.backrow');
    if(row && !chipEl){
      const right = document.createElement('div');
      right.className = 'hg-right';
      if(document.getElementById('modeDaily') && pageGame() && DAILY.some(x => x.id === pageGame())){
        dailyEl = document.createElement('button');
        dailyEl.className = 'hg-daily'; dailyEl.type = 'button';
        dailyEl.addEventListener('click', startDaily);
        right.appendChild(dailyEl);
      }
      if(!SIN_ANUNCIOS && pageGame() && GAMES[pageGame()]){
        playsEl = document.createElement('button');
        playsEl.type = 'button'; playsEl.className = 'hg-plays';
        playsEl.addEventListener('click', () => {
          const id = pageGame(), left = playsLeft(id);
          if(left <= 0) return showLimit(id);
          dialog({ title: '🎟️ Partidas de hoy', cancel: false, ok: 'Entendido',
            text: `Te quedan ${left} partidas de ${GAMES[id].name} hoy (${LIMIT.perDay} al día, se renuevan a medianoche).\nCuando se acaben, puedes ver un anuncio para conseguir ${LIMIT.adBonus} más.\n\nEl reto del día, los duelos y el online no gastan partidas.` });
        });
        right.appendChild(playsEl);
        renderPlays();
      }
      chipEl = document.createElement('button');
      chipEl.className = 'hg-chip'; chipEl.type = 'button';
      chipEl.setAttribute('aria-label', 'Tu cuenta, marcas y ajustes');
      chipEl.addEventListener('click', openMenu);
      right.appendChild(chipEl);
      row.appendChild(right);
    }
    if(!ov){
      ov = document.createElement('div');
      ov.className = 'hg-menu-ov';
      ov.addEventListener('click', e => { if(e.target === ov) closeMenu(); });
      document.body.appendChild(ov);
    }
  }
  function renderChip(){
    if(!chipEl) return;
    if(user){
      chipEl.innerHTML = `<span class="hg-av">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : '👤'}</span><span class="hg-nm">${esc((user.displayName||'Mi cuenta').split(' ')[0])}</span>`;
    } else {
      chipEl.innerHTML = `<span class="hg-av">${GLOGO}</span><span class="hg-nm">Entrar</span>`;
    }
    if(ov && ov.classList.contains('show')) renderMenu();
  }
  let menuView = 'main';
  /* ---------- idioma: inglés en la raíz, castellano en /es/ (lo genera build.py) ---------- */
  function langNow(){ return (document.documentElement.lang || 'es').slice(0, 2) === 'en' ? 'en' : 'es'; }
  function otherLangUrl(){
    const p = location.pathname, rest = location.search + location.hash;
    return (/\/es\/[^\/]*$/.test(p) ? p.replace(/\/es\/([^\/]*)$/, '/$1') : p.replace(/[^\/]*$/, 'es/$&')) + rest;
  }
  function switchLang(){
    const to = langNow() === 'en' ? 'es' : 'en';
    try{ localStorage.setItem('b101_lang', to); }catch(e){}
    location.href = otherLangUrl();
  }
  function togglesHTML(){
    return `<div class="hg-toggles">
      <button class="hg-toggle hg-lang" data-a="lang" title="English / Español" aria-label="English / Español">${langNow() === 'en' ? 'ES' : 'EN'}</button>
      <button class="hg-toggle${sfxEnabled()?'':' off'}" data-a="sfx" title="Sonido y vibración" aria-label="Sonido y vibración">${sfxEnabled() ? '🔊' : '🔇'}</button>
      <button class="hg-toggle" data-a="theme" title="Modo oscuro" aria-label="Cambiar modo claro u oscuro">${getTheme()==='dark' ? '☀️' : '🌙'}</button>
    </div>`;
  }
  function renderMenu(){
    if(menuView === 'stats'){
      ov.innerHTML = `<div class="hg-menu">
        <button class="hg-back" data-a="back">‹ Volver</button>
        <h2 style="margin:0 0 12px;font-size:18px;">📊 Tus estadísticas</h2>
        ${statsHTML()}
        <div class="hg-row" style="margin-top:6px;"><button class="hg-btn pri" data-a="close">Cerrar</button></div>
      </div>`;
      ov.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => { calOffset += +b.dataset.cal; if(calOffset > 0) calOffset = 0; renderMenu(); }));
      ov.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { calSel = b.dataset.day; renderMenu(); }));
    } else if(menuView === 'friends'){
      ov.innerHTML = `<div class="hg-menu">
        <button class="hg-back" data-a="back">‹ Volver</button>
        <h2 style="margin:0 0 10px;font-size:18px;">👥 Amigos</h2>
        ${user ? `<div class="hg-fr-add"><input type="text" id="hgFrName" placeholder="Nombre de ranking exacto" maxlength="20"><button data-a="addf">Añadir</button></div>
          ${friendsHTML()}
          <p class="hg-note">Solo puedes añadir a alguien que ya haya jugado con sesión iniciada.</p>`
          : `<p class="hg-note">Inicia sesión para añadir amigos y comparar marcas con ellos.</p>`}
        <div class="hg-row" style="margin-top:6px;"><button class="hg-btn pri" data-a="close">Cerrar</button></div>
      </div>`;
      if(user){
        const inp = ov.querySelector('#hgFrName');
        ov.querySelector('[data-a="addf"]').addEventListener('click', async () => {
          const v = inp.value; if(!v.trim()) return;
          await addFriend(v); inp.value=''; renderMenu();
        });
        ov.querySelectorAll('[data-rmf]').forEach(b => b.addEventListener('click', async () => {
          await removeFriend(b.dataset.rmf); renderMenu();
        }));
      }
    } else {
      ov.innerHTML = `<div class="hg-menu">
        ${togglesHTML()}
        ${user
          ? `<div class="hg-who">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : '<div class="hg-ph"></div>'}<div><b>${esc(user.displayName||'Jugador')}</b><span>${esc(user.email||'')}</span></div></div>`
          : `<p class="hg-note">Entra con Google para guardar tus marcas en la nube y aparecer en el ranking mundial.</p>`}
        ${user ? `<button class="hg-alias" data-a="alias"><span>Nombre en el ranking</span><b>${esc(getAlias())} ✏️</b></button>` : ''}
        <div class="hg-marks">${markLines()}</div>
        <div class="hg-links">
          <button class="hg-link" data-a="stats">📊 Ver mis estadísticas</button>
          <a class="hg-link" href="online.html">🌐 Online: jugar, duelos y resultados</a>
          <button class="hg-link" data-a="friends">👥 Amigos</button>
          <a class="hg-rank" href="ranking.html">🌍 Ver ranking mundial</a>
        </div>
        <div class="hg-row">
          ${user ? `<button class="hg-btn" data-a="out">Cerrar sesión</button>` : `<button class="hg-gbtn" data-a="in" style="flex:1">${GLOGO} Entrar con Google</button>`}
          <button class="hg-btn pri" data-a="close">Cerrar</button>
        </div>
        ${user ? `<button class="hg-del" data-a="del">Borrar mi cuenta y mis datos</button>` : ''}
      </div>`;
    }
    ov.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if(a === 'in') signIn();
      if(a === 'out') signOut();
      if(a === 'close') closeMenu();
      if(a === 'del') deleteAccount();
      if(a === 'alias') editAlias();
      if(a === 'sfx') toggleSfx();
      if(a === 'theme') toggleTheme();
      if(a === 'lang') switchLang();
      if(a === 'stats'){ menuView = 'stats'; calOffset = 0; calSel = today(); renderMenu(); }
      if(a === 'friends'){ menuView = 'friends'; renderMenu(); }
      if(a === 'back'){ menuView = 'main'; renderMenu(); }
    }));
  }
  function openMenu(){ ensureUI(); menuView = 'main'; renderMenu(); ov.classList.add('show'); }
  function closeMenu(){ if(ov) ov.classList.remove('show'); }

  /* ---------- public API ---------- */
  const api = {
    report, signIn, signOut, deleteAccount, openMenu, editAlias,
    getDb: async () => { await boot(); return db; },
    uid: () => user ? user.uid : null,
    alias: () => user ? getAlias() : null,
    games: GAMES,
    marks: readLocal,
    googleLogo: GLOGO,
    plural: pl,
    lang: { now: langNow, switch: switchLang, otherUrl: otherLangUrl },
    sfx: { play: playSfx, enabled: sfxEnabled, toggle: toggleSfx },
    theme: { get: getTheme, toggle: toggleTheme },
    share: shareResult,
    shareText,
    toast, dialog, requireLogin: needLogin, ready: () => authReady,
    limit: { begin: beginPlay, left: playsLeft, used: playsUsed, perDay: LIMIT.perDay, bonus: LIMIT.adBonus, show: showLimit, add: addPlays },
    ads: { showRewarded, configured: () => !!ADS.client },
    daily: { done: dailyDone, best: dailyBest, result: dailyResult, canStart: dailyCanStart, progress: dailyProgress, explainBlocked, col: dailyCol, today,
             games: DAILY, goal: goalOf, log: readLog, text: resultText, dayLabel },
    openStats,
    duel: { create: duelCreate, finish: (g, i, s) => { duelFinish(g, i, s).then(renderDaily); }, progress: duelProgress, list: duelList, open: openDuel },
    friends: { list: readFriends, add: addFriend, remove: removeFriend, ranking: friendsRanking },
    state: () => ({ user, ready, configured, marks: readLocal() }),
    onChange(fn){ listeners.push(fn); fn(api.state()); },
  };
  window.HG = api;

  readLocal(); // seed the mirror from pre-existing bests before any game can finish
  migrateLegacyDaily();
  function init(){
    ensureUI(); renderChip();
    try{
      const f = pageFile();
      const help = document.getElementById('helpOverlay');
      if(help && pageGame() && !localStorage.getItem('fc_help_seen_' + f)){
        localStorage.setItem('fc_help_seen_' + f, '1');
        setTimeout(() => help.classList.add('show'), 350);
      }
      if(pageGame()) finalizeAbandonedDaily(pageGame());
      const dm = location.search.match(/[?&]duelo=([A-Za-z0-9_-]{6,40})/);
      if(dm && window.FC_GAME){ setTimeout(() => openDuel(dm[1]).then(renderDaily), 0); }
      else if(/[?&]diario=1/.test(location.search) && document.getElementById('modeDaily') && DAILY.some(x => x.id === pageGame())){
        setTimeout(() => { document.getElementById('modeDaily').click(); renderDaily(); }, 0);
      }
    }catch(e){}
    ['modeDaily','modeClassic'].forEach(id => { const b = document.getElementById(id); if(b) b.addEventListener('click', () => setTimeout(renderDaily, 0)); });
    renderDaily();
    boot();
    if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
