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

-- Actividad 5: catálogo de finalidades. Cada finalidad se acepta de forma individual y todas son obligatorias.
CREATE TABLE IF NOT EXISTS "Finalidad" (
    "idFinalidad"     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "nombreFinalidad" VARCHAR(60) NOT NULL UNIQUE,
    "descripcion"     TEXT NOT NULL
);

INSERT INTO "Finalidad" ("nombreFinalidad", "descripcion") VALUES
    ('terminos_y_condiciones', 'Aceptar los Términos y Condiciones que regulan el contrato de uso de la billetera digital.'),
    ('tratamiento_datos_personales', 'Tratar tus datos de identificación y contacto para operar la cuenta, verificar tu identidad y cumplir obligaciones legales.'),
    ('evaluacion_crediticia', 'Evaluar tu riesgo crediticio (score, morosidad y deudas), incluida la consulta a una central de riesgo, para ofrecer y resolver créditos.')
ON CONFLICT ("nombreFinalidad") DO UPDATE SET "descripcion" = EXCLUDED."descripcion";

-- Un registro por cada otorgamiento. "estadoActual" pasa de otorgado a revocado (o reemplazado, cuando se acepta
-- una versión nueva del texto) y la fecha de término queda en "revocado_el".
CREATE TABLE IF NOT EXISTS "UserConsent" (
    "idConsent"    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"    INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "idFinalidad"  INTEGER
        REFERENCES "Finalidad"("idFinalidad") ON DELETE RESTRICT,
    "finalidad"    VARCHAR(60) NOT NULL,
    "versionTexto" VARCHAR(20) NOT NULL,
    "estadoActual" VARCHAR(12) NOT NULL DEFAULT 'otorgado',
    "canal"        VARCHAR(20) NOT NULL,
    "otorgado_el"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revocado_el"  TIMESTAMPTZ,
    "idEvidencia"  UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT
);

-- Migración desde el diseño de la Actividad 4 (sin catálogo ni estado).
ALTER TABLE "UserConsent" ADD COLUMN IF NOT EXISTS "idFinalidad" INTEGER REFERENCES "Finalidad"("idFinalidad") ON DELETE RESTRICT;
ALTER TABLE "UserConsent" ADD COLUMN IF NOT EXISTS "estadoActual" VARCHAR(12) NOT NULL DEFAULT 'otorgado';
DROP TRIGGER IF EXISTS "tg_consentimiento_transicion" ON "UserConsent";
UPDATE "UserConsent" c SET "idFinalidad" = f."idFinalidad"
FROM "Finalidad" f WHERE c."idFinalidad" IS NULL AND f."nombreFinalidad" = c."finalidad";
UPDATE "UserConsent" SET "estadoActual" = 'revocado' WHERE "revocado_el" IS NOT NULL AND "estadoActual" = 'otorgado';
ALTER TABLE "UserConsent" ALTER COLUMN "idFinalidad" SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'userconsent_estado_check') THEN
        ALTER TABLE "UserConsent" ADD CONSTRAINT "userconsent_estado_check" CHECK (
            "estadoActual" IN ('otorgado', 'revocado', 'reemplazado')
            AND ("estadoActual" = 'otorgado') = ("revocado_el" IS NULL)
        );
    END IF;
END $$;

-- Solo un consentimiento vigente por titular y finalidad.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_consent_vigente" ON "UserConsent"("idUsuario", "idFinalidad") WHERE "estadoActual" = 'otorgado';

-- Log de consentimientos (Actividad 5, parte 3): una fila por cada acción sobre un consentimiento.
-- Lo llena un trigger, así que también registra cambios hechos directamente en la base de datos.
CREATE TABLE IF NOT EXISTS "ConsentLogs" (
    "idEvento"       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "fechaHora"      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "idUsuario"      INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "canal"          VARCHAR(20) NOT NULL,
    "dispositivo"    VARCHAR(160) NOT NULL,
    "idFinalidad"    INTEGER NOT NULL
        REFERENCES "Finalidad"("idFinalidad") ON DELETE RESTRICT,
    "idConsent"      INTEGER
        REFERENCES "UserConsent"("idConsent") ON DELETE RESTRICT,
    "versionTexto"   VARCHAR(20) NOT NULL,
    "accion"         VARCHAR(12) NOT NULL
        CHECK ("accion" IN ('otorgado', 'revocado', 'reemplazado', 'rechazado')),
    "estadoAnterior" VARCHAR(12),
    "estadoNuevo"    VARCHAR(12)
);

DROP TRIGGER IF EXISTS "tg_consentlogs_inmutable" ON "ConsentLogs";
CREATE TRIGGER "tg_consentlogs_inmutable"
    BEFORE UPDATE OR DELETE ON "ConsentLogs"
    FOR EACH ROW EXECUTE FUNCTION fn_registro_inmutable();

