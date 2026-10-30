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

## Puesta en marcha

Requisitos: Node.js 20+, pnpm y Docker (para PostgreSQL 16).

```bash
cp .env.example .env
# Completa POSTGRES_PASSWORD, DATABASE_URL, ENCRYPTION_KEY, JWT_SECRET y el par RSA (ver "Protección de datos").
# Opcional: ADMIN_INICIAL_CORREO y ADMIN_INICIAL_CONTRASENA para crear el primer Admin.
pnpm install
pnpm run db:up          # PostgreSQL con el esquema de db/init
pnpm run db:seed        # (solo desarrollo) datos ficticios cifrados y seudonimizados
pnpm run desarrollo     # API + panel en http://localhost:3000
```

Al iniciar, la API aplica el esquema (`db/init/01-monify_schema.sql`) y crea, si
no existe, la base separada de la bóveda de seudónimos (`<base>_vault`). Si la
base fue creada con el diseño anterior (tabla `TipoUsuario`) el arranque se
detiene: recréala con `pnpm run db:reset` y vuelve a cargar la semilla.

### Primer Admin

El autoregistro solo crea titulares (rol Usuario) y las cuentas del personal las
crea un Admin. Para tener el primero, define `ADMIN_INICIAL_CORREO` y
`ADMIN_INICIAL_CONTRASENA` en `.env`: al iniciar, si no existe ningún Admin
activo, se crea con esos datos. Después borra la contraseña del `.env`.

### Datos de desarrollo (`pnpm run db:seed`)

Vacía la base y la bóveda y crea, a través de los servicios de la aplicación,
cuentas del personal y titulares **ficticios** (nombres, RUT y montos
aleatorios): nunca datos reales. Solo se ejecuta con `ENTORNO=desarrollo`. Todas
las cuentas usan la contraseña `Monify2026!` (configurable con `SEED_CONTRASENA`):

| Rol | Correo |
| --- | --- |
| Admin | `admin@monify.dev` |
| Administrador de riesgo | `administrador.riesgo@monify.dev` (contraseña con vigencia de 24 h) |
| Auditor | `auditor@monify.dev` |
| Operador financiero | `operador.financiero@monify.dev` |
| Usuario | se imprimen al terminar la semilla (`…@ejemplo.dev`) |

### Comandos

| Comando | Descripción |
| --- | --- |
| `pnpm run db:up` / `db:down` | Levanta o detiene PostgreSQL (el volumen se conserva). |
| `pnpm run db:reset` | Elimina el volumen y recrea la base desde cero. |
| `pnpm run db:seed` | Compila y carga los datos ficticios de desarrollo. |
| `pnpm run db:psql` / `db:logs` | Consola `psql` y logs del contenedor. |
| `pnpm run desarrollo` | API con recarga automática. |
| `pnpm run prueba:humo` | Prueba de punta a punta contra la API en ejecución (ver abajo). |
| `pnpm run prueba:seguridad` | Pruebas de los controles de la Actividad 4 (accesos no autorizados rechazados). |
| `pnpm run prueba:actividad5` | Pruebas de consentimiento y derechos de la Actividad 5, incluidos intentos directos en la base (lee `PUERTO` y `DATABASE_URL` de `.env`). |

`prueba:humo` necesita la API corriendo y las credenciales de un Admin, por
ejemplo con la semilla cargada:
`BASE_URL=http://localhost:3000 ADMIN_CORREO=admin@monify.dev ADMIN_CONTRASENA=Monify2026! pnpm run prueba:humo`.

### Ambientes

Desarrollo y producción usan bases de datos distintas (`DATABASE_URL` y
`VAULT_DATABASE_URL` propias de cada `.env`). La de desarrollo solo contiene
datos generados por la semilla; las medidas de seguridad (cifrado,
seudonimización, RBAC y auditoría) son las mismas en ambos ambientes.

## Actividad 4: privacidad, RBAC, auditoría y no repudio

### Minimización, seudonimización y anonimización

