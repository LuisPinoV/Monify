# Resultados de ejecucion: Actividad 7

Fecha de ejecucion: 13 de noviembre de 2026.
Entorno: desarrollo local, PostgreSQL 16 en Docker, API NestJS en `http://localhost:3000`.
Datos: cuentas, titulares, RUT, correos, telefonos y tarjetas ficticios.

## Preparacion

| Paso | Resultado |
|---|---|
| `pnpm install` | Correcto |
| `pnpm run db:up` | Correcto |
| `docker compose ps` | PostgreSQL saludable en `localhost:5433` |
| `pnpm run db:reset` | Correcto; se elimino el volumen de desarrollo anterior |
| `pnpm run db:seed` | Correcto; 4 cuentas de personal y 12 titulares ficticios |
| `GET /salud` | `200`; PostgreSQL y JWT + RBAC activos |

## Escenarios E1-E10

| Evidencia | Resultado observado |
|---|---|
| E1 Login | 1 login exitoso, 3 fallidos y bloqueo registrado; HTTP `200`, `401`, `401`, `401` |
| E2 Lecturas del titular | Perfil e historial registrados; ambos HTTP `200` |
| E3 Accesos del personal | KYC y consulta de riesgo registrados con actor y titular interno; ambos HTTP `200` |
| E4 Derechos | Solicitudes de acceso y rectificacion creadas; ambos HTTP `201` |
| E5 Consentimientos | Revocacion, otorgamiento, revocacion y otorgamiento; HTTP `200`, `201`, `200`, `201` |
| E6 Transaccion | Tarjeta ficticia propia y transaccion registrada; HTTP `201` |
| E7 Acceso a logs | Titular `403`, Admin sin autorizacion `403`, Auditor `200` |
| E8 Sin datos personales | La consulta de patrones sobre `UserLogs` devolvio `0`; `detalle` aparece cifrado como `v1...` |
| E9 Integridad | `/auditoria/integridad` devolvio `valida: true` con 44 registros verificados; UPDATE y DELETE fueron rechazados por el trigger |
| E10 Cobertura | 21 combinaciones de accion/resultado en la corrida, incluyendo `perfil.ver`, `historial.ver`, `kyc.ver`, `info_financiera.ver`, `transaccion.crear`, `acceso_denegado` y `logs.revisar` |

## Pruebas automatizadas

- `pnpm run prueba:sanitizador-auditoria`: 4 aprobadas, 0 fallidas.
- `pnpm run compilar`: correcto.
- `pnpm run prueba:e2e-auditoria`: 1 aprobada, 0 fallidas, 0 omitidas.
- `bash -n scripts/evidencia-auditoria.sh`: correcto.
- No se encontraron tokens JWT en los archivos E1-E10.

## Archivos generados

- `E1-login.txt`
- `E2-lecturas-titular.txt`
- `E3-accesos-personal.txt`
- `E4-derechos.txt`
- `E5-consentimientos.txt`
- `E6-transaccion.txt`
- `E7-control-acceso-logs.txt`
- `E8-sin-datos-personales.txt`
- `E9-integridad.txt`
- `E10-cobertura.txt`

## Comandos reproducibles

```bash
pnpm install
pnpm run db:up
pnpm run db:reset
pnpm run db:seed
pnpm run desarrollo
```

En otra terminal, con las variables de sesion ficticias exportadas:

```bash
pnpm run evidencia:auditoria
pnpm run prueba:sanitizador-auditoria
pnpm run compilar
pnpm run prueba:e2e-auditoria
```

La evidencia completa esta en los archivos `E1` a `E10` de esta carpeta.
