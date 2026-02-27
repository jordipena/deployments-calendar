# 🗓 DeployCal — Guía de despliegue

## Estructura del proyecto

```
deploycal/
├── server.js          ← Backend (Node.js + Express)
├── package.json
├── railway.toml       ← Config de Railway
├── .env.example       ← Variables de entorno (copia a .env)
└── public/
    └── index.html     ← Frontend
```

---

## Paso 1 — Subir el código a GitHub

1. Crea un repositorio en GitHub (puede ser privado)
2. Sube todo el contenido de esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/TU_USUARIO/deploycal.git
   git push -u origin main
   ```

---

## Paso 2 — Crear el backend en Railway

1. Ve a [railway.app](https://railway.app) y crea una cuenta (gratis)
2. Clic en **New Project → Deploy from GitHub repo**
3. Selecciona tu repositorio
4. Railway detectará el `railway.toml` y desplegará automáticamente

### Añadir PostgreSQL

1. En tu proyecto de Railway, clic en **New → Database → PostgreSQL**
2. Railway creará la base de datos y añadirá `DATABASE_URL` automáticamente a tus variables de entorno

### Añadir las variables de entorno

En Railway → tu servicio → **Variables**, añade:

| Variable | Valor |
|---|---|
| `JIRA_PRODUCTION_COLUMN` | El nombre exacto de tu columna en Jira (ej: `In Production`) |
| `JIRA_BASE_URL` | `https://tuempresa.atlassian.net` |
| `WEBHOOK_SECRET` | Una cadena aleatoria, ej: `mi_secreto_123` |
| `NODE_ENV` | `production` |

> Una vez desplegado, Railway te dará una URL del tipo `https://deploycal-production.up.railway.app`. Anótala.

---

## Paso 3 — Actualizar la URL en el frontend

Abre `public/index.html` y busca esta línea:

```js
: 'https://YOUR_RAILWAY_APP.railway.app'; // ← update after deploy
```

Cámbiala por tu URL real de Railway y vuelve a hacer push:

```bash
git add public/index.html
git commit -m "update API base URL"
git push
```

---

## Paso 4 — Hospedar el frontend en Netlify

1. Ve a [netlify.com](https://netlify.com) y crea una cuenta (gratis)
2. **Add new site → Import an existing project → GitHub**
3. Selecciona tu repositorio
4. Configura el build:
   - **Base directory:** (vacío)
   - **Publish directory:** `public`
   - **Build command:** (vacío)
5. Clic en **Deploy**

Netlify te dará una URL del tipo `https://deploycal.netlify.app`. Esta es la URL que compartirás con tu equipo.

---

## Paso 5 — Configurar el webhook en Jira

1. En Jira, ve a **Configuración → Sistema → WebHooks**
   *(necesitas ser administrador de Jira)*
2. Clic en **Crear WebHook**
3. Rellena:
   - **Nombre:** `DeployCal`
   - **URL:** `https://TU_APP.railway.app/webhook/jira?token=TU_WEBHOOK_SECRET`
   - **Eventos:** marca **Issue → updated**
   - Opcionalmente en **JQL Filter** puedes limitar a un proyecto: `project = "MI_PROYECTO"`
4. Guarda

### ¿Cómo sabe el servidor qué columna es producción?

Cuando mueves una tarea en Jira, el webhook envía el nombre del estado anterior y el nuevo. El servidor compara el nuevo estado con la variable `JIRA_PRODUCTION_COLUMN` que configuraste en Railway. **El nombre debe coincidir exactamente**, incluyendo mayúsculas.

Para ver el nombre exacto de tu columna: en Jira, ve a tu board → **Configuración del board → Columnas**.

---

## Uso diario

- El calendario se actualiza automáticamente cada 30 segundos
- Cuando alguien mueva una tarea a la columna de producción en Jira, aparecerá en el calendario en menos de un minuto
- También se pueden añadir deploys manualmente desde el formulario
- Los deploys registrados desde Jira muestran un enlace directo a la tarea

---

## Troubleshooting

**El webhook no llega:**
- Verifica que la URL del webhook incluye `?token=TU_SECRET`
- Comprueba los logs en Railway (pestaña **Logs** de tu servicio)

**El nombre de columna no coincide:**
- La variable `JIRA_PRODUCTION_COLUMN` debe ser el nombre del **estado** de Jira, no el nombre de la columna del board. Puedes verlos en **Configuración del proyecto → Flujo de trabajo**.

**El frontend no carga datos:**
- Abre la consola del navegador (F12) y comprueba si hay errores de CORS o de red
- Verifica que la URL en `API_BASE` del `index.html` es correcta
