BEGIN;

-- Este esquema implementa el diseño de la Actividad 4 (minimización, seudonimización,
-- anonimización, RBAC, auditoría y no repudio). Las bases creadas con el diseño anterior
-- (tabla "TipoUsuario") no se migran automáticamente: se deben recrear con `pnpm run db:reset`.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'TipoUsuario'
    ) THEN
        RAISE EXCEPTION 'Esquema anterior detectado (tabla "TipoUsuario"). Recrea la base con "pnpm run db:reset" y luego "pnpm run db:recrear-cifrados".';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------

-- El rol se guarda como código seudonimizado (Tu, Ta, Tr, Tau, To); el significado vive solo en la aplicación.
CREATE TABLE IF NOT EXISTS "Rol" (
    "idRol"     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "codigoRol" VARCHAR(10) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "EstadoSolicitud" (
    "idEstadoSolicitud" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "estadoSolicitud"   VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "Banco" (
    "idBanco"     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "nombreBanco" VARCHAR(100) NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------------
-- Cuentas. Nombre, RUT, celular y correo almacenan SEUDÓNIMOS; los valores originales
-- viven cifrados en una bóveda separada (otra base de datos). La fecha de nacimiento se
-- reemplaza por el indicador de mayoría de edad y la renta por un tramo.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Usuario" (
    "idUsuario"       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idRol"           INTEGER NOT NULL
        REFERENCES "Rol"("idRol") ON DELETE RESTRICT,
    "nombreCompleto"  TEXT NOT NULL,
    "rut"             TEXT NOT NULL,
    "rutHash"         TEXT,
    "esMayorEdad"     BOOLEAN NOT NULL,
    "tramoRenta"      TEXT,
    "numeroCelular"   TEXT,
    "email"           VARCHAR(255) NOT NULL UNIQUE,
    "emailHash"       TEXT,
    "isAccessBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
    "estadoCuenta"    VARCHAR(20) NOT NULL DEFAULT 'activa'
        CHECK ("estadoCuenta" IN ('activa', 'eliminada')),
    "creadoEn"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AdministradorRiesgo" (
    "idAdminRiesgo"  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "nombreCompleto" TEXT NOT NULL,
    "rut"            TEXT NOT NULL,
    "rutHash"        TEXT,
    "numeroCelular"  TEXT,
    "email"          VARCHAR(255) NOT NULL UNIQUE,
    "emailHash"      TEXT,
    -- Nombre ofuscado a propósito: es el indicador de acceso bloqueado.
    "flagAcc"        BOOLEAN NOT NULL DEFAULT FALSE,
    "creadoEn"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "CredAuthUser" (
    "idCredenciales"   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"        INTEGER NOT NULL UNIQUE
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "contraseña"       VARCHAR(255) NOT NULL,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0
);

-- La contraseña del administrador de riesgo se conserva solo 24 horas ("expiraEn").
CREATE TABLE IF NOT EXISTS "CredAuthAdministrador" (
    "idCredenciales"   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idAdminRiesgo"    INTEGER NOT NULL UNIQUE
        REFERENCES "AdministradorRiesgo"("idAdminRiesgo") ON DELETE RESTRICT,
    "contraseña"       VARCHAR(255) NOT NULL,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "expiraEn"         TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Auditoría y no repudio (tablas de solo anexado)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "EvidenciaNoRepudio" (
    "idEvidencia"     UUID PRIMARY KEY,
    "idUsuario"       INTEGER REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idAdminRiesgo"   INTEGER REFERENCES "AdministradorRiesgo"("idAdminRiesgo") ON DELETE RESTRICT,
    "accion"          VARCHAR(80) NOT NULL,
    "recurso"         VARCHAR(120),
    "textoConfirmado" TEXT NOT NULL,
    "versionTexto"    VARCHAR(20) NOT NULL,
    "canal"           VARCHAR(20) NOT NULL,
    "dispositivo"     VARCHAR(160) NOT NULL,
    "confirmadoEn"    TIMESTAMPTZ NOT NULL,
    "huellaDatos"     VARCHAR(64) NOT NULL,
    "firma"           TEXT NOT NULL,
    CHECK (num_nonnulls("idUsuario", "idAdminRiesgo") = 1)
);

CREATE TABLE IF NOT EXISTS "UserLogs" (
    "uniqueID"      UUID PRIMARY KEY,
    "secuencia"     BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    "idUsuario"     INTEGER REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idAdminRiesgo" INTEGER REFERENCES "AdministradorRiesgo"("idAdminRiesgo") ON DELETE RESTRICT,
    "fechaAccion"   TIMESTAMPTZ NOT NULL,
    "sistema"       VARCHAR(40) NOT NULL,
    "accion"        VARCHAR(80) NOT NULL,
    "canal"         VARCHAR(20) NOT NULL,
    "dispositivo"   VARCHAR(160) NOT NULL,
    "resultado"     VARCHAR(20) NOT NULL,
    "recurso"       VARCHAR(120),
    "detalle"       TEXT,
    "hashPrevio"    VARCHAR(64) NOT NULL,
    "hashRegistro"  VARCHAR(64) NOT NULL,
    CHECK (num_nonnulls("idUsuario", "idAdminRiesgo") <= 1)
);

CREATE OR REPLACE FUNCTION fn_registro_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es de solo anexado (auditoría y no repudio): no admite UPDATE ni DELETE', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tg_userlogs_inmutable" ON "UserLogs";
CREATE TRIGGER "tg_userlogs_inmutable"
    BEFORE UPDATE OR DELETE ON "UserLogs"
    FOR EACH ROW EXECUTE FUNCTION fn_registro_inmutable();

DROP TRIGGER IF EXISTS "tg_evidencia_inmutable" ON "EvidenciaNoRepudio";
CREATE TRIGGER "tg_evidencia_inmutable"
    BEFORE UPDATE OR DELETE ON "EvidenciaNoRepudio"
    FOR EACH ROW EXECUTE FUNCTION fn_registro_inmutable();

-- ---------------------------------------------------------------------------
-- Consentimientos y autorizaciones de acceso
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UserConsent" (
    "idConsent"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"    INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "finalidad"    VARCHAR(60) NOT NULL,
    "versionTexto" VARCHAR(20) NOT NULL,
    "canal"        VARCHAR(20) NOT NULL,
    "otorgado_el"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revocado_el"  TIMESTAMPTZ,
    "idEvidencia"  UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT
);

-- Autorización expresa: el titular (o un auditor, para logs) permite a otro usuario interno ver cierto ámbito.
CREATE TABLE IF NOT EXISTS "AutorizacionAcceso" (
    "idAutorizacion"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idOtorgante"       INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idBeneficiario"    INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idUsuarioObjetivo" INTEGER
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "ambito"            VARCHAR(20) NOT NULL
        CHECK ("ambito" IN ('financiera', 'movimientos', 'deuda', 'logs')),
    "otorgadoEn"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expiraEn"          TIMESTAMPTZ NOT NULL,
    "revocadoEn"        TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Datos financieros
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "VerificadorDeIdentidad" (
    "idVerificacion"       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"            INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "estadoVerificacion"   VARCHAR(50) NOT NULL,
    "fechaVerificacion"    TIMESTAMPTZ,
    "fechaExpiracion"      TIMESTAMPTZ,
    "metodoDeVerificacion" VARCHAR(50),
    "hashDeVerificacion"   VARCHAR(255)
);

-- Se elimina cantidadDeuda (dato calculable); los tiempos se guardan por tramos.
CREATE TABLE IF NOT EXISTS "ConsultaDeRiesgo" (
    "idConsulta"        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"         INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "ScoreDeRiesgo"     TEXT,
    "morosidad"         TEXT,
    "tiempoDeMorosidad" TEXT,
    "tiempoEnDeuda"     TEXT,
    "fechaConsulta"     TIMESTAMP NOT NULL DEFAULT now()
);

-- Sin CVV ni fecha de vencimiento: los valida el tercero procesador de pagos.
CREATE TABLE IF NOT EXISTS "Tarjeta" (
    "idTarjeta"     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idBanco"       INTEGER NOT NULL
        REFERENCES "Banco"("idBanco") ON DELETE RESTRICT,
    "numeroTarjeta" TEXT NOT NULL,
    "saldo"         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Billetera" (
    "idUsuario" INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idTarjeta" INTEGER NOT NULL UNIQUE
        REFERENCES "Tarjeta"("idTarjeta") ON DELETE RESTRICT,
    PRIMARY KEY ("idUsuario", "idTarjeta")
);

CREATE TABLE IF NOT EXISTS "Transaccion" (
    "idTransaccion"    INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,
    "idUsuario"        INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idTarjeta"        INTEGER NOT NULL
        REFERENCES "Tarjeta"("idTarjeta") ON DELETE RESTRICT,
    "fechaTransaccion" TIMESTAMP NOT NULL DEFAULT now(),
    "montoTransaccion" TEXT NOT NULL,
    "idEvidencia"      UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT,
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
    "idSolicitudCredito"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idAdminRiesgo"         INTEGER
        REFERENCES "AdministradorRiesgo"("idAdminRiesgo") ON DELETE RESTRICT,
    "idUsuarioGestor"       INTEGER
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idCredito"             INTEGER NOT NULL
        REFERENCES "Credito"("idCredito") ON DELETE RESTRICT,
    "fechaSolicitud"        TIMESTAMP NOT NULL DEFAULT now(),
    "idEstadoSolicitud"     INTEGER NOT NULL
        REFERENCES "EstadoSolicitud"("idEstadoSolicitud") ON DELETE RESTRICT,
    "idEvidencia"           UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT,
    "idEvidenciaResolucion" UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "UsuarioCredito" (
    "idSolicitudCredito" INTEGER NOT NULL
        REFERENCES "SolicitudCredito"("idSolicitudCredito") ON DELETE RESTRICT,
    "idUsuario"          INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "cuota"              TEXT,
    "montoAcumulado"     TEXT,
    "montoFinal"         TEXT,
    PRIMARY KEY ("idSolicitudCredito", "idUsuario")
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "idx_usuario_rol" ON "Usuario"("idRol");
-- Índices de búsqueda deterministas (HMAC) para login y detección de duplicados sin descifrar nada.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_usuario_ruthash" ON "Usuario"("rutHash");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_usuario_emailhash" ON "Usuario"("emailHash");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_ruthash" ON "AdministradorRiesgo"("rutHash");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_emailhash" ON "AdministradorRiesgo"("emailHash");
CREATE INDEX IF NOT EXISTS "idx_verificador_usuario" ON "VerificadorDeIdentidad"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_consulta_usuario" ON "ConsultaDeRiesgo"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_transaccion_usuario" ON "Transaccion"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_transaccion_tarjeta" ON "Transaccion"("idTarjeta");
CREATE INDEX IF NOT EXISTS "idx_deuda_usuario" ON "Deuda"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_solicitud_credito" ON "SolicitudCredito"("idCredito");
CREATE INDEX IF NOT EXISTS "idx_solicitud_estado" ON "SolicitudCredito"("idEstadoSolicitud");
CREATE INDEX IF NOT EXISTS "idx_usuariocredito_usuario" ON "UsuarioCredito"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_userlogs_usuario" ON "UserLogs"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_userlogs_fecha" ON "UserLogs"("fechaAccion");
CREATE INDEX IF NOT EXISTS "idx_evidencia_usuario" ON "EvidenciaNoRepudio"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_consent_usuario" ON "UserConsent"("idUsuario");
CREATE INDEX IF NOT EXISTS "idx_autorizacion_beneficiario" ON "AutorizacionAcceso"("idBeneficiario");

-- ---------------------------------------------------------------------------
-- Datos de catálogo
-- ---------------------------------------------------------------------------

INSERT INTO "Rol" ("codigoRol")
SELECT codigo
FROM unnest(ARRAY['Tu', 'Ta', 'Tr', 'Tau', 'To']) AS codigo
ON CONFLICT ("codigoRol") DO NOTHING;

INSERT INTO "EstadoSolicitud" ("estadoSolicitud")
SELECT estado
FROM unnest(ARRAY['recibida', 'en_evaluacion', 'aprobada', 'rechazada']) AS estado
ON CONFLICT ("estadoSolicitud") DO NOTHING;

INSERT INTO "Banco" ("nombreBanco")
SELECT banco
FROM unnest(ARRAY['Banco de Chile', 'BancoEstado', 'Banco Santander', 'BCI', 'Scotiabank', 'Banco Itaú']) AS banco
ON CONFLICT ("nombreBanco") DO NOTHING;

COMMIT;