-- La aplicación declara canal y dispositivo con set_config(..., true) dentro de la transacción;
-- un cambio hecho por fuera de la API queda registrado con canal "bd_directa".
CREATE OR REPLACE FUNCTION fn_contexto_canal() RETURNS VARCHAR AS $$
    SELECT COALESCE(NULLIF(current_setting('monify.canal', true), ''), 'bd_directa')::VARCHAR;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_contexto_dispositivo() RETURNS VARCHAR AS $$
    SELECT COALESCE(NULLIF(current_setting('monify.dispositivo', true), ''), current_user)::VARCHAR;
$$ LANGUAGE sql STABLE;

-- Solo se permite la transición otorgado -> revocado/reemplazado; el resto del registro es inmutable.
CREATE OR REPLACE FUNCTION fn_consentimiento_transicion() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los consentimientos no se eliminan: se revocan (UserConsent %)', OLD."idConsent";
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT "nombreFinalidad" INTO NEW."finalidad" FROM "Finalidad" WHERE "idFinalidad" = NEW."idFinalidad";
        IF NEW."estadoActual" <> 'otorgado' OR NEW."revocado_el" IS NOT NULL THEN
            RAISE EXCEPTION 'Un consentimiento nuevo debe registrarse como otorgado';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."estadoActual" <> 'otorgado' OR NEW."estadoActual" NOT IN ('revocado', 'reemplazado') THEN
        RAISE EXCEPTION 'Transición de consentimiento no permitida: % -> %', OLD."estadoActual", NEW."estadoActual";
    END IF;
    IF (NEW."idUsuario", NEW."idFinalidad", NEW."finalidad", NEW."versionTexto", NEW."canal", NEW."otorgado_el", NEW."idEvidencia")
       IS DISTINCT FROM (OLD."idUsuario", OLD."idFinalidad", OLD."finalidad", OLD."versionTexto", OLD."canal", OLD."otorgado_el", OLD."idEvidencia") THEN
        RAISE EXCEPTION 'Solo se puede cambiar el estado y la fecha de revocación de un consentimiento';
    END IF;
    NEW."revocado_el" := COALESCE(NEW."revocado_el", clock_timestamp());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_consentimiento_log() RETURNS trigger AS $$
BEGIN
    INSERT INTO "ConsentLogs" ("idUsuario", "canal", "dispositivo", "idFinalidad", "idConsent", "versionTexto", "accion", "estadoAnterior", "estadoNuevo")
    VALUES (NEW."idUsuario", fn_contexto_canal(), fn_contexto_dispositivo(), NEW."idFinalidad", NEW."idConsent", NEW."versionTexto",
            NEW."estadoActual", CASE WHEN TG_OP = 'UPDATE' THEN OLD."estadoActual" END, NEW."estadoActual");
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tg_consentimiento_transicion" ON "UserConsent";
CREATE TRIGGER "tg_consentimiento_transicion"
    BEFORE INSERT OR UPDATE OR DELETE ON "UserConsent"
    FOR EACH ROW EXECUTE FUNCTION fn_consentimiento_transicion();

DROP TRIGGER IF EXISTS "tg_consentimiento_log" ON "UserConsent";
CREATE TRIGGER "tg_consentimiento_log"
    AFTER INSERT OR UPDATE ON "UserConsent"
    FOR EACH ROW EXECUTE FUNCTION fn_consentimiento_log();

-- ---------------------------------------------------------------------------
-- Actividad 5, parte 2: solicitudes de ejercicio de derechos (acceso y portabilidad,
-- rectificación y supresión). Flujo: recibida -> verificada -> en_evaluacion ->
-- ejecutada | rechazada -> cerrada. Cada cambio de estado queda en el historial (trigger).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SolicitudDerecho" (
    "idSolicitudDerecho"   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idUsuario"            INTEGER NOT NULL
        REFERENCES "Usuario"("idUsuario") ON DELETE RESTRICT,
    "tipoDerecho"          VARCHAR(20) NOT NULL
        CHECK ("tipoDerecho" IN ('acceso', 'rectificacion', 'supresion')),
    "estado"               VARCHAR(20) NOT NULL DEFAULT 'recibida'
        CHECK ("estado" IN ('recibida', 'verificada', 'en_evaluacion', 'ejecutada', 'rechazada', 'cerrada')),
    "resultado"            VARCHAR(20)
        CHECK ("resultado" IN ('ejecutada', 'rechazada', 'desistida')),
    -- Cambios pedidos en una rectificación, cifrados con AES-256-GCM; se borran al cerrar la solicitud.
    "datosSolicitud"       TEXT,
    "respuesta"            TEXT,
    "nivelVerificacion"    VARCHAR(30) NOT NULL
        CHECK ("nivelVerificacion" IN ('contrasena', 'contrasena_y_codigo')),
    -- Solo se guarda el HMAC del código de un solo uso, nunca el código.
    "codigoVerificacion"   VARCHAR(64),
    "codigoExpiraEn"       TIMESTAMPTZ,
    "intentosVerificacion" INTEGER NOT NULL DEFAULT 0,
    "canal"                VARCHAR(20) NOT NULL,
    "recibidaEn"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "verificadaEn"         TIMESTAMPTZ,
    "evaluadaEn"           TIMESTAMPTZ,
    "resueltaEn"           TIMESTAMPTZ,
    "cerradaEn"            TIMESTAMPTZ,
    "plazoRespuesta"       TIMESTAMPTZ NOT NULL,
    "descargaDisponibleHasta" TIMESTAMPTZ,
    "idEvidencia"          UUID REFERENCES "EvidenciaNoRepudio"("idEvidencia") ON DELETE RESTRICT,
    CHECK (("estado" = 'cerrada') = ("cerradaEn" IS NOT NULL))
);

