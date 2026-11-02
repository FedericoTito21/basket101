# -*- coding: utf-8 -*-
"""
Basket101 · genera datos-nba.js a partir de NBA_datos.xlsx (hoja "NBA Players").

    python3 build_nba.py                      # usa NBA_datos.xlsx
    python3 build_nba.py otro.xlsx            # usa otro Excel

Si cambias o amplías el Excel (más jugadores, cifras corregidas), vuelve a ejecutarlo.
Las columnas se buscan por su nombre en la primera fila.
"""
import json, os, sys, openpyxl

NAME_FIX = {'Lebron James': 'LeBron James', 'Nikola Jokic': 'Nikola Jokić'}
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else 'NBA_datos.xlsx')

# columna del Excel -> (id, nombre en el juego, emoji)
STATS = [   # StatsHunter (multiplicadores: triples-dobles ×5, triples ×2)
  ('Total points',          'pts',  'Puntos',        '🏀', 1),
  ('Total rebounds',        'reb',  'Rebotes',       '🙌', 1),
  ('Total assists',         'ast',  'Asistencias',   '🤝', 1),
  ('Totals steals',         'stl',  'Robos',         '🥷', 1),
  ('Total blocks',          'blk',  'Tapones',       '✋', 1),
  ('Total triples doubles', 'td',   'Triples-dobles','🔺', 5),
  ('Total three points',    'tp',   'Triples',       '🎯', 2),
]
TROPHIES = [  # TrophyHunter y MultiHunter NBA (MVP y anillos ×2 en TrophyHunter)
  ('MVPs',           'mvp',     'MVP',                 '🏆'),
  ('Champions',      'ring',    'Campeón NBA',         '💍'),
  ('allnba',         'allnba',  'All-NBA',             '🌟'),
  ('alldefensive',   'alldef',  'All-Defensive',       '🛡️'),
  ('allstar',        'allstar', 'All-Star',            '⭐'),
  ('Draft Pick',     'draft1',  'Nº1 del Draft',       '🥇'),   # 1 si fue elegido el nº 1
  ('Scoring Champ',  'scoring', 'Máximo anotador',     '🔥'),
  ('Assist Champ',   'assistc', 'Máximo asistente',    '🎁'),
  ('Rebound Champo', 'reboundc','Máximo reboteador',   '💪'),
  ('Steal Champ',    'stealc',  'Líder en robos',      '🧤'),
  ('Block Champo',   'blockc',  'Líder en tapones',    '🚫'),
  ('ROY',            'roy',     'Rookie del Año',      '🐣'),
  ('DPOY',           'dpoy',    'Mejor Defensor',      '🧱'),
  ('Finals MVP',     'fmvp',    'MVP de las Finales',  '🏅'),
]
ORDER = [  # NBAorder: (columna, id, nombre, emoji, unidad, arriba, abajo)
  ('Max. points per game',   'maxpts', 'Máx. puntos por partido',      '🏀', 'pts', 'Más', 'Menos'),
  ('Max. rebounds per game', 'maxreb', 'Máx. rebotes por partido',     '🙌', 'reb', 'Más', 'Menos'),
  ('Max. assists per game',  'maxast', 'Máx. asistencias por partido', '🤝', 'ast', 'Más', 'Menos'),
  ('Max. steals per game',   'maxstl', 'Máx. robos por partido',       '🥷', 'rob', 'Más', 'Menos'),
  ('Max. blocks per game',   'maxblk', 'Máx. tapones por partido',     '✋', 'tap', 'Más', 'Menos'),
  ('Total teams',            'teams',  'Equipos en su carrera',        '👕', 'equipos', 'Más', 'Menos'),
  ('años de carrera',        'years',  'Temporadas en la NBA',         '📅', 'temporadas', 'Más', 'Menos'),
  ('NBA Debut',              'debut',  'Año de debut en la NBA',       '🗓️', '', 'Más reciente', 'Más antiguo'),
  ('Height',                 'height', 'Altura',                       '📏', 'cm', 'Más alto', 'Más bajo'),
  ('Weight',                 'weight', 'Peso',                         '⚖️', 'kg', 'Más pesado', 'Más ligero'),
]

