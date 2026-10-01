
BEGIN;

CREATE TEMP TABLE seed_config (
    "usuarios" INTEGER NOT NULL CHECK ("usuarios" >= 0),
    "verificacionesPorUsuario" INTEGER NOT NULL CHECK ("verificacionesPorUsuario" >= 0),
    "consultasRiesgoPorUsuario" INTEGER NOT NULL CHECK ("consultasRiesgoPorUsuario" >= 0),
    "transaccionesPorUsuario" INTEGER NOT NULL CHECK ("transaccionesPorUsuario" >= 0),
    "deudasPorUsuario" INTEGER NOT NULL CHECK ("deudasPorUsuario" >= 0),
    "creditos" INTEGER NOT NULL CHECK ("creditos" >= 0),
    "solicitudesCredito" INTEGER NOT NULL CHECK ("solicitudesCredito" >= 0)
);

INSERT INTO seed_config VALUES (20, 1, 1, 3, 1, 10, 15);

INSERT INTO "TipoUsuario" ("tipoUsuario")
SELECT tipo
FROM unnest(ARRAY['usuario', 'administrador_riesgo']) AS tipo
WHERE NOT EXISTS (
    SELECT 1
    FROM "TipoUsuario" AS existente
    WHERE existente."tipoUsuario" = tipo
);

INSERT INTO "EstadoSolicitud" ("estadoSolicitud")
SELECT estado
FROM unnest(ARRAY['recibida', 'en_evaluacion', 'aprobada', 'rechazada']) AS estado
WHERE NOT EXISTS (
    SELECT 1
    FROM "EstadoSolicitud" AS existente
    WHERE existente."estadoSolicitud" = estado
);

-- Los correos y RUT tienen un prefijo propio para distinguir estos datos de los reales.
INSERT INTO "Usuario" (
    "idTipoUsuario", "nombreCompleto", "rut", "fechaNacimiento", "Saldo",
    "rentaMensual", "numeroCelular", "EMAIL"
)
SELECT
    (SELECT "idTipoUsuario" FROM "TipoUsuario" WHERE "tipoUsuario" = 'usuario' LIMIT 1),
    format('Usuario de prueba %s', serie),
    format('SEED-%s', lpad(serie::TEXT, 6, '0')),
    DATE '1975-01-01' + ((serie * 173) % 12000),
    (serie * 12500.00)::NUMERIC(14, 2),
    (500000 + serie * 25000.00)::NUMERIC(14, 2),
    format('+569%s', lpad(serie::TEXT, 8, '0')),
    format('seed.usuario.%s@monify.test', serie)
FROM generate_series(1, (SELECT "usuarios" FROM seed_config)) AS serie
ON CONFLICT DO NOTHING;

INSERT INTO "VerificadorDeIdentidad" (
    "idUsuario", "estadoVerificacion", "fechaVerificacion",
    "fechaExpiracion", "metodoDeVerificacion", "hashDeVerificacion"
)
SELECT
    usuario."idUsuario",
    CASE WHEN serie % 4 = 0 THEN 'pendiente' ELSE 'aprobada' END,
    now() - make_interval(days => serie),
    now() + make_interval(days => 365),
    CASE WHEN serie % 2 = 0 THEN 'documento_nacional' ELSE 'biometria' END,
    md5(format('seed-verificacion-%s-%s', usuario."idUsuario", serie))
FROM "Usuario" AS usuario
CROSS JOIN LATERAL generate_series(
    1, (SELECT "verificacionesPorUsuario" FROM seed_config)
) AS serie
WHERE usuario."EMAIL" LIKE 'seed.usuario.%@monify.test'
  AND NOT EXISTS (
      SELECT 1
      FROM "VerificadorDeIdentidad" AS existente
      WHERE existente."idUsuario" = usuario."idUsuario"
        AND existente."hashDeVerificacion" = md5(format('seed-verificacion-%s-%s', usuario."idUsuario", serie))
  );

INSERT INTO "ConsultaDeRiesgo" (
    "idUsuario", "ScoreDeRiesgo", "morosidad", "tiempoDeMorosidad",
    "cantidadDeuda", "tiempoEnDeuda", "fechaConsulta"
)
SELECT
    usuario."idUsuario",
    (450 + ((usuario."idUsuario" + serie) * 37) % 501)::NUMERIC(6, 2),
    (serie % 4 = 0)::TEXT,
    CASE WHEN serie % 4 = 0 THEN CURRENT_DATE - (serie * 30) ELSE NULL END,
    CASE WHEN serie % 4 = 0 THEN (serie * 85000.00)::NUMERIC(14, 2) ELSE 0 END,
    CASE WHEN serie % 4 = 0 THEN CURRENT_DATE - (serie * 45) ELSE NULL END,
    now() - make_interval(days => serie)