| Tabla | Campo | Decisión del informe | Implementación |
| --- | --- | --- | --- |
| Usuario | `nombreCompleto`, `rut`, `numeroCelular`, `email` | Seudónimo | Palabras o números aleatorios (`Zorro-Azul-1a2b3c`, `ID-0123456789`, `TEL-…`, `u-…@seudonimo.monify.invalid`). El original, cifrado (AES-256-GCM + RSA-OAEP), vive en la bóveda separada `monify_vault`. |
| Usuario | `fechaNacimiento` | Indicador de mayoría de edad | Se valida al registrar y solo se guarda `esMayorDeEdad`. |
| Usuario | `rentaMensual` | Tramo de renta | `rangoRentaMensual` (tramos T1–T5), cifrado. |
| Usuario / AdministradorRiesgo | `isAccessBlocked` | Conservar | Mismo nombre en ambas tablas desde el diagrama BDD v5. |
| Rol (antes TipoUsuario) | `tipoUsuario` | Seudonimizar | Códigos `Tu`, `Ta`, `Tr`, `Tau`, `To`; el significado solo existe en la aplicación. |
| CredAuthUser | `contraseña` | Solo hash | bcrypt (12 rondas). |
| CredAuthAdministrador | `contraseña` | Plazo de 24 horas | Columna `expiraEn`; el login se rechaza al vencer y un Admin la restablece. |
| ConsultaDeRiesgo | `cantidadDeDeuda` | Eliminar | Columna eliminada. |
| ConsultaDeRiesgo | `tiempoDeMorosidad`, `tiempoEnDeuda` | Tramos | Se reciben días y se guarda el tramo (`0`, `1-30`, `31-90`, `91-180`, `181+`), cifrado. |
| Tarjeta | `CVV`, `fechaVencimiento` | Eliminar | Columnas eliminadas; los valida el procesador de pagos. |
| Tarjeta | `numeroTarjeta`, `saldo` | Conservar con cifrado | AES-256-GCM; en pantalla solo `•••• 1234`. |
| VerificadorDeIdentidad | `hashDeVerificacion` | Solo hash | bcrypt del comprobante del verificador externo. |
| AdministradorRiesgo | `fechaNacimiento` | Eliminar | Columna eliminada. |

**Anonimización.** Al ejecutarse una solicitud de supresión (`/derechos`, ver Actividad 5), el titular
pasa a `estadoCuenta = 'eliminada'`: los seudónimos se reemplazan por valores
`ANON-…`, se borran los vínculos de la bóveda, la credencial, el tramo de renta y
los índices de búsqueda, y se anonimiza el número de tarjeta. Los registros
contables y la bitácora se conservan sin poder identificar a la persona.

**Datos personales fuera de la base.** La bitácora guarda el canal y el
dispositivo declarados (no la IP) y su campo `detalle` va cifrado. Las listas
para el personal muestran solo seudónimos, el JWT no lleva datos personales y la
exportación de datos solo la puede pedir el propio titular.

### Role-Based Access Control

La matriz está en `src/modulos/autorizacion/permisos.ts` y la aplica un guard
global (denegar por defecto: todo endpoint declara `@Publica`, `@SoloAutenticado`
o `@Permiso`). Las reglas posibles son:

- **Solo propio**: el titular sobre sus propios datos.
- **Permitido**: sobre cualquier titular.
- **Según necesidad**: sobre otros titulares solo indicando un motivo (cabecera
  `X-Motivo-Acceso`, campo "Motivo de acceso" en el panel). El acceso y su motivo
  quedan en la bitácora como `acceso.por_necesidad`.
- **Con autorización expresa**: el titular otorga acceso temporal (máximo 72 h)
  a un Auditor u Operador financiero desde "Privacidad y datos". Los logs del
  sistema se abren al Admin solo con una autorización otorgada por un Auditor.
- **Acceso a claves criptográficas**: denegado a todos los roles (no existe
  ningún endpoint que las exponga).

Supuestos tomados donde el informe no es explícito: el Auditor puede revisar los
logs (su función es analizarlos, aunque la tabla marca "Denegada") y para "Ver
deuda" se le aplica el mismo criterio que para el historial (autorización expresa).

### Términos y Condiciones, consentimientos y no repudio