# ---------------------------------------------------------------- medallas automáticas
# Se simulan miles de partidas con los jugadores de nivel 1 y se ponen los objetivos en los
# mismos percentiles que los demás Hunter: así, con 50 o con 800 jugadores, cuesta lo mismo.
SIMS = 3000

def _opt(vals):
    """Mejor reparto posible (cada jugador a una categoría distinta): DP sobre máscaras."""
    n = len(vals)
    dp = [-1] * (1 << n); dp[0] = 0
    for m in range(1 << n):
        if dp[m] < 0: continue
        i = bin(m).count('1')
        if i >= n: continue
        row = vals[i]
        for c in range(n):
            if not m & (1 << c):
                v = dp[m] + row[c]
                if v > dp[m | (1 << c)]: dp[m | (1 << c)] = v
    return dp[(1 << n) - 1]

def _greedy(vals):
    used, s = set(), 0
    for row in vals:
        c = max((c for c in range(len(row)) if c not in used), key=lambda c: row[c])
        used.add(c); s += row[c]
    return s

def _q(a, p): a = sorted(a); return a[min(len(a) - 1, int(p * len(a)))]

def _targets(g, o, pg, po1, po2, step):
    b, pl, go = _q(g, pg), _q(o, po1), _q(o, po2)
    b, pl, go = (int(x // step * step) for x in (b, pl, go))
    pl = max(pl, b + step); go = max(go, pl + step)
    return [max(step, b), pl, go]

def calibrate(pool, trophies):
    import random
    rng = random.Random(2026)
    out = {}
    # StatsHunter: las 7 estadísticas, 7 jugadores
    G, O = [], []
    for _ in range(SIMS):
        deck = rng.sample(pool, 7)
        vals = [[p['stats'][i] * m for (c, i, n, e, m) in STATS] for p in deck]
        G.append(_greedy(vals)); O.append(_opt(vals))
    out['nbastats'] = _targets(G, O, .37, .40, .86, 1000)
    # TrophyHunter: MVP y anillos ×2 fijas + 6 al azar, 8 jugadores
    fixed = ['mvp', 'ring']; rest = [t[1] for t in trophies if t[1] not in fixed]
    G, O = [], []
    for _ in range(SIMS):
        cats = [(i, 2) for i in fixed] + [(i, 1) for i in rng.sample(rest, 6)]
        deck = rng.sample(pool, 8)
        vals = [[p['stats'][i] * m for (i, m) in cats] for p in deck]
        G.append(_greedy(vals)); O.append(_opt(vals))
    out['nbatrophy'] = _targets(G, O, .37, .40, .85, 5)
    # MultiHunter NBA: un premio, 5 ganadores, ×1..×5
    cands = [t[1] for t in trophies if t[1] not in ('roy', 'draft1')]
    elig = [i for i in cands if sum(1 for p in pool if p['stats'][i] > 0) >= 5]
    G, O = [], []
    for _ in range(SIMS * 3):
        cat = rng.choice(elig)
        vs = [p['stats'][cat] for p in rng.sample([p for p in pool if p['stats'][cat] > 0], 5)]
        G.append(sum(v * m for v, m in zip(vs, [5, 4, 3, 2, 1])))
        O.append(sum(v * m for v, m in zip(sorted(vs, reverse=True), [5, 4, 3, 2, 1])))
    out['nbamulti'] = _targets(G, O, MULTI_P[0], MULTI_P[1], MULTI_P[2], 5)
    return out

MULTI_P = (.20, .45, .70)


def main():
    ws = openpyxl.load_workbook(SRC, data_only=True)['NBA Players']
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else '' for h in rows[0]]
    col = {h: i for i, h in enumerate(hdr)}
    players, fixes = [], []
    for r in rows[1:]:
        if not r or not r[0]: continue
        name = str(r[0]).strip()
        name = NAME_FIX.get(name, name)
        def v(c):
            x = r[col[c]] if c in col and col[c] < len(r) else None
            try:
                return 0 if x is None or x == '' else (int(x) if float(x).is_integer() else round(float(x), 1))
            except (TypeError, ValueError):
                return 0
        st = {}
        for c, i, *_ in STATS: st[i] = v(c)
        for c, i, *_ in TROPHIES: st[i] = v(c)
        st['draft1'] = 1 if v('Draft Pick') == 1 else 0
        st['draftpick'] = v('Draft Pick')
        for c, i, *_ in ORDER: st[i] = v(c)
        # corrección de erratas evidentes del año de debut (p. ej. 1196 -> 1996)
        if st['debut'] and st['debut'] < 1940:
            fixed = int('19' + str(st['debut'])[-2:])
            fixes.append(f"{name}: debut {st['debut']} -> {fixed}"); st['debut'] = fixed
        lvl = v('Nivel') if 'Nivel' in col else 1
        def t(c):
            x = r[col[c]] if c in col and col[c] < len(r) else None
            return str(x).strip() if x not in (None, '') else ''
        info = {'teams': [x.strip() for x in t('Equipos').split(',') if x.strip()],
                'pos': t('Posición'), 'country': t('País'), 'school': t('Universidad')}
        players.append({'name': name, 'lvl': 2 if lvl == 2 else 1, 'stats': st, 'info': info})

    # nombres repetidos (padre e hijo…): al menos conocido se le añade el año de debut
    seen = {}
    for p in sorted(players, key=lambda p: (p['lvl'], -p['stats']['pts'])):
        k = p['name'].lower()
        if k in seen: p['name'] = f"{p['name']} ({p['stats']['debut']})"
        seen[k] = 1
    for p in players:
        p['tag'] = f"Debut {p['stats']['debut']} · {p['stats']['years']} temporadas"

    pool = [p for p in players if p['lvl'] == 1]
    if len(pool) < 30: pool = players
    targets = calibrate(pool, TROPHIES)

    keys = [i for (c, i, *_) in STATS] + [i for (c, i, *_) in TROPHIES] + ['draftpick'] + [i for (c, i, *_) in ORDER]
    data = {
        'stats':    [dict(id=i, name=n, em=e, mult=m) for (c, i, n, e, m) in STATS],
        'trophies': [dict(id=i, name=n, em=e, mult=1) for (c, i, n, e) in TROPHIES],
        'order':    [dict(id=i, name=n, em=e, unit=u, up=a, down=b) for (c, i, n, e, u, a, b) in ORDER],
        'targets':  targets,
        'keys':     keys,
        'rows':     [[p['name'], p['lvl']] + [p['stats'][k] for k in keys] for p in players],
    }
    # datos de texto (equipos, posición, país, universidad) si el Excel los tiene
    if any(p['info']['teams'] or p['info']['pos'] or p['info']['country'] for p in players):
        tn = sorted({t for p in players for t in p['info']['teams']})
        ti = {t: i for i, t in enumerate(tn)}
        data['teamNames'] = tn
        data['info'] = [[[ti[t] for t in p['info']['teams']], p['info']['pos'], p['info']['country'], p['info']['school']] for p in players]
    # formato compacto (una fila por jugador); el navegador lo convierte en objetos al cargar
    js = (f'/* Basket101 · datos generados por build_nba.py desde {os.path.basename(SRC)} (no editar a mano) */\n'
          'window.FC_NBA = (function(D){\n'
          '  const players = D.rows.map((r, j) => { const st = {}; D.keys.forEach((k, i) => st[k] = r[i + 2]);\n'
          '    const inf = D.info ? D.info[j] : null;\n'
          '    return { name: r[0], lvl: r[1], tag: `Debut ${st.debut} · ${st.years} temporadas`, stats: st,\n'
          '      teams: inf ? inf[0].map(i => D.teamNames[i]) : [], pos: inf ? inf[1] : \'\', country: inf ? inf[2] : \'\', school: inf ? inf[3] : \'\' }; });\n'
          '  const pool = players.filter(p => p.lvl === 1);\n'
          '  return { stats: D.stats, trophies: D.trophies, order: D.order, targets: D.targets, players,\n'
          '           pool: pool.length >= 30 ? pool : players };\n'
          '})(' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ');\n')
    open(os.path.join(HERE, 'datos-nba.js'), 'w', encoding='utf-8').write(js)
    print(f'OK · {len(players)} jugadores ({len(pool)} de nivel 1) · {len(js) // 1024} KB')
    print('Medallas:', ', '.join(f'{k} {v}' for k, v in targets.items()))
    for f in fixes: print('Corregido:', f)

if __name__ == '__main__':
    main()