-- Una sola solicitud abierta por titular y tipo de derecho.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_solicitud_derecho_abierta" ON "SolicitudDerecho"("idUsuario", "tipoDerecho")
    WHERE "estado" NOT IN ('cerrada');
CREATE INDEX IF NOT EXISTS "idx_solicitud_derecho_usuario" ON "SolicitudDerecho"("idUsuario");

CREATE TABLE IF NOT EXISTS "HistorialSolicitudDerecho" (
    "idEvento"           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "idSolicitudDerecho" INTEGER NOT NULL
        REFERENCES "SolicitudDerecho"("idSolicitudDerecho") ON DELETE RESTRICT,
    "estadoAnterior"     VARCHAR(20),
    "estadoNuevo"        VARCHAR(20) NOT NULL,
    "fecha"              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "actor"              VARCHAR(40) NOT NULL,
    "canal"              VARCHAR(20) NOT NULL
);

DROP TRIGGER IF EXISTS "tg_historial_derecho_inmutable" ON "HistorialSolicitudDerecho";
CREATE TRIGGER "tg_historial_derecho_inmutable"
    BEFORE UPDATE OR DELETE ON "HistorialSolicitudDerecho"
    FOR EACH ROW EXECUTE FUNCTION fn_registro_inmutable();

-- Las solicitudes no se borran y siguen el flujo definido; los estados no pueden saltarse ni retroceder.
CREATE OR REPLACE FUNCTION fn_solicitud_derecho_flujo() RETURNS trigger AS $$
DECLARE
    permitidos TEXT[];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Las solicitudes de derechos no se eliminan (SolicitudDerecho %)', OLD."idSolicitudDerecho";
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."estado" <> 'recibida' THEN
            RAISE EXCEPTION 'Una solicitud de derechos nueva debe partir en estado recibida';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."idUsuario" <> OLD."idUsuario" OR NEW."tipoDerecho" <> OLD."tipoDerecho" OR NEW."recibidaEn" <> OLD."recibidaEn" THEN
        RAISE EXCEPTION 'El titular, el tipo y la fecha de recepción de una solicitud no se modifican';
    END IF;
    IF NEW."estado" = OLD."estado" THEN
        IF OLD."estado" = 'cerrada' AND (NEW."respuesta", NEW."resultado") IS DISTINCT FROM (OLD."respuesta", OLD."resultado") THEN
            RAISE EXCEPTION 'Una solicitud cerrada no se modifica';
        END IF;
        RETURN NEW;
    END IF;
    permitidos := CASE OLD."estado"
        WHEN 'recibida' THEN ARRAY['verificada', 'rechazada', 'cerrada']
        WHEN 'verificada' THEN ARRAY['en_evaluacion', 'cerrada']
        WHEN 'en_evaluacion' THEN ARRAY['ejecutada', 'rechazada']
        WHEN 'ejecutada' THEN ARRAY['cerrada']
        WHEN 'rechazada' THEN ARRAY['cerrada']
        ELSE ARRAY[]::TEXT[]
    END;
    IF NOT (NEW."estado" = ANY (permitidos)) THEN
        RAISE EXCEPTION 'Transición de solicitud no permitida: % -> %', OLD."estado", NEW."estado";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_solicitud_derecho_historial() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW."estado" IS DISTINCT FROM OLD."estado" THEN
        INSERT INTO "HistorialSolicitudDerecho" ("idSolicitudDerecho", "estadoAnterior", "estadoNuevo", "actor", "canal")
        VALUES (NEW."idSolicitudDerecho", CASE WHEN TG_OP = 'UPDATE' THEN OLD."estado" END, NEW."estado",
                COALESCE(NULLIF(current_setting('monify.actor', true), ''), 'bd:' || current_user), fn_contexto_canal());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tg_solicitud_derecho_flujo" ON "SolicitudDerecho";
CREATE TRIGGER "tg_solicitud_derecho_flujo"
    BEFORE INSERT OR UPDATE OR DELETE ON "SolicitudDerecho"
    FOR EACH ROW EXECUTE FUNCTION fn_solicitud_derecho_flujo();

DROP TRIGGER IF EXISTS "tg_solicitud_derecho_historial" ON "SolicitudDerecho";
CREATE TRIGGER "tg_solicitud_derecho_historial"
    AFTER INSERT OR UPDATE ON "SolicitudDerecho"
    FOR EACH ROW EXECUTE FUNCTION fn_solicitud_derecho_historial();

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
CREATE INDEX IF NOT EXISTS "idx_consentlogs_usuario" ON "ConsentLogs"("idUsuario");
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