- `GET /terminos` publica el TOS versionado (`src/modulos/terminos/terminos.ts`):
  requisitos, cuenta, transacciones, créditos, protección de datos, auditoría,
  responsabilidad y **cierre de cuenta** (saldo $0, sin deudas, créditos ni
  solicitudes en curso, contraseña y casilla de confirmación).
- El registro exige marcar por separado cada finalidad (ver Actividad 5). Cada
  aceptación queda en `UserConsent` (finalidad, versión, canal y fecha). Si sube
  la versión, el usuario debe aceptarla para seguir operando.
- **No repudio.** Las acciones críticas (aceptar el TOS, transacciones, solicitar
  y resolver créditos, eliminar la cuenta) exigen una casilla
  (`confirmacionNoRepudio: true`). Se guarda en `EvidenciaNoRepudio` el texto
  exacto aceptado, quién, cuándo, canal, dispositivo y una huella HMAC de los
  datos, todo firmado con RSA-SHA256. La tabla es de solo anexado (un trigger
  impide `UPDATE` y `DELETE`).

### Auditoría

`UserLogs` registra cada acción autenticada (y los intentos de login): actor,
acción, resultado (éxito, denegado o fallo), fecha, sistema, **canal**
(`web`, `movil` o `api`, cabecera `X-Canal`) y **dispositivo** (`X-Dispositivo` o
User-Agent). Es de solo anexado y cada registro encadena el hash del anterior:
`GET /auditoria/integridad` recorre la cadena y detecta cualquier alteración o
eliminación. Cada persona ve su propia actividad en `GET /usuarios/me/actividad`.

### Endpoints principales

| Ruta | Acceso |
| --- | --- |
| `POST /usuarios` | Público: autoregistro con aceptación del TOS. |
| `POST /auth/login` | Público. Bloqueo tras 5 intentos fallidos. |
| `GET /terminos` | Público. |
| `GET /usuarios/me` | Perfil propio. La corrección, la copia y la eliminación se piden en `/derechos`. |
| `GET /usuarios/me/actividad` | Bitácora propia. |
| `GET /billeteras`, `POST /tarjetas`, `GET /bancos` | Billetera propia. |
| `GET/POST /transacciones`, `GET/POST /deudas` | Según la matriz RBAC. |
| `GET/POST /creditos`, `GET/POST /solicitudes-credito`, `PATCH /solicitudes-credito/:id/estado` | Según la matriz RBAC. |
| `GET/POST /verificaciones-identidad`, `GET/POST /consultas-riesgo`, `GET /informacion-financiera` | Según la matriz RBAC. |
| `GET /finalidades` | Público: catálogo de finalidades. |
| `GET /consentimientos`, `GET /consentimientos/historial`, `POST /consentimientos/otorgar`, `POST /consentimientos/:finalidad/revocar`, `POST /consentimientos/rechazar` | Titular (disponibles aunque falte un consentimiento). |
| `GET/POST /derechos/solicitudes`, `POST /derechos/solicitudes/:id/verificar`, `POST /derechos/solicitudes/:id/desistir`, `GET /derechos/solicitudes/:id/descarga` | Titular (disponibles aunque falte un consentimiento). |
| `GET /derechos/supervision` | Admin y Auditor: estados y plazos, sin los datos pedidos. |
| `GET/POST /autorizaciones`, `DELETE /autorizaciones/:id` | Titular y Auditor. |
| `GET /usuarios`, `PATCH /usuarios/:id/bloqueo` | Personal (seudónimos) / Admin. |
| `POST /admin/cuentas`, `PATCH /admin/usuarios/:id/rol`, `POST /admin/cuentas/:id/contrasena` | Admin. |
| `GET /rbac/matriz`, `GET /rbac/mis-permisos` | Admin / cualquier sesión. |
| `GET /auditoria/logs`, `GET /auditoria/integridad`, `GET /auditoria/evidencias` | Auditor (Admin con autorización). |

### Panel web

`http://localhost:3000` sirve el panel. Tiene registro con aceptación del TOS y
muestra a cada rol solo las secciones que su matriz permite: billetera y
transacciones con casilla de no repudio, créditos, verificación y riesgo,
privacidad (consentimientos, historial y revocación, autorizaciones), Mis derechos
(solicitudes de acceso, rectificación y supresión), administración (cuentas, roles, bloqueos y matriz RBAC) y auditoría
(bitácora, verificación de integridad y evidencias firmadas).

