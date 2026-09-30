# `db/` — schema y datos de la base de datos

La base de datos usa PostgreSQL 16 y puede levantarse con Docker Compose desde la
raíz del proyecto. Los scripts SQL se encuentran en `db/init/` y `db/seed/`.

## Qué va en cada carpeta

| Carpeta | Contenido | Se monta en |
| --- | --- | --- |
| `init/` | Schema (tablas, constraints y catálogos). | `/docker-entrypoint-initdb.d` |
| `seed/` | Datos de simulación para las entidades principales. | `/docker-entrypoint-initdb.d` |

## Convención de nombres

El orden de ejecución es **alfabético**, así que el prefijo numérico manda:

```text
db/init/01-monify_schema.sql  # schema
db/seed/10-seed.sql           # datos de prueba
```

Renombrar un archivo respetando su prefijo es suficiente para reemplazarlo.

## Cómo se cargan

## Docker y PostgreSQL

Desde la raíz del proyecto:

```bash
# Primera carga o arranque de una base ya existente.
docker compose up -d

# Revisar el estado del contenedor y sus logs.
docker compose ps
docker compose logs db

# Abrir psql dentro del contenedor.
docker compose exec db psql
```

El servicio publica PostgreSQL en `localhost:5432` por defecto. Puedes cambiar
el puerto publicado y las credenciales mediante variables de entorno:

```bash
DB_PORT=5433 POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
POSTGRES_DB=monify docker compose up -d
```

La aplicación puede conectarse con:

```text
postgresql://postgres:postgres@localhost:5432/monify
```

También puedes definir `DATABASE_URL` en el entorno de la aplicación. El valor
por defecto usado por el backend es el mismo de arriba.

PostgreSQL solo ejecuta los archivos de `/docker-entrypoint-initdb.d` cuando el
volumen está vacío. Si modificas el schema o el seed, recrea la base completa:

```bash
docker compose down -v
docker compose up -d
```

El comando anterior elimina `monify-pgdata` y vuelve a ejecutar el schema y el
seed en orden. Para conservar los datos, usa `docker compose down` sin `-v`.

## Seed configurable

Las cantidades del seed se cambian al inicio de `db/seed/10-seed.sql`, en la
instrucción `INSERT INTO seed_config`. Allí puedes ajustar usuarios,
transacciones, deudas, verificaciones, consultas de riesgo, créditos y
solicitudes de crédito antes de recrear el volumen.

Para consultar las tablas cargadas:

```bash
docker compose exec db psql -c \
	'SELECT schemaname, tablename FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY tablename;'
```

> No ejecutes el seed manualmente sobre una base ya poblada sin revisar sus
> restricciones. Para una carga limpia usa `docker compose down -v` y vuelve a
> levantar el servicio.