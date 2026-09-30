# Macrobots Platform

Desarrollo de la plataforma interna de Macrobots

## QUICKSTART

### Primera vez

Si es la primera vez que clonas el proyecto, ve a la guía completa de [cómo preparar el entorno](#cómo-preparar-el-entorno).

### Guía rápida una vez configurado

Desde la raíz del proyecto ejecuta en este orden:

```bash
pnpm install    # Siempre desde la raíz
pnpm db:up      # Si tienes DB en Docker
pnpm dev
```

> Si no usas Docker: [Opción B](#opción-b--postgres-local)

## STACK ACTUAL

| Capa | Directorio | Tecnología |
| --- | --- | --- |
| Backend | `apps/api` | NestJS |
| DB | `db/` | Postgres 16 |
| Frontend | `apps/web` | Next.js (App Router) |
| RPA | `apps/scripts` | Python |

## SCRIPTS MONOREPO

### Node apps

| Script | Qué hace |
| --- | --- |
| `pnpm dev` | Levanta api y frontend en paralelo |
| `pnpm dev:api` | Solo la API (`apps/api`) |
| `pnpm dev:web` | Solo el frontend (`apps/web`) |
| `pnpm build` | Compila todas las apps |
| `pnpm lint` | ESLint en todas las apps |
| `pnpm lint:fix` | Aplica fix al código |
| `pnpm typecheck` | `tsc --noEmit` en todas las apps |

### Base de datos (Docker):

| Script | Qué hace |
| --- | --- |
| `pnpm db:up` | Levanta Postgres. La primera vez carga schema y seeds |
| `pnpm db:down` | Apaga el contenedor **conservando** los datos |
| `pnpm db:reset` | Borra el volumen y rehace la BDD desde cero |
| `pnpm db:seed` | añade otro lote de datos |
| `pnpm db:psql` | Abre `psql` dentro del contenedor |
| `pnpm db:logs` | Sigue los logs de Postgres |

> [!TIP] 
> Los scripts propios de cada app siguen funcionando desde su respectivo directorio.

## CÓMO PREPARAR EL ENTORNO

Primer paso: `pnpm install` SOLO desde la raíz del proyecto.

### BASE DE DATOS

#### 1. Colocar los scripts SQL

debes solicitarlos al dueño del repositorio Los `.sql` y colocarlos en `db/`.

```
db/
├── init/    # schema     → 01-schema.sql
└── seed/    # datos      → 10-seed.sql
```

El orden de carga es alfabético: `01–89` para el schema, `10, 11, …` para los seeds.

> [!WARNING] 
> `db/init/90-seed.sh` debe quedar versionado, es el que carga los seeds. no lo toques ni uses el prefijo `90` para otra cosa.

Ver [`db/README.md`](db/README.md) para más el detalle.

#### 2. Levantar la base de datos

##### Opción A (recomendada) — Docker

La primera vez se crea `schemas` en orden y después carga `seeds`.

```bash
cp .env.example .env    # credenciales y puerto de Postgres
pnpm db:up
```

Comprueba que cargó, en este orden:

```bash
pnpm db:logs            # debe mostrar cada .sql de init y las líneas [seed], sin ERROR
pnpm db:psql -c "select count(*) from pg_tables where schemaname='public';"
docker compose ps       # STATUS: "healthy"
```

Por cada modificación a scripts SQL debes rehacer la BDD:

```bash
pnpm db:reset           # borra el volumen y vuelve a cargar todo
```

##### Opción B — Postgres local

Requiere Postgres instalado y corriendo (ajusta puerto/credenciales de tu
instancia en `DATABASE_URL`; los ejemplos asumen `5433` / usuario `postgres`).

```bash
# crear la base
createdb -h 127.0.0.1 -p 5433 -U postgres macrobots_db

# cargar schema y seeds en orden alfabético
for f in db/init/*.sql db/seed/*.sql; do
  psql -h 127.0.0.1 -p 5433 -U postgres -d macrobots_db -v ON_ERROR_STOP=1 -f "$f"
done
```

```powershell
# Windows (PowerShell)
Get-ChildItem db/init/*.sql, db/seed/*.sql | ForEach-Object {
  psql -h 127.0.0.1 -p 5433 -U postgres -d macrobots_db -v ON_ERROR_STOP=1 -f $_.FullName
}
```

> `ON_ERROR_STOP=1` aborta si algo falla, en vez de dejar la BDD a medias.
> El glob `*.sql` deja fuera `90-seed.sh`, que solo tiene sentido dentro del contenedor.

#### 3. Crear el primer usuario para poder entrar

**Obligatorio en un entorno nuevo**: sin esto no se puede iniciar sesión en el frontend.

Precondición: la BDD con seeds cargados (los roles salen de ahí).

```bash
cd apps/api
pnpm exec ts-node -P tsconfig.json scripts/crear-usuario.ts
```

> [!NOTE] 
Solo sirve para el **primer** usuario: en cuanto existe uno que puede iniciar sesión las altas van por la aplicación.

#### 4. Verificación final

```bash
"SELECT count(*) AS tablas FROM pg_tables WHERE schemaname='public';"
"SELECT idrol, nombrerol FROM rol;"
"SELECT idusuario, nombre, email FROM usuario;"
```

Deben aparecer las tablas, al menos un rol y el usuario recién creado.

### BACKEND (API)

```bash
cd apps/api
cp .env.example .env    # opcional: solo si necesitas JWT_SECRET u overrides
```

`DATABASE_URL` y `PORT` ya salen del `.env` de la raíz.

> Si `NODE_ENV=production` entonces necesitas `JWT_SECRET`

### FRONTEND (WEB)

```bash
cd apps/web
cp .env.example .env   # API_URL apunta al backend
```
Requiere la **API levantada** para auth.

Para entrar hace falta [crear un usuario inicial](#4-crear-el-primer-usuario-para-poder-entrar).

### ENTORNOS (`NODE_ENV`)

En el frontend `NODE_ENV` **no se declara ni se configura**: la fija el comando.
Por eso no aparece en `apps/web/.env.example` — no es un olvido.

> *If the environment variable `NODE_ENV` is unassigned, Next.js automatically
> assigns `development` when running the `next dev` command, or `production` for
> all other commands.* — documentación de Next

`pnpm dev` → `development`; `pnpm build` y `pnpm start` → `production`. Vercel
corre `next build`, así que el despliegue queda en producción sin configurar
nada.

Además, en código de cliente `process.env.NODE_ENV` se reemplaza por un literal
al compilar y los bloques que dependen de él se eliminan como código muerto. O
sea que **no se puede activar después del deploy**: queda decidido al compilar.

Por eso el "Detalle técnico" de
[`apps/web/components/ui/pantalla-error.tsx`](apps/web/components/ui/pantalla-error.tsx)
no puede aparecer en producción: no llega al bundle. Comprobable con

```powershell
pnpm --filter web build
Get-ChildItem apps\web\.next\static, apps\web\.next\server -Recurse -Filter *.js |
  Select-String 'Detalle t' -SimpleMatch
```

Sin coincidencias = el texto no existe en lo que se despliega. Para contrastar,
la misma búsqueda sobre `apps\web\.next\dev` sí lo encuentra.

### Scripts Python

Crear y activar el ambiente virtual:

```bash
# Linux / macOS
python3 -m venv venv
source venv/bin/activate
```

```powershell
# Windows (PowerShell)
python -m venv venv
venv\Scripts\Activate.ps1
```

Instalar dependencias:

```bash
pip install openpyxl pandas requests selenium webdriver_manager
```

Ejecutar funciones:

```bash
cd apps/scripts
python CODESERVICIOSIIFULL.py    # Servicio SII
python RELACIONAR_TARJETAS.py    # Relacionar tarjetas de crédito
```

## DESPLIEGUE - VERCEL

Solo se despliega **`apps/web`**, en Vercel con `DEMO_MODE=true`.

### Ramas

| Rama | Rol | Descripción |
| --- | --- | --- |
| `master` | Producción | Sin versión estable así que no hay despliegue a producción. |
| `release` | Staging permanente | Es la única URL viva. Sale de `develop`. |
| `develop` | Integración | Se trabaja desde aqui. |
| `feat/*` | Trabajo | Salen de `develop`. |

### Modo demo

Como la API no tiene host, `release` va con **`DEMO_MODE=true`**: el login deja de
consultar a `apps/api` y valida contra credenciales mock de `DEMO_USERS`. Toda la lógica está en
[`apps/web/lib/auth/demo.ts`](apps/web/lib/auth/demo.ts); el resto de la
capa de sesión no sabe que existe.

> Los tokens van **firmados** con `DEMO_SECRET`: sin firma, cualquiera se fabrica la cookie de sesión y se salta el login.

Variables (ver [`apps/web/.env.example`](apps/web/.env.example)): `DEMO_MODE`,
`DEMO_SECRET`, `DEMO_USERS`. Se definen **solo en el scope Preview** de Vercel, nunca
en Production. Si `DEMO_MODE=true` y falta alguna, la app no arranca: un demo mal
configurado es un demo abierto.

> **`DEMO_MODE` nunca debe activarse en producción**: dejaría entrar con credenciales
> de pega. Cuando `apps/api` tenga host, se borra `demo.ts`, se quitan las tres guardas
> de `lib/auth/api.ts` y desaparecen estas variables.