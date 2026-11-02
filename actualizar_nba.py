# -*- coding: utf-8 -*-
"""
Basket101 · crea la base de datos NBA a partir de NBA.com (nba_api) + tu Excel.

  - NBA_datos.xlsx es tu base de datos. Columna Fuente:
      'API'  -> la fila se actualiza sola con NBA.com cada vez que lo ejecutas;
      otra   -> ('tu Excel', 'tu Excel + API'…) tus cifras mandan y la API solo rellena huecos.
    Si corriges a mano un jugador de la API, cambia su Fuente a 'tu Excel' para que no se pise.
  - Se añaden cientos de jugadores más desde la API: los máximos de la historia en puntos,
    rebotes, asistencias, robos, tapones y triples, y los mejores anotadores de la última temporada.
  - Cada jugador lleva un "Nivel": 1 = conocido (tus jugadores, All-Stars, MVPs, grandes anotadores),
    2 = el resto. Los Hunter y NBAorder reparten jugadores de nivel 1; en el TresEnRaya vale cualquiera.
    Puedes cambiar el nivel a mano en el Excel.

EJECÚTALO EN TU ORDENADOR (NBA.com bloquea las conexiones desde servidores). En Windows,
doble clic en actualizar_nba.bat, o:

    pip install nba_api openpyxl
    python actualizar_nba.py                   # tus jugadores + ~700 más (tops de 200 por categoría)
    python actualizar_nba.py --top 400         # más jugadores (tops de 400 por categoría)
    python actualizar_nba.py --temporadas 6    # + TODOS los que jugaron 6 temporadas o más (~1.500-2.000)
                                               #   (ampliar_nba.bat hace esto y genera datos-nba.js)
    python actualizar_nba.py --lista extra.txt # añade también los nombres de ese archivo (uno por línea)
    python actualizar_nba.py --solo-excel      # solo tus jugadores
    python actualizar_nba.py --preferir-api    # en tus jugadores, usa las cifras de NBA.com
    python actualizar_nba.py --solo "LeBron James"   # prueba con un jugador (no escribe nada)

La primera vez tarda bastante (unos 30-60 minutos con ~700 jugadores: NBA.com obliga a ir
despacio). Todo se guarda en nba_cache/: si se corta, vuelve a ejecutarlo y sigue donde lo dejó;
las siguientes veces tarda segundos. Con --refrescar vuelve a bajar a los jugadores en activo
(para actualizar sus cifras cada temporada).

Resultado: se actualiza NBA_datos.xlsx (antes se guarda una copia en la carpeta copias/)
+ informe_nba_api.txt. Después:

    python build_nba.py                        # genera datos-nba.js (y ajusta las medallas solo)
    python build.py                            # prepara la web (publicar.bat la sube)

Qué sale de la API:
  - Totales de carrera, máximos por partido, temporadas, equipos (etapas), debut, altura, peso,
    draft y premios (MVP, anillos, All-NBA, All-Defensive, All-Star, ROY, DPOY, MVP Finales).
    Solo temporada regular y solo NBA (no cuenta la ABA).
  - Líder de la liga (puntos, rebotes, asistencias, robos, tapones): con los nº 1 de cada
    temporada de NBA.com (hasta 1968-69 por totales, después por partido).
  - Triples-dobles: NBA.com solo los tiene desde 1996-97; para quien debutó antes queda 0
    (o tu dato si el jugador está en tu Excel).
"""
import argparse, datetime, json, os, re, sys, time, unicodedata

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill
except ImportError:
    sys.exit('Falta openpyxl. Instálalo con:  pip install openpyxl')
try:
    from nba_api.stats.static import players as static_players, teams as static_teams
    from nba_api.stats.endpoints import (commonplayerinfo, playercareerstats, playerawards,
                                         playerdashboardbyyearoveryear, leagueleaders, alltimeleadersgrids,
                                         commonallplayers)
except ImportError:
    sys.exit('Falta nba_api. Instálalo con:  pip install nba_api')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'NBA_datos.xlsx')
