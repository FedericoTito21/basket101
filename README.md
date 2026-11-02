# Basket101 · Retos de la NBA

Web de minijuegos sobre la historia de la NBA, con un reto nuevo cada día, ranking mundial y modo online. Está publicada en inglés y en castellano y se puede instalar en el móvil como app.

🔗 **Jugar:** https://basket101.web.app (versión en castellano: https://basket101.web.app/es/)

## Juegos

| Juego | En qué consiste |
| --- | --- |
| **StatsHunter** | Reparte a cada leyenda en la estadística donde más suma. |
| **TrophyHunter** | Coloca a cada leyenda en el premio que más veces ganó. |
| **MultiHunter** | Cinco casillas con multiplicadores de ×1 a ×5 y un premio distinto en cada partida. |
| **TresEnRaya NBA** | Para marcar una casilla, nombra a un jugador que cumpla las condiciones de su fila y de su columna. |
| **NBAorder** | Ordena a cinco leyendas según una estadística (puntos, rebotes, altura, año de debut…). |
| **NBAwordle** | Adivina el apellido de una leyenda en seis intentos. |

Además tiene **ranking mundial y entre amigos**, partidas **online** de TresEnRaya y duelos con amigos.

## Cómo está hecho

- **Frontend**: HTML, CSS y JavaScript sin frameworks. Es una PWA (manifest y service worker), así que se puede instalar en el móvil.
- **Cuentas y rankings**: Firebase Authentication y Firestore, con reglas de seguridad propias (`firestore.rules`).
- **Datos de la NBA** con Python:
  - `actualizar_nba.py` descarga estadísticas y premios de NBA.com con la librería `nba_api` y los guarda en una caché para poder continuar si se corta.
  - `build_nba.py` convierte el Excel `NBA_datos.xlsx` en `datos-nba.js`, que es lo que usa la web.
- **Compilación y traducción**: `build.py` genera la versión en inglés a partir de los textos en castellano (`traduccion_en.py`), avisa de los textos que faltan por traducir, versiona los archivos y prepara la carpeta `dist/` para publicar en Firebase Hosting.

## Tecnologías

HTML · CSS · JavaScript · Python (nba_api, openpyxl) · Firebase (Hosting, Auth, Firestore) · PWA

## Estructura

```
*.html               Una página por juego más la portada, el ranking, el modo online y la privacidad
hunter-account.js    Cuentas, rankings y conexión con Firebase
datos-nba.js         Base de datos de jugadores (generada)
NBA_datos.xlsx       Datos originales de los jugadores
actualizar_nba.py    Descarga de datos desde NBA.com
build_nba.py         Excel → datos-nba.js
build.py             Compila la web (castellano + inglés) en dist/
traduccion_en.py     Traducciones al inglés
firestore.rules      Reglas de seguridad de Firestore
```

## Ejecutar en local

```bash
python build.py                 # genera dist/ en castellano e inglés
npx serve dist                  # o cualquier servidor estático
```

Para actualizar los datos de la NBA:

```bash
pip install nba_api openpyxl
python actualizar_nba.py
python build_nba.py
```

En [LEEME.txt](LEEME.txt) tienes las notas completas sobre cómo publicar y mantener la web.

## Autor

Federico Mathias
