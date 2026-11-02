# -*- coding: utf-8 -*-
"""
Basket101 · prepara la web para publicarla en Firebase Hosting.

    python build.py

Crea la carpeta dist/ SOLO con lo que la web necesita (sin Excel ni scripts de Python):
  dist/      -> versión en INGLÉS (la que se ve por defecto)
  dist/es/   -> versión en CASTELLANO
Las páginas se escriben en castellano; el inglés sale de traduccion_en.py.
Después se publica con:   firebase deploy --only hosting   (o con publicar.bat)

Ajustes:
  SITE_URL = dirección pública de la web, sin barra final. Se usa para la imagen de
             vista previa al compartir enlaces (WhatsApp, X, Telegram...).
  DONAR    = formas de donar (PayPal, tarjeta/Google Pay con Ko-fi, Bizum).
"""
import hashlib, json, os, re, shutil, sys

SITE_URL = "https://basket101.web.app"

# Formas de donar (vacío = esa opción no sale; si están todas vacías, no sale el botón de donar)
DONAR = {
    "paypal":  "https://paypal.me/FedericoTito",   # enlace de PayPal.me
    "tarjeta": "",   # enlace de Ko-fi o Buy Me a Coffee (tarjeta, Google Pay, Apple Pay)
    "bizum":   "",   # tu número de teléfono para Bizum, p. ej. "600 123 456" (se mostrará en la web)
}

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'dist')
sys.path.insert(0, HERE)
from traduccion_en import TEXTOS, EXACTOS, NO_TRADUCIR   # noqa: E402

PAGES = ['index.html', 'statshunter.html', 'trophyhunter.html', 'nbaorder.html', 'nbamulti.html', 'nbaraya.html', 'nbawordle.html',
         'ranking.html', 'online.html', 'privacidad.html']
LANG_FILES = PAGES + ['hunter-account.js', 'datos-nba.js', 'sw.js', 'manifest.webmanifest']   # van en los dos idiomas
SHARED = ['404.html', 'og-image.jpg']   # solo en la raíz
DIRS = ['icons', 'fonts']
TEXT = ('.html', '.js', '.css', '.json', '.webmanifest')

# redirige al idioma que eligió el jugador la última vez (si lo cambió con el botón EN/ES)
LANG_SCRIPT = ("<script>(function(){try{var l=localStorage.getItem('b101_lang'),p=location.pathname,r=location.search+location.hash,"
               "es=/\\/es\\/[^\\/]*$/.test(p);if(l==='es'&&!es)location.replace(p.replace(/[^\\/]*$/,'es/$&')+r);"
               "else if(l==='en'&&es)location.replace(p.replace(/\\/es\\/([^\\/]*)$/,'/$1')+r);}catch(e){}})();</script>")


def all_files():
    out = LANG_FILES + SHARED
    for d in DIRS:
        for root, _, names in os.walk(os.path.join(HERE, d)):
            for n in sorted(names):
                out.append(os.path.relpath(os.path.join(root, n), HERE).replace(os.sep, '/'))
    return out


def to_english(s):
    for es, en in EXACTOS:
        s = s.replace(es, en)
    for es, en in sorted(TEXTOS, key=lambda t: -len(t[0])):
        if es == en: continue
        pat = r'([>\'"`}]\s*)' + re.escape(es) + r'(?=\s*[<\'"`$])'
        s = re.sub(pat, lambda m: m.group(1) + en, s)
    return s


SPANISH = re.compile(r'[>\'"`}]\s*([^<>\'"`{}\n]*[áéíóúñ¿¡][^<>\'"`{}\n]*)\s*(?=[<\'"`$])')


def leftovers(s):
    """textos que parecen castellano y siguen sin traducir (para avisar)"""
    return [t for t in (m.group(1).strip() for m in SPANISH.finditer(s)) if t and t not in NO_TRADUCIR]