FROM "Usuario" AS usuario
CROSS JOIN LATERAL generate_series(
    1, (SELECT "consultasRiesgoPorUsuario" FROM seed_config)
) AS serie
WHERE usuario."EMAIL" LIKE 'seed.usuario.%@monify.test'
  AND NOT EXISTS (
      SELECT 1
      FROM "ConsultaDeRiesgo" AS existente
      WHERE existente."idUsuario" = usuario."idUsuario"
        AND existente."fechaConsulta" = now() - make_interval(days => serie)
  );

-- No se generan contraseñas desde SQL. Los secretos se deben crear mediante
-- ServicioHash (bcrypt, 12 rounds) cuando exista el flujo de autenticación.

INSERT INTO "Transaccion" (
    "idUsuario", "fechaTransaccion", "montoTransaccion"
)
SELECT
    usuario."idUsuario",
    now() - make_interval(days => serie),
    CASE WHEN serie % 2 = 0 THEN serie * 15000.00 ELSE serie * -5000.00 END
FROM "Usuario" AS usuario
CROSS JOIN LATERAL generate_series(
    1, (SELECT "transaccionesPorUsuario" FROM seed_config)
) AS serie
WHERE usuario."EMAIL" LIKE 'seed.usuario.%@monify.test'
  AND NOT EXISTS (
      SELECT 1
      FROM "Transaccion" AS existente
      WHERE existente."idUsuario" = usuario."idUsuario"
        AND existente."fechaTransaccion" = now() - make_interval(days => serie)
  );

INSERT INTO "Deuda" ("idUsuario", "fechaDeuda", "montoDeuda")
SELECT
    usuario."idUsuario",
    now() - make_interval(days => serie * 10),
    (serie * 40000.00)::NUMERIC(14, 2)
FROM "Usuario" AS usuario
CROSS JOIN LATERAL generate_series(
    1, (SELECT "deudasPorUsuario" FROM seed_config)
) AS serie
WHERE usuario."EMAIL" LIKE 'seed.usuario.%@monify.test'
  AND NOT EXISTS (
      SELECT 1
      FROM "Deuda" AS existente
      WHERE existente."idUsuario" = usuario."idUsuario"
        AND existente."fechaDeuda" = now() - make_interval(days => serie * 10)
  );

INSERT INTO "Credito" ("montoCredito", "tasaInteres")
SELECT
    (100000 + serie * 25000.00)::NUMERIC(14, 2),
    (1.50 + (serie % 8) * 0.25)::NUMERIC(6, 2)
FROM generate_series(1, (SELECT "creditos" FROM seed_config)) AS serie
WHERE NOT EXISTS (
    SELECT 1
    FROM "Credito" AS existente
    WHERE existente."montoCredito"::NUMERIC = (100000 + serie * 25000.00)::NUMERIC(14, 2)
    AND existente."tasaInteres"::NUMERIC = (1.50 + (serie % 8) * 0.25)::NUMERIC(6, 2)
);

INSERT INTO "SolicitudCredito" ("idCredito", "fechaSolicitud", "idEstadoSolicitud")
SELECT
    credito."idCredito",
    now() - make_interval(days => serie),
    (
        SELECT "idEstadoSolicitud"
        FROM "EstadoSolicitud"
        WHERE "estadoSolicitud" = (ARRAY['recibida', 'en_evaluacion', 'aprobada', 'rechazada'])[((serie - 1) % 4) + 1]
        LIMIT 1
    )
FROM generate_series(1, (SELECT "solicitudesCredito" FROM seed_config)) AS serie
JOIN "Credito" AS credito
    ON credito."montoCredito"::NUMERIC = (100000 + (((serie - 1) % GREATEST((SELECT "creditos" FROM seed_config), 1)) + 1) * 25000.00)::NUMERIC(14, 2)
WHERE (SELECT "creditos" FROM seed_config) > 0
  AND NOT EXISTS (
      SELECT 1
      FROM "SolicitudCredito" AS existente
      WHERE existente."idCredito" = credito."idCredito"
        AND existente."fechaSolicitud" = now() - make_interval(days => serie)
  );

INSERT INTO "UsuarioCredito" (
    "idSolicitudCredito", "idUsuario", "cuota", "montoAcumulado", "montoFinal"
)
SELECT
    solicitud."idSolicitudCredito",
    usuario."idUsuario",
    (credito."montoCredito"::NUMERIC * 0.10)::TEXT,
    0,
    (credito."montoCredito"::NUMERIC * 1.10)::TEXT
FROM "SolicitudCredito" AS solicitud
JOIN "Credito" AS credito ON credito."idCredito" = solicitud."idCredito"
JOIN "Usuario" AS usuario
  ON usuario."EMAIL" = format(
      'seed.usuario.%s@monify.test',
      ((solicitud."idSolicitudCredito" - 1) % GREATEST((SELECT "usuarios" FROM seed_config), 1)) + 1
  )
WHERE usuario."EMAIL" LIKE 'seed.usuario.%@monify.test'
  AND NOT EXISTS (
      SELECT 1
      FROM "UsuarioCredito" AS existente
      WHERE existente."idSolicitudCredito" = solicitud."idSolicitudCredito"
        AND existente."idUsuario" = usuario."idUsuario"
  );

COMMIT;

DROP TABLE seed_config;