## Actividad 5: gestión del consentimiento y ejercicio de derechos

### Consentimiento (partes 1 y 5.1)

- **Modelo.** `Finalidad` (catálogo: `terminos_y_condiciones`,
  `tratamiento_datos_personales`, `evaluacion_crediticia`) y `UserConsent`
  (`idFinalidad`, `versionTexto`, `estadoActual`, `otorgado_el`, `revocado_el`).
  Un consentimiento solo pasa de `otorgado` a `revocado` (o `reemplazado` al
  aceptar una versión nueva); un índice único impide dos vigentes de la misma
  finalidad. La base de datos de la Actividad 4 se migra sola al iniciar.
- **Todas obligatorias, una casilla por finalidad.** El registro y
  `POST /consentimientos/otorgar` exigen `aceptaTerminos`,
  `aceptaTratamientoDatos` y `aceptaEvaluacionCrediticia` con valor `true`;
  aceptar una no implica las demás.
- **Sin consentimiento no hay sistema.** El guard global responde
  `403 CONSENTIMIENTO_REQUERIDO` a cualquier endpoint de un titular con una
  finalidad pendiente o revocada, salvo los marcados `@SinConsentimiento()`
  (consentimientos, derechos y `rbac/mis-permisos`). El login devuelve
  `requiereConsentimiento` y el panel muestra una ventana que no se puede cerrar:
  otorgar, ir a Mis derechos o rechazar (queda registrado y se cierra la sesión).
- **Historial y revocación.** `ConsentLogs` (log de consentimiento de la parte 3)
  lo llena un trigger en cada alta o cambio de `UserConsent`, con fecha y hora,
  canal, dispositivo, finalidad, acción y estado anterior/nuevo; también registra
  los cambios hechos directo en la base (canal `bd_directa`). Es de solo anexado.
  La revocación exige la casilla de no repudio y guarda `revocado_el`.

### Ejercicio de derechos (parte 2)

Módulo `src/modulos/derechos`, paralelo al sistema principal y disponible aunque
falte un consentimiento. Cada solicitud sigue
`recibida → verificada → en_evaluacion → ejecutada | rechazada → cerrada`; un
trigger valida las transiciones (no se pueden saltar ni retroceder) y escribe
`HistorialSolicitudDerecho` (solo anexado). Se guardan las fechas de cada etapa y
el plazo de respuesta (30 días corridos). Hay una sola solicitud abierta por tipo.

| Derecho | Verificación de identidad | Evaluación y ejecución |
| --- | --- | --- |
| Acceso y portabilidad | Contraseña + código de un solo uso al correo registrado | Copia JSON `monify.portabilidad/1` con huella SHA-256, sin seudónimos internos, firmas ni datos de terceros. Se genera al descargarla (no se almacena), se entrega una vez y la descarga cierra la solicitud; vence en 24 h. |
| Rectificación | Contraseña (nombre, celular, renta); + código al correo nuevo si cambia el correo | Mismas reglas del registro; el RUT no se rectifica en línea. Se actualiza la bóveda: el seudónimo no cambia, así que los demás módulos, la bitácora y las evidencias siguen apuntando al titular; el login usa el correo nuevo y el riesgo, el tramo nuevo. |
| Supresión | Contraseña + código + casilla de no repudio | Si hay saldo, deudas, créditos o solicitudes en curso se rechaza con respuesta fundamentada (obligación legal / contrato). Si no, se anonimiza la cuenta: se borran la bóveda, la credencial, los cambios pedidos y se revocan consentimientos y autorizaciones; transacciones, créditos, evidencias y bitácora se conservan sin identificar. Los respaldos solo contienen seudónimos y se renuevan en su ciclo de rotación. |

El código de un solo uso dura 10 minutos, se guarda solo como HMAC y admite 5
intentos. **Limitación:** el proyecto no tiene servidor de correo; el envío se
simula en `ServicioNotificaciones` y, en `ENTORNO=desarrollo`, el código vuelve
en la respuesta (`codigoDesarrollo`) para poder probar el flujo. En producción
ahí se conecta el proveedor de correo.