REPORT = os.path.join(HERE, 'informe_nba_api.txt')
CACHE = os.path.join(HERE, 'nba_cache')
PAUSA = 0.7          # segundos entre peticiones (NBA.com corta si vas demasiado rápido)
REINTENTOS = 4

# Columnas del Excel, en el mismo orden que NBA_datos.xlsx (+ NBA ID al final para fijar el jugador)
COLUMNS = ['Player', 'MVPs', 'Champions', 'Total points', 'Total rebounds', 'Total assists', 'Totals steals',
           'Total blocks', 'Total triples doubles', 'Total three points', 'Max. points per game',
           'Max. rebounds per game', 'Max. assists per game', 'Max. steals per game', 'Max. blocks per game',
           'Total teams', 'años de carrera', 'allnba', 'alldefensive', 'allstar', 'Draft Pick', 'NBA Debut',
           'Scoring Champ', 'Assist Champ', 'Rebound Champo', 'Steal Champ', 'Block Champo', 'ROY', 'Height',
           'Weight', 'DPOY', 'Finals MVP', 'Equipos', 'Posición', 'País', 'Universidad', 'Nivel', 'Fuente', 'NBA ID']
TEXT_COLS = {'Equipos', 'Posición', 'País', 'Universidad'}

AWARDS = {   # DESCRIPTION en PlayerAwards -> columna
    'NBA Most Valuable Player': 'MVPs',
    'NBA Champion': 'Champions',
    'All-NBA': 'allnba',
    'All-Defensive Team': 'alldefensive',
    'NBA All-Star': 'allstar',
    'NBA Rookie of the Year': 'ROY',
    'NBA Defensive Player of the Year': 'DPOY',
    'NBA Finals Most Valuable Player': 'Finals MVP',
}
# categoría de líder -> (columna, primera temporada con ese dato)
LEADERS = {'PTS': ('Scoring Champ', 1946), 'REB': ('Rebound Champo', 1950), 'AST': ('Assist Champ', 1946),
           'STL': ('Steal Champ', 1973), 'BLK': ('Block Champo', 1973)}
PER_GAME_FROM = 1969   # antes de 1969-70 el líder se decidía por totales


# ---------------------------------------------------------------- utilidades
def norm(s):
    s = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z ]', ' ', s)).strip()

def season_str(y):
    return f'{y}-{str(y + 1)[-2:]}'

def last_completed_season(today=None):
    today = today or datetime.date.today()
    # la temporada regular acaba en abril; a partir de julio damos por cerrada la anterior
    return today.year - 1 if today.month >= 7 else today.year - 2

def num(x):
    if x is None or x == '':
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else round(f, 1)

