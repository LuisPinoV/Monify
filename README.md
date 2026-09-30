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
- npm 10.8.2
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
npm install
npm run db:up
```

### Comandos disponibles

| Comando | Descripción |
| --- | --- |
| `npm run db:up` | Levanta PostgreSQL en segundo plano. En un volumen nuevo carga el schema y los datos iniciales. |
| `npm run db:down` | Detiene el contenedor y conserva el volumen de datos. |
| `npm run db:reset` | Elimina el volumen y recrea la base desde cero. |
| `npm run db:seed` | Ejecuta el cargador de datos iniciales dentro del contenedor. |
| `npm run db:psql` | Abre una consola `psql` dentro del contenedor. |
| `npm run db:logs` | Muestra los logs de PostgreSQL en tiempo real. |

Para comprobar que el contenedor está funcionando:

```bash
docker compose ps
npm run db:logs
```

PostgreSQL solo ejecuta automáticamente los archivos de inicialización cuando
el volumen está vacío. Si modificas el schema o necesitas una carga limpia,
usa:

```bash
npm run db:reset
```

El servicio publica PostgreSQL en `localhost:5432` por defecto. La aplicación
puede conectarse con:

```text
postgresql://postgres:postgres@localhost:5432/monify
```

Puedes cambiar el puerto y las credenciales mediante variables de entorno al
levantar Compose, por ejemplo:

```bash
DB_PORT=5433 POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
POSTGRES_DB=monify npm run db:up
```

Las cantidades de datos de prueba se configuran en la instrucción
`INSERT INTO seed_config` del archivo `db/seed/10-seed.sql`.

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

-----