La bitácora (`UserLogs`) registra `derechos.<tipo>.recibida|verificada|ejecutada|rechazada|desistida|descargada`
con identificadores, nunca el código, la contraseña ni los datos pedidos. Admin y
Auditor ven `GET /derechos/supervision` (estados, fechas y plazos).

### Diseño de base de datos BDD v5

El esquema sigue el diagrama BDD v5:

- Todas las tablas del diagrama tienen `isBlocked`, `createdAt` y `updatedAt`. `updatedAt` lo mantiene un trigger (`fn_actualizar_updated_at`). `isBlocked` marca los registros que se conservan por obligación legal tras una supresión (transacciones, tarjetas, billetera, deudas, consultas de riesgo, verificaciones, créditos y consentimientos): dejan de mostrarse y de usarse, pero siguen disponibles para una fiscalización.
- Nombres del diagrama: `Usuario.rangoRentaMensual`, `Usuario.esMayorDeEdad`, `AdministradorRiesgo.isAccessBlocked`, `ConsultaDeRiesgo.scoreDeRiesgo` y `createdAt` en lugar de `creadoEn`.
- `Transaccion` tiene clave primaria (`idTransaccion`, `idTarjeta`) y ya no guarda `idUsuario`: el titular se obtiene a través de `Billetera`.
- Las tablas que el diagrama no dibuja (`Rol`, `UserLogs`, `EvidenciaNoRepudio`, `AutorizacionAcceso`, `ConsentLogs`, `SolicitudDerecho`, `HistorialSolicitudDerecho`) se mantienen porque sostienen el RBAC, la auditoría, el no repudio y el ejercicio de derechos.
- Una base creada con la versión anterior se migra sola al arrancar (renombra columnas, cambia la clave de `Transaccion` y agrega las columnas nuevas), sin perder datos.

## Protección de datos

El módulo global `src/seguridad` contiene `ServicioCifrado` (AES-256-GCM con
`ENCRYPTION_KEY`, RSA-OAEP con `RSA_PUBLIC_KEY`/`RSA_PRIVATE_KEY`, HMAC para
índices y firmas RSA-SHA256), `ServicioHash` (bcrypt, 12 rondas) y
`ServicioSeudonimos` (bóveda de seudónimos).

| Campo | Técnica | Algoritmo |
| --- | --- | --- |
| Nombre, RUT, celular y correo | Seudónimo + original cifrado en la bóveda | AES-256-GCM + RSA-OAEP (híbrido) |
| Tramo de renta, número de tarjeta, saldos y montos de transacciones | Cifrado simétrico | AES-256-GCM |
| Montos de deudas, créditos y solicitudes; score, morosidad y tramos de riesgo | Cifrado asimétrico | RSA-OAEP |
| Detalle de la bitácora | Cifrado simétrico | AES-256-GCM |
| Contraseñas y comprobantes KYC | Hash | bcrypt, 12 rondas |
| Búsqueda por RUT y correo | Índice determinista | HMAC-SHA256 |
| Bitácora y evidencias | Integridad | Cadena de HMAC y firma RSA-SHA256 |

### Cómo se cifra y descifra cada dato

El flujo es el mismo para cualquier endpoint que escriba o lea un campo
sensible, y siempre pasa por `ServicioCifrado`, nunca por el controller:

1. La API recibe el dato en texto plano a través de HTTPS (ver sección de
   cifrado en tránsito).
2. El service correspondiente (`ServicioUsuarios`, `ServicioFinanciero`, etc.)
   recibe el payload y lo cifra usando AES - 256, generando el Ciphertext, IV y el AuthTag.
3. Las 3 claves se concatenan y se guardan en la columna correspondiente (si se cifro un nombre se guarda en la columna nombre)
4. De esta forma la clave no queda en texto plano a menos que se aplique la clave de descifrado.