def main():
    donar = {k: v.strip() for k, v in DONAR.items() if v and v.strip()}
    donar_json = json.dumps(donar, ensure_ascii=False)
    files = all_files()
    missing = [f for f in files if not os.path.exists(os.path.join(HERE, f))]
    if missing: raise SystemExit('Faltan archivos: ' + ', '.join(missing))

    h = hashlib.sha1()
    for f in files + ['traduccion_en.py', 'build.py']:
        if f == 'sw.js': continue
        h.update(f.encode()); h.update(open(os.path.join(HERE, f), 'rb').read())
    h.update(SITE_URL.encode()); h.update(donar_json.encode())
    build = h.hexdigest()[:10]

    if os.path.isdir(DIST): shutil.rmtree(DIST)
    site = SITE_URL.rstrip('/')
    left = {}

    def write(rel, s):
        dst = os.path.join(DIST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'w', encoding='utf-8').write(s)

    for f in files:
        src = os.path.join(HERE, f)
        if not f.endswith(TEXT):
            os.makedirs(os.path.dirname(os.path.join(DIST, f)), exist_ok=True)
            shutil.copy2(src, os.path.join(DIST, f))
            continue
        base = open(src, encoding='utf-8').read()
        if donar:
            base = base.replace('<!--DONAR-->', '').replace('<!--/DONAR-->', '').replace('__DONAR_JSON__', donar_json)
        else:
            base = re.sub(r'<!--DONAR-->.*?<!--/DONAR-->', '', base, flags=re.S)
        base = base.replace('__BUILD__', build)
        if f == 'hunter-account.js':   # objetivos del reto diario = medalla de bronce de datos-nba.js
            m = re.search(r'"targets":(\{[^}]*\})', open(os.path.join(HERE, 'datos-nba.js'), encoding='utf-8').read())
            if m:
                for gid, vals in json.loads(m.group(1)).items():
                    base = re.sub(r"(\{ id:'" + gid + r"',[^}]*goal:)\d+", lambda x: x.group(1) + str(vals[0]), base)
        langs = ('en', 'es') if f in LANG_FILES else ('en',)
        for lang in langs:
            s = base
            if f.endswith('.html'):
                page = f if f in PAGES else ''
                en_url, es_url = site + '/' + ('' if page == 'index.html' else page), site + '/es/' + ('' if page == 'index.html' else page)
                alt = (f'<link rel="alternate" hreflang="en" href="{en_url}">\n<link rel="alternate" hreflang="es" href="{es_url}">\n'
                       f'<link rel="alternate" hreflang="x-default" href="{en_url}">\n') if page else ''
                s = s.replace('<head>', '<head>\n' + LANG_SCRIPT + '\n' + alt, 1)
                s = s.replace('__OTRO_IDIOMA__', ('es/' + f) if lang == 'en' else ('../' + f))
                s = s.replace('__OTRO_LANG__', 'es' if lang == 'en' else 'en')
                s = s.replace('__OTRO_NOMBRE__', 'Español' if lang == 'en' else 'English')
            s = s.replace('__SITE_URL__/og-image.jpg', site + '/og-image.jpg')
            if lang == 'en':
                s = s.replace('<html lang="es">', '<html lang="en">', 1)
                s = s.replace('__SITE_URL__/', site + '/')
                s = to_english(s)
                if f == 'manifest.webmanifest':
                    m = json.loads(s); m['lang'] = 'en'; s = json.dumps(m, ensure_ascii=False, indent=2) + '\n'
                lo = leftovers(s)
                if lo: left[f] = lo
                write(f, s)
            else:
                s = s.replace('__SITE_URL__/', site + '/es/')
                s = re.sub(r'(["\'])(fonts|icons)/', r'\1../\2/', s)   # fuentes e iconos: los de la raíz
                if f == 'sw.js': s = s.replace("'404.html'", "'../404.html'")
                write('es/' + f, s)

    out = [os.path.join(r, n) for r, _, ns in os.walk(DIST) for n in ns]
    size = sum(os.path.getsize(p) for p in out)
    print(f'OK · {len(out)} archivos · {size/1024:.0f} KB · caché basket101-{build} · {site} (inglés) y {site}/es/ (castellano)')
    print('Donaciones: ' + (', '.join(donar) if donar else 'ninguna (no sale el botón de donar)'))
    if left:
        n = sum(len(v) for v in left.values())
        print(f'Aviso: {n} textos parecen seguir en castellano en la versión inglesa (añádelos a traduccion_en.py):')
        for f, lo in left.items():
            for t in lo[:8]: print(f'   {f}: {t[:90]}')


if __name__ == '__main__':
    main()
