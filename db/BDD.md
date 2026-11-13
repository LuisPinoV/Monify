# `db/` — schema y datos de la base de datos

La base de datos usa PostgreSQL 16 y puede levantarse con Docker Compose desde la
raíz del proyecto. El esquema se encuentra en `db/init/`.

## Qué va en cada carpeta

| Carpeta | Contenido | Se monta en |
| --- | --- | --- |
| `init/` | Schema (tablas, constraints y catálogos). | `/docker-entrypoint-initdb.d` |

## Convención de nombres

El orden de ejecución es **alfabético**, así que el prefijo numérico manda:

```text
db/init/01-monify_schema.sql  # schema
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

El comando anterior elimina `monify-pgdata` y vuelve a ejecutar el schema.
Para conservar los datos, usa `docker compose down` sin `-v`.

## Tablas de la Actividad 5

| Tabla | Para qué | Protección en la base |
| --- | --- | --- |
| `Finalidad` | Catálogo de finalidades del consentimiento. | — |
| `UserConsent` | Un registro por otorgamiento (`estadoActual`, `otorgado_el`, `revocado_el`). | Trigger: no se borra y solo pasa de `otorgado` a `revocado`/`reemplazado`; CHECK de coherencia estado/fecha; índice único de vigentes. |
| `ConsentLogs` | Log de cada acción sobre un consentimiento (lo escribe un trigger). | Solo anexado. Canal `bd_directa` si el cambio no vino de la API. |
| `SolicitudDerecho` | Solicitudes de acceso, rectificación y supresión con sus fechas y plazo. | Trigger: no se borra y solo admite las transiciones del flujo. |
| `HistorialSolicitudDerecho` | Cada cambio de estado de una solicitud (trigger). | Solo anexado. |

## Tablas de la Actividad 6

| Tabla | Contenido | Protección |
| --- | --- | --- |
| `OposicionTratamiento` | Oposición del titular a un tratamiento (`score_comportamiento`), la solicitud que la originó y su levantamiento. | Índice único de oposición vigente; trigger: no se borra ni se reactiva. |
| `RegistroRectificacion` | Cada campo rectificado, con la solicitud, la fecha y huellas HMAC del valor anterior y del nuevo. | Solo anexado; la supresión solo puede borrar las huellas. |

`SolicitudDerecho.tipoDerecho` admite además `oposicion` (la migración reemplaza el CHECK si hace falta).

## Tablas de la Actividad 7

| Tabla | Contenido | Protección |
| --- | --- | --- |
| `AlertaSeguridad` | Alertas A1–A4: regla, severidad, actor, canal, dispositivo, descripción, acción tomada, evidencia cifrada y revisión. | Trigger: no se borra (salvo por plazo vencido) y solo admite registrar la revisión. |
| `SesionRevocada` | Revocaciones de sesión de una contención: cuenta, fecha, motivo y alerta. | Solo anexado. |
| `DepuracionRegistros` | Constancia de cada depuración por plazo vencido (tabla, cantidad, fecha de corte y último hash de la bitácora). | Solo anexado. |

Plazo de conservación: 5 años (`fn_plazo_conservacion()`, Ley 19.913 art. 5). `fn_depurar_registros_vencidos()` borra lo vencido en
`UserLogs`, `ConsentLogs`, `HistorialSolicitudDerecho` y `AlertaSeguridad`; `fn_registro_inmutable` recibe la columna
de fecha de cada tabla y rechaza cualquier otro UPDATE o DELETE.

## Cambios del diagrama BDD v5

| Cambio | Detalle |
| --- | --- |
| Columnas comunes | `isBlocked`, `createdAt`, `updatedAt` en las 17 tablas del diagrama; `updatedAt` por trigger. |
| Renombres | `tramoRenta` → `rangoRentaMensual`, `esMayorEdad` → `esMayorDeEdad`, `flagAcc` → `isAccessBlocked`, `ScoreDeRiesgo` → `scoreDeRiesgo`, `creadoEn` → `createdAt`. |
| `Transaccion` | PK (`idTransaccion`, `idTarjeta`); sin `idUsuario` (el titular sale de `Billetera`). |
| Supresión | Los registros conservados por obligación legal quedan con `isBlocked = TRUE`. Bloquear un consentimiento no cambia su estado ni agrega eventos a `ConsentLogs`. |

La migración desde la versión anterior está en el mismo `01-monify_schema.sql` y es idempotente.

## Datos de desarrollo

Desde la Actividad 4 no hay seed SQL: los nombres, RUT, celulares y correos se
guardan como seudónimos (con el original cifrado en la bóveda `monify_vault`) y
los montos van cifrados, algo que un `INSERT` directo no puede hacer. Los datos
ficticios de desarrollo se generan con:

```bash
pnpm run db:seed
```

La cantidad de titulares se ajusta con `SEED_TITULARES` en `.env`.

Para consultar las tablas cargadas:

```bash
docker compose exec db psql -c \
	'SELECT schemaname, tablename FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY tablename;'
```

> `pnpm run db:seed` vacía la base y la bóveda antes de cargar: úsalo solo en desarrollo.