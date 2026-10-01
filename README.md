# Monify

Desarrolladores:
- Susie Gaster
- Kris Dreemurr
- Ralsei Deltarune

## Contexto: 
Monify es una billetera digital chilena que permite a sus usuarios recibir, enviar y guardar dinero, además de solicitar líneas de crédito de consumo. Para operar, exige verificar la identidad de cada usuario (KYC, por sus siglas en inglés) y evalúa su riesgo de crédito antes de aprobar cualquier línea.
## Descripción del sistema: 
El grupo debe diseñar la plataforma que gestiona: cuentas de usuario, transferencias, historial de transacciones, verificación de identidad, solicitud y evaluación de créditos, y el cálculo de un puntaje (score) de comportamiento financiero.

## Actores del sistema
- Usuario, titular de la cuenta y de la billetera digital.
- Administrador de riesgo, que evalúa las solicitudes de crédito.
- Entidad verificadora de identidad, como tercero que valida el KYC.
- Central de riesgo o buró de crédito, como tercero que informa el historial financiero.

## Versiones

### Entorno

- Ubuntu 24.04
- Node.js 20.20.2
- pnpm 10.8.2
- PostgreSQL 16.15

### Tecnologías y dependencias

- NestJS 11.2.6
- TypeScript 5.9.3
- `pg` 8.23.0
- Express 5.2.1, incluido por `@nestjs/platform-express`
- RxJS 7.8.2
- `reflect-metadata` 0.2.2

## Base de datos

Monify utiliza PostgreSQL 16 y Docker Compose para ejecutar la base de datos
localmente. Instala las dependencias desde la raíz del proyecto y luego usa los
atajos definidos en `package.json`:

```bash
cp .env.example .env
# Edita .env y reemplaza change-me por una contraseña local.
pnpm install
pnpm run db:up
DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" pnpm run desarrollo
```

### Comandos disponibles

| Comando | Descripción |
| --- | --- |
| `pnpm run db:up` | Levanta PostgreSQL en segundo plano. En un volumen nuevo carga el schema y los datos iniciales. |
| `pnpm run db:down` | Detiene el contenedor y conserva el volumen de datos. |
| `pnpm run db:reset` | Elimina el volumen y recrea la base desde cero. |
| `pnpm run db:seed` | Ejecuta el cargador de datos iniciales dentro del contenedor. |
| `pnpm run db:recrear-cifrados` | Borra todos los registros y los recrea usando la `ENCRYPTION_KEY` actual. |
| `pnpm run db:psql` | Abre una consola `psql` dentro del contenedor. |
| `pnpm run db:logs` | Muestra los logs de PostgreSQL en tiempo real. |

Para comprobar que el contenedor está funcionando:

```bash
docker compose ps
pnpm run db:logs
```

PostgreSQL solo ejecuta automáticamente los archivos de inicialización cuando
el volumen está vacío. Si modificas el schema o necesitas una carga limpia,
usa:

```bash
pnpm run db:reset
```

El servicio publica PostgreSQL en `localhost:5433` por defecto para no interferir
con una instalación local en `localhost:5432`. La aplicación se conecta usando
`DATABASE_URL`:

```text
postgresql://postgres:tu_clave@localhost:5433/monify
```

Puedes cambiar el puerto y las credenciales mediante variables de entorno al
levantar Compose, por ejemplo:

```bash
DB_PORT=5433 POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
POSTGRES_DB=monify pnpm run db:up
```

El archivo `db/seed/10-seed.sql` queda disponible para datos iniciales adicionales.
Para datos de desarrollo protegidos con AES-256-GCM usa `pnpm run db:recrear-cifrados`;
no uses `db:seed` para este propósito, porque los inserts SQL directos no pasan por
el servicio de cifrado de NestJS.

### Usuarios y billeteras

- `GET /usuarios`: lista usuarios.
- `POST /usuarios`: crea un usuario con `tipoUsuario`, `nombre`, `rut`, `fechaNacimiento`, `correo` y opcionalmente `rentaMensual` y `numeroCelular`.
- `GET /billeteras`: muestra el saldo de cada usuario desde `Usuario.Saldo`.
- `POST /billeteras`: consulta el saldo del usuario indicado; no crea una tabla ni un registro adicional. La moneda es siempre CLP.

### Operaciones financieras

- `GET|POST /transacciones`: historial y registro de transacciones.
- `GET|POST /deudas`: historial y registro de deudas.
- `GET|POST /verificaciones-identidad`: casos de verificación de identidad.
- `GET|POST /consultas-riesgo`: consultas y resultados de riesgo.
- `GET|POST /creditos`: catálogo de créditos.
- `GET|POST /solicitudes-credito`: solicitudes de crédito asociadas a un crédito.
- `PATCH /solicitudes-credito/:id/estado`: cambia el estado de una solicitud.

Los estados admitidos para solicitudes son `recibida`, `evaluacion`, `aprobada`
y `rechazada`.

## Protección de datos

El módulo global `src/seguridad` contiene `ServicioCifrado`, que usa
AES-256-GCM con una clave base64 de 32 bytes tomada de `ENCRYPTION_KEY`, y
`ServicioHash`, que usa bcrypt con 12 rondas. Los datos personales y financieros
se protegen en la capa de persistencia campo por campo mediante `camposCifrados`
(cada propiedad contiene su propio `ciphertext`, `iv` y `authTag`); los
controladores no realizan cifrado directamente. Las columnas
`datosCifrados`, `datosCifradosIv` y `datosCifradosAuthTag` se conservan solo
para leer registros antiguos.

| Campo | Técnica | Justificación | Algoritmo | Dónde se protege |
| --- | --- | --- | --- | --- |
| Nombre, fecha de nacimiento, saldo, renta y celular | Cifrado | Se necesitan recuperar para mostrar o calcular | AES-256-GCM | Servicio de usuarios |
| Montos de transacciones, deudas, créditos y solicitudes | Cifrado | Se necesitan recuperar para mostrar y operar | AES-256-GCM | Servicio financiero |
| Score, morosidad y datos de riesgo | Cifrado | Se usan en consultas y evaluación | AES-256-GCM | Servicio financiero |
| RUT y correo | Sin cifrado reversible | Tienen `UNIQUE` y se usan para identificación/búsqueda; AES-GCM estándar no permite esas operaciones | N/A | Columnas indexadas de PostgreSQL |
| Contraseñas | Hash | Nunca deben recuperarse | bcrypt, 12 rounds | `ServicioHash`; autenticación pendiente |
| IDs, estados y fechas de sistema | Sin cifrado | Son referencias, filtros o metadatos operativos | N/A | Columnas normales |

No se implementó JWT porque todavía no existe autenticación ni un flujo de
tokens en este proyecto. Cuando se agregue, debe usar `@nestjs/jwt` y no incluir
datos sensibles directamente en el payload.

Genera una clave para desarrollo con:

```bash
openssl rand -base64 32
```

Guárdala únicamente en `.env` como `ENCRYPTION_KEY`; no la versiones ni la
imprimas en logs. El seed SQL conserva su función de simulación, pero los
registros creados directamente por SQL no pasan por `ServicioCifrado`; para
datos simulados protegidos, créalos mediante los endpoints de la API o ejecuta
un proceso de migración que cifre los registros existentes antes de usarlos.

-----

### Panel web

El panel de resumen está disponible en la ruta raíz del servidor. Inicia la API
con `pnpm run desarrollo` y abre `http://localhost:3000`. El panel consulta los
usuarios, billeteras, transacciones y deudas existentes; Bootstrap y las fuentes
se cargan desde CDN.