_last_call = [0.0]
def call(kind, key, fn, refresh=False):
    """Llama a NBA.com con caché en disco, pausa entre peticiones y reintentos."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{kind}_{key}.json')
    if os.path.exists(path) and not refresh:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    err = None
    for i in range(REINTENTOS):
        wait = PAUSA - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        try:
            _last_call[0] = time.time()
            data = fn()
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            return data
        except Exception as e:  # timeouts, 429, cortes...
            err = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f'{kind} {key}: {err}')

def per_season_rows(rows):
    """Una fila por temporada: la de 'TOT' si jugó en varios equipos, si no la única."""
    by = {}
    for r in rows:
        s = r.get('SEASON_ID')
        if s not in by or r.get('TEAM_ABBREVIATION') == 'TOT':
            by[s] = r
    return by


# ---------------------------------------------------------------- lectura del Excel actual
def read_excel(path):
    if not os.path.exists(path):
        return [], {}
    ws = openpyxl.load_workbook(path, data_only=True)['NBA Players']
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else '' for h in rows[0]]
    out = []
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        out.append({h: r[i] for i, h in enumerate(hdr) if h})
    return out, {norm(x['Player']): x for x in out}


# ---------------------------------------------------------------- buscar el jugador en NBA.com
_INDEX = None
def find_ids(name):
    global _INDEX
    if _INDEX is None:
        _INDEX = {}
        for p in static_players.get_players():
            _INDEX.setdefault(norm(p['full_name']), []).append(p)
    return _INDEX.get(norm(name), [])

def info_of(pid, refresh):
    d = call('info', pid, lambda: commonplayerinfo.CommonPlayerInfo(player_id=pid, timeout=40).get_normalized_dict(), refresh)
    return (d.get('CommonPlayerInfo') or [{}])[0]

def resolve(name, excel_row, refresh, notes):
    if excel_row and excel_row.get('NBA ID'):
        return int(excel_row['NBA ID'])
    cands = find_ids(name)
    if not cands:
        notes.append(f'  ⚠ {name}: no está en la lista de jugadores de nba_api (revisa cómo está escrito)')
        return None
    if len(cands) == 1:
        return cands[0]['id']
    # varios con el mismo nombre (p. ej. Patrick Ewing padre e hijo): el del año de debut del Excel,
    # si no, el que más temporadas jugó
    debut = num((excel_row or {}).get('NBA Debut'))
    best, best_key = None, None
    for c in cands:
        inf = info_of(c['id'], refresh)
        key = (debut is not None and num(inf.get('FROM_YEAR')) == debut, num(inf.get('SEASON_EXP')) or 0)
        if best_key is None or key > best_key:
            best, best_key = c['id'], key
    notes.append(f'  ℹ {name}: hay {len(cands)} jugadores con ese nombre, uso el NBA ID {best} (puedes fijarlo en la columna NBA ID)')
    return best


# ---------------------------------------------------------------- líderes de la liga por temporada
def league_leaders(first, last, refresh_last):
    """{ 'PTS': {1990: [player_id, ...]}, ... } con los nº 1 de cada temporada."""
    out, missing = {k: {} for k in LEADERS}, {k: [] for k in LEADERS}
    total = sum(max(0, last - max(first, LEADERS[k][1]) + 1) for k in LEADERS)
    done = 0
    for cat, (_, since) in LEADERS.items():
        for y in range(max(first, since), last + 1):
            done += 1
            mode = 'PerGame' if (y >= PER_GAME_FROM or cat in ('STL', 'BLK')) else 'Totals'
            s = season_str(y)
            print(f'\r  Líderes de cada temporada: {done}/{total} ({cat} {s})      ', end='', flush=True)
            try:
                d = call('leaders', f'{cat}_{s}_{mode}', lambda: leagueleaders.LeagueLeaders(
                    season=s, stat_category_abbreviation=cat, per_mode48=mode,
                    season_type_all_star='Regular Season', timeout=40).get_normalized_dict(),
                    refresh=(refresh_last and y == last))
                rows = d.get('LeagueLeaders') or []
            except Exception:
                rows = []
            top = [r['PLAYER_ID'] for r in rows if r.get('RANK') == 1] or ([rows[0]['PLAYER_ID']] if rows else [])
            if top:
                out[cat][y] = top
            else:
                missing[cat].append(y)
    print()
    return out, missing


# ---------------------------------------------------------------- datos de un jugador
def player_data(pid, refresh):
    inf = info_of(pid, refresh)
    car = call('career', pid, lambda: playercareerstats.PlayerCareerStats(player_id=pid, per_mode36='Totals', timeout=40).get_normalized_dict(), refresh)
    aw = call('awards', pid, lambda: playerawards.PlayerAwards(player_id=pid, timeout=40).get_normalized_dict(), refresh)

    d = {'_name': inf.get('DISPLAY_FIRST_LAST'), '_from': num(inf.get('FROM_YEAR')), '_to': num(inf.get('TO_YEAR'))}
    tot = (car.get('CareerTotalsRegularSeason') or [{}])[0]
    for col, k in [('Total points', 'PTS'), ('Total rebounds', 'REB'), ('Total assists', 'AST'),
                   ('Totals steals', 'STL'), ('Total blocks', 'BLK'), ('Total three points', 'FG3M')]:
        d[col] = num(tot.get(k))

    seasons = car.get('SeasonTotalsRegularSeason') or []
    by = per_season_rows(seasons)
    d['años de carrera'] = len(by) or None
    d['_seasons'] = sorted(int(s[:4]) for s in by)
    for col, k in [('Max. points per game', 'PTS'), ('Max. rebounds per game', 'REB'), ('Max. assists per game', 'AST'),
                   ('Max. steals per game', 'STL'), ('Max. blocks per game', 'BLK')]:
        vals = [r[k] / r['GP'] for r in by.values() if r.get(k) is not None and r.get('GP')]
        d[col] = round(max(vals), 1) if vals else None
    # etapas en equipos (LeBron: CLE, MIA, CLE, LAL = 4), como en tu Excel
    stints, prev = 0, None
    for r in seasons:
        t = r.get('TEAM_ID')
        if not t or r.get('TEAM_ABBREVIATION') == 'TOT':
            continue
        if t != prev:
            stints += 1
            prev = t
    d['Total teams'] = stints or None

    # franquicias en las que jugó (nombre actual: los Minneapolis Lakers cuentan como Lakers)
    names, fr = _franchises(), []
    for r in seasons:
        t = names.get(r.get('TEAM_ID'))
        if t and t not in fr:
            fr.append(t)
    d['Equipos'] = ', '.join(fr) or None
    pos = (inf.get('POSITION') or '').strip()
    d['Posición'] = pos or None
    d['País'] = (inf.get('COUNTRY') or '').strip() or None
    sch = (inf.get('SCHOOL') or '').strip()
    # universidad (no el instituto: los que saltaron directos del instituto quedan sin universidad)
    d['Universidad'] = sch if sch and sch.lower() not in ('none', 'no college') and not re.search(r'\bHS\b|high school', sch, re.I) else None

    d['NBA Debut'] = d['_from']
    h = str(inf.get('HEIGHT') or '')
    m = re.match(r'(\d+)-(\d+)', h)
    d['Height'] = round(int(m.group(1)) * 30.48 + int(m.group(2)) * 2.54) if m else None
    w = num(inf.get('WEIGHT'))
    d['Weight'] = round(w * 0.45359237) if w else None
    dn = str(inf.get('DRAFT_NUMBER') or '')
    d['Draft Pick'] = int(dn) if dn.isdigit() else (0 if dn.lower() == 'undrafted' else None)

    counts = {c: set() for c in AWARDS.values()}
    for a in aw.get('PlayerAwards') or []:
        c = AWARDS.get((a.get('DESCRIPTION') or '').strip())
        if c:
            counts[c].add(a.get('SEASON') or len(counts[c]))
    for c, s in counts.items():
        d[c] = len(s)

    # triples-dobles: NBA.com los tiene desde 1996-97
    if d['_from'] and d['_from'] >= 1996:
        try:
            dash = call('dash', pid, lambda: playerdashboardbyyearoveryear.PlayerDashboardByYearOverYear(
                player_id=pid, per_mode_detailed='Totals', timeout=40).get_normalized_dict(), refresh)
            # por temporada: la fila TOT si existe; si no, la suma de sus equipos
            td = {}
            for r in dash.get('ByYearPlayerDashboard') or []:
                s = r.get('GROUP_VALUE')
                if r.get('TEAM_ABBREVIATION') == 'TOT':
                    td[s] = ('TOT', r.get('TD3') or 0)
                elif not (s in td and td[s][0] == 'TOT'):
                    td[s] = ('SUM', (td.get(s, ('SUM', 0))[1]) + (r.get('TD3') or 0))
            d['Total triples doubles'] = sum(v for _, v in td.values())
        except Exception:
            d['Total triples doubles'] = None
    else:
        d['Total triples doubles'] = None
    return d


# ---------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser(description='Actualiza los datos NBA de Basket101 con nba_api')
    ap.add_argument('--top', type=int, default=200, help='añade los N mejores de la historia en cada categoría (por defecto 200)')
    ap.add_argument('--actuales', type=int, default=60, help='añade los N mejores anotadores de la última temporada (por defecto 60)')
    ap.add_argument('--temporadas', type=int, default=0, help='añade a TODOS los jugadores de la historia con al menos N temporadas en la NBA (p. ej. 6)')
    ap.add_argument('--solo-excel', action='store_true', help='no añade jugadores: solo actualiza los de tu Excel')
    ap.add_argument('--preferir-api', action='store_true', help='en tus jugadores, usa las cifras de NBA.com en vez de las tuyas')
    ap.add_argument('--lista', help='archivo de texto con nombres de jugadores a añadir (uno por línea)')
    ap.add_argument('--solo', help='procesa solo este jugador (para probar)')
    ap.add_argument('--sin-lideres', action='store_true', help='no calcula los títulos de líder (usa los del Excel)')
    ap.add_argument('--refrescar', action='store_true', help='vuelve a descargar los datos de los jugadores en activo')
    ap.add_argument('--excel', default=SRC, help='Excel de partida (por defecto NBA_datos.xlsx)')
    ap.add_argument('--salida', help='guardar en otro archivo en vez de actualizar NBA_datos.xlsx')
    args = ap.parse_args()

    excel_rows, excel_by = read_excel(args.excel)
    # cada fila del Excel va con SU fila (por NBA ID): dos jugadores pueden llamarse igual (Eddie Johnson)
    excel_by_id = {int(r['NBA ID']): r for r in excel_rows if num(r.get('NBA ID'))}
    names = [(r['Player'], r) for r in excel_rows]
    notes = []
    if args.lista:
        with open(args.lista, encoding='utf-8') as f:
            names += [(l.strip(), excel_by.get(norm(l.strip()))) for l in f if l.strip() and not l.startswith('#')]
    extra_ids = []
    if args.top and not args.solo_excel and not args.solo:
        print(f'Buscando los {args.top} mejores de la historia en cada categoría…')
        g = call('alltime', f'top{args.top}', lambda: alltimeleadersgrids.AllTimeLeadersGrids(
            per_mode_simple='Totals', topx=args.top, timeout=90).get_normalized_dict(), refresh=args.refrescar)
        for grid in ('PTSLeaders', 'REBLeaders', 'ASTLeaders', 'STLLeaders', 'BLKLeaders', 'FG3MLeaders'):
            extra_ids += [(r['PLAYER_NAME'], r['PLAYER_ID']) for r in g.get(grid) or []]
    if args.actuales and not args.solo_excel and not args.solo:
        s = season_str(last_completed_season())
        print(f'Buscando los {args.actuales} mejores anotadores de la temporada {s}…')
        try:
            ll = call('leaders', f'PTS_{s}_PerGame', lambda: leagueleaders.LeagueLeaders(
                season=s, stat_category_abbreviation='PTS', per_mode48='PerGame',
                season_type_all_star='Regular Season', timeout=40).get_normalized_dict())
            extra_ids += [(r['PLAYER'], r['PLAYER_ID']) for r in (ll.get('LeagueLeaders') or [])[:args.actuales]]
        except Exception as e:
            notes.append(f'  ⚠ No se pudieron bajar los anotadores de {s}: {e}')
    if args.temporadas and not args.solo_excel and not args.solo:
        print(f'Buscando a todos los jugadores de la historia con {args.temporadas} o más temporadas en la NBA…')
        try:
            allp = call('allplayers', 'historico', lambda: commonallplayers.CommonAllPlayers(
                is_only_current_season=0, league_id='00', timeout=90).get_normalized_dict(), refresh=args.refrescar)
            sel = []
            for r in allp.get('CommonAllPlayers') or []:
                a, b = num(r.get('FROM_YEAR')), num(r.get('TO_YEAR'))
                if r.get('GAMES_PLAYED_FLAG', 'Y') != 'Y' or not a or not b:
                    continue
                if b - a + 1 >= args.temporadas:
                    sel.append((b - a, r.get('DISPLAY_FIRST_LAST'), r.get('PERSON_ID')))
            sel.sort(key=lambda t: -t[0])   # primero las carreras más largas
            extra_ids += [(n, pid) for _, n, pid in sel if n and pid]
            print(f'  {len(sel)} jugadores con {args.temporadas}+ temporadas')
        except Exception as e:
            notes.append(f'  ⚠ No se pudo bajar la lista de todos los jugadores: {e}')
    if args.solo:
        names, extra_ids = [(args.solo, excel_by.get(norm(args.solo)))], []

    # lista final sin repetidos (por NBA ID)
    todo, seen = [], set()
    for n, row in names:
        pid = resolve(n, row, args.refrescar, notes)
        if pid in seen and pid is not None:
            continue
        seen.add(pid)
        todo.append((n, pid, row))
    for n, pid in extra_ids:
        if pid in seen:
            continue
        seen.add(pid)
        todo.append((n, pid, excel_by_id.get(pid)))

    print(f'Descargando {len(todo)} jugadores de NBA.com (la primera vez tarda unos minutos)…')
    datos, fallos = {}, []
    t0, bajados = time.time(), 0
    pendientes = sum(1 for _, p, _ in todo if p and not os.path.exists(os.path.join(CACHE, f'career_{p}.json')))
    if pendientes > 50:
        print(f'  {pendientes} jugadores nuevos que bajar: puede tardar un buen rato (más o menos 1 hora por cada 1.000).')
        print('  Si se corta o cierras la ventana, vuelve a ejecutarlo: sigue donde lo dejó.')
    for i, (n, pid, row) in enumerate(todo, 1):
        if pid is None:
            continue
        if not os.path.exists(os.path.join(CACHE, f'career_{pid}.json')):
            bajados += 1
        falta = ''
        if bajados >= 5:
            mins = (time.time() - t0) / bajados * max(0, pendientes - bajados) / 60
            falta = f' · quedan ~{mins:.0f} min' if mins >= 1 else ''
        print(f'\r  {i}/{len(todo)} {n[:28]:<28}{falta}          ', end='', flush=True)
        try:
            datos[pid] = player_data(pid, args.refrescar and _is_active(pid))
        except Exception as e:
            fallos.append(f'  ✗ {n}: {e}')
    print()

    leaders, missing = None, None
    if not args.sin_lideres and datos:
        first = min(d['_from'] for d in datos.values() if d['_from']) or 1946
        leaders, missing = league_leaders(first, last_completed_season(), args.refrescar)

    # ------------------------------------------------ combinar con el Excel e informe
    out_rows, cambios, nuevos = [], [], []
    for n, pid, row in todo:
        row = row or {}
        d = datos.get(pid)
        if d is None:
            if row:
                keep = {c: row.get(c) for c in COLUMNS}
                keep['Nivel'] = keep.get('Nivel') or 1
                keep['Fuente'] = 'tu Excel'
                out_rows.append(keep)
            continue
        if leaders:
            for cat, (col, since) in LEADERS.items():
                seasons = [y for y in d['_seasons'] if y >= since]
                if any(y in missing[cat] for y in seasons) and row.get(col) is not None:
                    d[col] = None   # faltan temporadas en NBA.com: mejor el del Excel
                    notes.append(f'  ℹ {row.get("Player", n)}: {col} se mantiene del Excel (NBA.com no tiene todas sus temporadas)')
                else:
                    d[col] = sum(1 for y in seasons if pid in leaders[cat].get(y, []))
        name = row.get('Player') or d['_name'] or n
        # Fuente = 'API': la fila se actualiza sola con NBA.com cada vez.
        # Cualquier otra fuente ('tu Excel', 'tu Excel + API'…): tus cifras mandan y la API solo rellena huecos.
        from_api = row.get('Fuente') == 'API' if row else True
        new = {'Player': name, 'NBA ID': pid, 'Fuente': (row.get('Fuente') or 'tu Excel + API') if row else 'API'}
        diffs = []
        for c in COLUMNS[1:-3]:
            api = d.get(c)
            old = (str(row.get(c)).strip() or None) if c in TEXT_COLS and row.get(c) not in (None, '') else (None if c in TEXT_COLS else num(row.get(c)))
            if args.preferir_api or from_api:
                val = api if api is not None else old
            else:
                val = old if old is not None else api     # tus datos mandan
            new[c] = ('' if c in TEXT_COLS else 0) if val is None else val
            if row and not from_api and api is not None and old is not None and api != old:
                diffs.append(f'{c}: tuyo {old} / API {api}')
        lvl = num(row.get('Nivel'))
        if not lvl:
            lvl = level_of(new) if from_api else 1
        elif from_api and lvl == 2 and level_of(new) == 1:
            lvl = 1   # un jugador de la API que se ha hecho conocido (All-Star, MVP…) sube de nivel solo
        new['Nivel'] = lvl
        if not row:
            nuevos.append(name)
        elif diffs:
            cambios.append(f'  ~ {name}: ' + '; '.join(diffs))
        out_rows.append(new)

    if args.solo:   # prueba: solo se muestra, no se toca ningún archivo
        for r in out_rows:
            for c in COLUMNS:
                print(f'  {c:<24} {r.get(c)}')
        print('\n'.join(cambios + notes + fallos) or '  (sin diferencias con tu Excel)')
        print('\n(Modo prueba: no se ha escrito ningún archivo)')
        return

    # ------------------------------------------------ escribir el Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'NBA Players'
    ws.append(COLUMNS)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='1D428A')
    for r in out_rows:
        ws.append([r.get(c) for c in COLUMNS])
    ws.freeze_panes = 'B2'
    ws.column_dimensions['A'].width = 24
    out = args.salida or args.excel
    if os.path.exists(out) and os.path.abspath(out) == os.path.abspath(args.excel):
        import shutil
        os.makedirs(os.path.join(HERE, 'copias'), exist_ok=True)
        bak = os.path.join(HERE, 'copias', f'NBA_datos_{datetime.datetime.now():%Y%m%d_%H%M}.xlsx')
        shutil.copy2(out, bak)
        print(f'Copia de seguridad del Excel anterior: copias/{os.path.basename(bak)}')
    wb.save(out)

    with open(REPORT, 'w', encoding='utf-8') as f:
        f.write(f'Basket101 · informe de actualización con nba_api ({datetime.date.today()})\n')
        f.write(f'Jugadores en la base de datos: {len(out_rows)}\n\n')
        n1 = sum(1 for r in out_rows if r.get('Nivel') == 1)
        f.write(f'Nivel 1 (conocidos, salen en Hunter y NBAorder): {n1} · nivel 2: {len(out_rows) - n1}\n\n')
        f.write(('DIFERENCIAS ENTRE TUS DATOS Y NBA.COM (se usa ' + ('NBA.com' if args.preferir_api else 'el tuyo') + ')\n')
                + ('\n'.join(cambios) or '  (ninguna)') + '\n\n')
        f.write(f'JUGADORES NUEVOS DESDE LA API ({len(nuevos)})\n' + ('\n'.join('  + ' + n for n in nuevos) or '  (ninguno)') + '\n\n')
        f.write('AVISOS\n' + ('\n'.join(notes + fallos) or '  (ninguno)') + '\n')
    print(f'\nListo: {len(out_rows)} jugadores en {os.path.basename(args.salida or args.excel)}')
    print(f'Nuevos: {len(nuevos)} · diferencias con tus datos: {len(cambios)} · avisos: {len(notes) + len(fallos)} → mira informe_nba_api.txt')
    print('Ahora:  python build_nba.py   (y después publicar.bat)')


_FR = None
def _franchises():
    """TEAM_ID de NBA.com -> nombre de la franquicia (Lakers, Celtics…)."""
    global _FR
    if _FR is None:
        _FR = {t['id']: t['nickname'] for t in static_teams.get_teams()}
    return _FR


def level_of(r):
    """1 = jugador conocido (sale en los Hunter y NBAorder), 2 = el resto."""
    g = lambda c: r.get(c) or 0
    return 1 if (g('allstar') >= 2 or g('allnba') >= 1 or g('MVPs') >= 1 or g('Finals MVP') >= 1
                 or g('DPOY') >= 1 or g('Total points') >= 18000) else 2


def _is_active(pid):
    try:
        return bool(static_players.find_player_by_id(pid).get('is_active'))
    except Exception:
        return False


if __name__ == '__main__':
    main()