**Cifrado simétrico (AES-256-GCM)** — para nombre, fecha de nacimiento, saldo,
renta, celular y montos de transacciones. Cada vez que se cifra un valor se
genera un IV aleatorio nuevo (nunca se reutiliza con la misma clave), y GCM
produce además un `authTag`. Al descifrar, recalcula el tag
y lo compara con el guardado: si no coinciden —porque alguien modificó el
valor cifrado directamente en la base, por ejemplo— el descifrado falla en
vez de devolver un dato corrupto sin avisar.

```json
{
  "ciphertext": "xS0+nGeT9Ns=",
  "iv": "vVxihPtjklFlr9Cc",
  "authTag": "S5xfVkstZqljq6pYNqMcSg=="
}
```

**Cifrado asimétrico (RSA-OAEP)** — para montos de deudas, créditos,
solicitudes, score, morosidad y datos de riesgo. El cifrado se hace con
`RSA_PUBLIC_KEY`, así que cualquier parte del sistema que necesite *escribir*
estos campos puede hacerlo sin tener acceso a la clave privada. Solo
`RSA_PRIVATE_KEY` —guardada aparte, nunca en el mismo lugar que la pública en
un despliegue real— puede descifrarlos. Esto da una capa extra de defensa: un
atacante que solo comprometa el proceso que escribe datos no puede leer los
que ya están cifrados.

```json
{
  "ciphertext": "Qm1z9FhC2...=="
}
```

**Cifrado híbrido (envelope encryption)** — exclusivo para el RUT. RSA no se
usa para cifrar el valor directamente; en vez de eso:
1. Se genera una clave AES de un solo uso (clave de datos) para ese registro.
2. El RUT se cifra con esa clave usando AES-256-GCM (igual que en el caso
   simétrico: ciphertext + iv + authTag).
3. La clave de datos se cifra con `RSA_PUBLIC_KEY` (RSA-OAEP) y se guarda junto
   al resto.

```json
{
  "ciphertext": "ZP4p1TqV+LQwMSYs",
  "iv": "h1oESW1QOQSMbINu",
  "authTag": "96kH/KytKpADtD29X2eR1w==",
  "claveEnvuelta": "Qm1z9FhC2...=="
}
```

Esto evita el límite de tamaño de RSA (no se puede cifrar directamente texto
largo con RSA-OAEP) y es la razón por la que el RUT ya no admite búsqueda por
igualdad en SQL sobre el valor cifrado. Para detectar duplicados y para el login
se guarda además un índice determinista (`rutHash`, `emailHash`): un HMAC-SHA256
con `ENCRYPTION_KEY`, que permite comparar por igualdad sin poder revertirse.

> Desde la Actividad 4 el RUT, el nombre, el celular y el correo ya no se guardan
> en la base principal: allí solo hay seudónimos y el valor original cifrado con
> este esquema híbrido vive en la bóveda (`BovedaSeudonimos`, base `monify_vault`).

Genera una clave para desarrollo con:

```bash
openssl rand -base64 32
```

Guárdala únicamente en `.env` como `ENCRYPTION_KEY`; no la versiones ni la
imprimas en logs. Genera también el par RSA para los campos de cifrado
asimétrico con:

```bash
openssl genrsa -out rsa_private.pem 2048
openssl rsa -in rsa_private.pem -pubout -out rsa_public.pem
```

Guarda su contenido PEM en `.env` como `RSA_PRIVATE_KEY` y `RSA_PUBLIC_KEY`
(con los saltos de línea escapados como `\n`); tampoco los versiones ni los
imprimas en logs. Los datos de desarrollo se generan con `pnpm run db:seed`,
que usa los mismos servicios de la aplicación, así que también quedan
seudonimizados y cifrados (no existe un seed SQL directo).

### Autenticación con JWT

`POST /auth/login` busca la cuenta por el HMAC del correo, compara la contraseña
con bcrypt y firma un JWT (HS256, 1 hora) con `JWT_SECRET`. El token solo lleva
el id, el tipo de cuenta y el rol, sin datos personales. En cada petición el
guard global vuelve a leer la cuenta, así que un bloqueo, un cambio de rol o una
eliminación aplican de inmediato. Tras 5 intentos fallidos la cuenta se bloquea
y solo un Admin puede habilitarla.

Genera la clave de firma para desarrollo con `openssl rand -hex 32` y guárdala
únicamente en `.env`.
