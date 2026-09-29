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
    "nombreCompleto"  VARCHAR(255) NOT NULL,
    "rut"             VARCHAR(20)  NOT NULL UNIQUE,
    "fechaNacimiento" DATE         NOT NULL,
    "Saldo"           NUMERIC(14,2) NOT NULL DEFAULT 0,
    "rentaMensual"    NUMERIC(14,2),
    "numeroCelular"   VARCHAR(20),
    "EMAIL"           VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "VerificadorDeIdentidad" (
    "idVerificacion"            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"                 INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "estadoVerificacion"        VARCHAR(50) NOT NULL,
    "fechaVerificacion"         TIMESTAMP,
    "fechaExpiracion"           TIMESTAMP,
    "metodoDeVerificacion"      VARCHAR(100),
    "hashDeVerificacion"        VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS "ConsultaDeRiesgo" (
    "idConsulta"        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"         INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "ScoreDeRiesgo"     NUMERIC(6,2),
    "morosidad"         BOOLEAN NOT NULL DEFAULT false,
    "tiempoDeMorosidad" DATE,
    "cantidadDeuda"     NUMERIC(14,2),
    "tiempoEnDeuda"     DATE,
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
    "montoTransaccion" NUMERIC(14,2) NOT NULL,
    PRIMARY KEY ("idTransaccion", "idUsuario")
);

CREATE TABLE IF NOT EXISTS "Deuda" (
    "idDeuda"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"  INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "fechaDeuda" TIMESTAMP NOT NULL DEFAULT now(),
    "montoDeuda" NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Credito" (
    "idCredito"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "montoCredito" NUMERIC(14,2) NOT NULL,
    "tasaInteres"  NUMERIC(6,2)  NOT NULL
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
    "cuota"               NUMERIC(14,2),
    "montoAcumulado"      NUMERIC(14,2) NOT NULL DEFAULT 0,
    "montoFinal"          NUMERIC(14,2),
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
