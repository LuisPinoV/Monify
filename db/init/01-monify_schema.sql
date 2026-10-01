BEGIN;

CREATE TABLE IF NOT EXISTS "TipoUsuario" (
    "idTipoUsuario" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tipoUsuario"   VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "EstadoSolicitud" (
    "idEstadoSolicitud" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "estadoSolicitud"   VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Usuario" (
    "idUsuario"       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idTipoUsuario"   INTEGER NOT NULL
        REFERENCES "TipoUsuario"("idTipoUsuario") ON DELETE RESTRICT,
    "nombreCompleto"  TEXT NOT NULL,
    "rut"             VARCHAR(20)  NOT NULL UNIQUE,
    "fechaNacimiento" TEXT         NOT NULL,
    "Saldo"           TEXT NOT NULL,
    "rentaMensual"    TEXT,
    "numeroCelular"   TEXT,
    "EMAIL"           VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "VerificadorDeIdentidad" (
    "idVerificacion"            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"                 INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "estadoVerificacion"        VARCHAR(50) NOT NULL,
    "fechaVerificacion"        TEXT,
    "fechaExpiracion"           TEXT,
    "metodoDeVerificacion"      TEXT,
    "hashDeVerificacion"        VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS "ConsultaDeRiesgo" (
    "idConsulta"        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"         INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "ScoreDeRiesgo"     TEXT,
    "morosidad"         TEXT,
    "tiempoDeMorosidad" TEXT,
    "cantidadDeuda"     TEXT,
    "tiempoEnDeuda"     TEXT,
    "fechaConsulta"     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "credencialesAutenticacion" (
    "idCredenciales" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"      INTEGER NOT NULL UNIQUE
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "contraseña"     VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Transaccion" (
    "idTransaccion"    INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,
    "idUsuario"        INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "fechaTransaccion" TIMESTAMP NOT NULL DEFAULT now(),
    "montoTransaccion" TEXT NOT NULL,
    PRIMARY KEY ("idTransaccion", "idUsuario")
);

CREATE TABLE IF NOT EXISTS "Deuda" (
    "idDeuda"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"  INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "fechaDeuda" TIMESTAMP NOT NULL DEFAULT now(),
    "montoDeuda" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Credito" (
    "idCredito"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "montoCredito" TEXT NOT NULL,
    "tasaInteres"  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "SolicitudCredito" (
    "idSolicitudCredito" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idCredito"           INTEGER NOT NULL
        REFERENCES "Credito"("idCredito") ON DELETE RESTRICT,
    "fechaSolicitud"      TIMESTAMP NOT NULL DEFAULT now(),
    "idEstadoSolicitud"   INTEGER NOT NULL
        REFERENCES "EstadoSolicitud"("idEstadoSolicitud") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "UsuarioCredito" (
    "idSolicitudCredito" INTEGER NOT NULL
        REFERENCES "SolicitudCredito"("idSolicitudCredito") ON DELETE RESTRICT,
    "idUsuario"           INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "cuota"               TEXT,
    "montoAcumulado"      TEXT,
    "montoFinal"          TEXT,
    PRIMARY KEY ("idSolicitudCredito", "idUsuario")
);

CREATE INDEX IF NOT EXISTS "idx_usuario_tipousuario" ON "Usuario"("idTipoUsuario");
CREATE INDEX IF NOT EXISTS "idx_verificador_usuario" ON "VerificadorDeIdentidad"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_consulta_usuario" ON "ConsultaDeRiesgo"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_transaccion_usuario" ON "Transaccion"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_deuda_usuario" ON "Deuda"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_solicitud_credito" ON "SolicitudCredito"("idCredito");
CREATE INDEX IF NOT EXISTS "idx_solicitud_estado" ON "SolicitudCredito"("idEstadoSolicitud");
CREATE INDEX IF NOT EXISTS "idx_usuariocredito_usuario" ON "UsuarioCredito"("idUsuario");

ALTER TABLE "Usuario" ALTER COLUMN "nombreCompleto" TYPE TEXT USING "nombreCompleto"::TEXT;
ALTER TABLE "Usuario" ALTER COLUMN "fechaNacimiento" TYPE TEXT USING "fechaNacimiento"::TEXT;
ALTER TABLE "Usuario" ALTER COLUMN "Saldo" DROP DEFAULT;
ALTER TABLE "Usuario" ALTER COLUMN "Saldo" TYPE TEXT USING "Saldo"::TEXT;
ALTER TABLE "Usuario" ALTER COLUMN "rentaMensual" TYPE TEXT USING "rentaMensual"::TEXT;
ALTER TABLE "Usuario" ALTER COLUMN "numeroCelular" TYPE TEXT USING "numeroCelular"::TEXT;
ALTER TABLE "VerificadorDeIdentidad" ALTER COLUMN "fechaVerificacion" TYPE TEXT USING "fechaVerificacion"::TEXT;
ALTER TABLE "VerificadorDeIdentidad" ALTER COLUMN "fechaExpiracion" TYPE TEXT USING "fechaExpiracion"::TEXT;
ALTER TABLE "VerificadorDeIdentidad" ALTER COLUMN "metodoDeVerificacion" TYPE TEXT USING "metodoDeVerificacion"::TEXT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "ScoreDeRiesgo" TYPE TEXT USING "ScoreDeRiesgo"::TEXT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "morosidad" DROP DEFAULT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "morosidad" TYPE TEXT USING "morosidad"::TEXT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "tiempoDeMorosidad" TYPE TEXT USING "tiempoDeMorosidad"::TEXT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "cantidadDeuda" TYPE TEXT USING "cantidadDeuda"::TEXT;
ALTER TABLE "ConsultaDeRiesgo" ALTER COLUMN "tiempoEnDeuda" TYPE TEXT USING "tiempoEnDeuda"::TEXT;
ALTER TABLE "Transaccion" ALTER COLUMN "montoTransaccion" TYPE TEXT USING "montoTransaccion"::TEXT;
ALTER TABLE "Deuda" ALTER COLUMN "montoDeuda" TYPE TEXT USING "montoDeuda"::TEXT;
ALTER TABLE "Credito" ALTER COLUMN "montoCredito" TYPE TEXT USING "montoCredito"::TEXT;
ALTER TABLE "Credito" ALTER COLUMN "tasaInteres" TYPE TEXT USING "tasaInteres"::TEXT;
ALTER TABLE "UsuarioCredito" ALTER COLUMN "cuota" TYPE TEXT USING "cuota"::TEXT;
ALTER TABLE "UsuarioCredito" ALTER COLUMN "montoAcumulado" TYPE TEXT USING "montoAcumulado"::TEXT;
ALTER TABLE "UsuarioCredito" ALTER COLUMN "montoFinal" TYPE TEXT USING "montoFinal"::TEXT;
INSERT INTO "TipoUsuario" ("tipoUsuario")
SELECT 'usuario'
WHERE NOT EXISTS (SELECT 1 FROM "TipoUsuario" WHERE "tipoUsuario" = 'usuario');

INSERT INTO "EstadoSolicitud" ("estadoSolicitud")
SELECT estado
FROM unnest(ARRAY['recibida', 'en_evaluacion', 'aprobada', 'rechazada']) AS estado
WHERE NOT EXISTS (
    SELECT 1 FROM "EstadoSolicitud" existente
    WHERE existente."estadoSolicitud" = estado
);

COMMIT;
