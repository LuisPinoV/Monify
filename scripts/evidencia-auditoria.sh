#!/usr/bin/env bash
set -euo pipefail

# Carga la configuración local sin imprimir sus secretos.
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

BASE_URL="${BASE_URL:-http://localhost:${PUERTO:-3000}}"
EVIDENCIA_DIR="${EVIDENCIA_DIR:-docs/evidencia-auditoria}"
mkdir -p "$EVIDENCIA_DIR"

: "${DATABASE_URL:?Define DATABASE_URL de desarrollo}"
: "${TITULAR_TOKEN:?Define TITULAR_TOKEN de una cuenta ficticia de desarrollo}"
: "${AUDITOR_TOKEN:?Define AUDITOR_TOKEN de desarrollo}"
: "${ADMIN_TOKEN:?Define ADMIN_TOKEN de desarrollo}"
: "${RIESGO_TOKEN:?Define RIESGO_TOKEN de desarrollo}"
: "${TITULAR_ID:?Define TITULAR_ID de prueba}"
: "${RIESGO_ID:?Define RIESGO_ID de prueba}"
: "${E1_CORREO:?Define E1_CORREO de una cuenta ficticia separada para bloquearla}"
: "${E1_CONTRASENA:?Define E1_CONTRASENA de esa cuenta ficticia}"

api() {
  local metodo="$1" ruta="$2" token="${3:-}" cuerpo="${4:-}" motivo="${5:-}"
  local -a opciones=(--silent --show-error --request "$metodo" "$BASE_URL$ruta" --header 'content-type: application/json' --header 'x-canal: api' --header "x-dispositivo: ${EVIDENCIA_DISPOSITIVO:-evidencia-auditoria}")
  [[ -n "$token" ]] && opciones+=(--header "authorization: Bearer $token")
  [[ -n "$motivo" ]] && opciones+=(--header "x-motivo-acceso: $motivo")
  [[ -n "$cuerpo" ]] && opciones+=(--data "$cuerpo")
  printf '+ curl --request %q %q [credenciales y cuerpo omitidos]\n' "$metodo" "$BASE_URL$ruta"
    curl "${opciones[@]}" --write-out '\nHTTP_STATUS:%{http_code}\n' | sed -E 's/("accessToken"[[:space:]]*:[[:space:]]*")[^"]+/\1[token oculto]/g'
}

sql() {
  local consulta="$1"
  printf '+ psql "$DATABASE_URL" -X -P pager=off -c %q\n' "$consulta"
  psql "$DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -c "$consulta"
}

archivo() {
  : > "$EVIDENCIA_DIR/$1"
  printf '# %s\n\n' "$2" >> "$EVIDENCIA_DIR/$1"
}

archivo E1-login.txt 'E1: login exitoso y tres logins fallidos'
{
  printf 'Cuenta ficticia separada: %s\n\n' "$E1_CORREO"
  api POST /auth/login '' "{\"correo\":\"$E1_CORREO\",\"contrasena\":\"$E1_CONTRASENA\"}"
  api POST /auth/login '' '{"correo":"'"$E1_CORREO"'","contrasena":"incorrecta-1"}'
  api POST /auth/login '' '{"correo":"'"$E1_CORREO"'","contrasena":"incorrecta-2"}'
  api POST /auth/login '' '{"correo":"'"$E1_CORREO"'","contrasena":"incorrecta-3"}'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "accion" IN ('"'"'auth.login'"'"','"'"'auth.cuenta_bloqueada'"'"') ORDER BY "secuencia" DESC LIMIT 10;'
} >> "$EVIDENCIA_DIR/E1-login.txt"

archivo E2-lecturas-titular.txt 'E2: titular consulta perfil e historial'
{
  api GET /usuarios/me "$TITULAR_TOKEN"
  api GET /transacciones "$TITULAR_TOKEN"
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "idUsuario" = '"$TITULAR_ID"' AND "accion" IN ('"'"'perfil.ver'"'"','"'"'historial.ver'"'"') ORDER BY "secuencia" DESC LIMIT 10;'
} >> "$EVIDENCIA_DIR/E2-lecturas-titular.txt"

archivo E3-accesos-personal.txt 'E3: personal consulta KYC y riesgo de otro titular'
{
  api GET "/verificaciones-identidad?usuarioId=$TITULAR_ID" "$RIESGO_TOKEN" '' 'revision KYC ficticia'
  api GET "/consultas-riesgo?usuarioId=$TITULAR_ID" "$RIESGO_TOKEN" '' 'evaluacion crediticia ficticia'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idAdminRiesgo", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "idAdminRiesgo" = '"$RIESGO_ID"' AND "accion" IN ('"'"'kyc.ver'"'"','"'"'info_financiera.ver'"'"') ORDER BY "secuencia" DESC LIMIT 10;'
} >> "$EVIDENCIA_DIR/E3-accesos-personal.txt"

archivo E4-derechos.txt 'E4: titular ejerce acceso y rectificacion'
{
  api POST /derechos/solicitudes "$TITULAR_TOKEN" '{"tipo":"acceso"}'
  api POST /derechos/solicitudes "$TITULAR_TOKEN" '{"tipo":"rectificacion","cambios":{"nombre":"Titular Ficticio"}}'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "idUsuario" = '"$TITULAR_ID"' AND "accion" LIKE '"'"'derechos.%'"'"' ORDER BY "secuencia" DESC LIMIT 20;'
} >> "$EVIDENCIA_DIR/E4-derechos.txt"

archivo E5-consentimientos.txt 'E5: titular otorga y revoca consentimiento'
{
  api POST "/consentimientos/${FINALIDAD:-evaluacion_crediticia}/revocar" "$TITULAR_TOKEN" '{"confirmacionNoRepudio":true}'
  api POST /consentimientos/otorgar "$TITULAR_TOKEN" '{"versionTerminos":"'"${VERSION_TERMINOS:-1.1}"'","aceptaTerminos":true,"aceptaTratamientoDatos":true,"aceptaEvaluacionCrediticia":true}'
  api POST "/consentimientos/${FINALIDAD:-evaluacion_crediticia}/revocar" "$TITULAR_TOKEN" '{"confirmacionNoRepudio":true}'
  api POST /consentimientos/otorgar "$TITULAR_TOKEN" '{"versionTerminos":"'"${VERSION_TERMINOS:-1.1}"'","aceptaTerminos":true,"aceptaTratamientoDatos":true,"aceptaEvaluacionCrediticia":true}'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "idUsuario" = '"$TITULAR_ID"' AND "accion" LIKE '"'"'consentimiento.%'"'"' ORDER BY "secuencia" DESC LIMIT 10;'
} >> "$EVIDENCIA_DIR/E5-consentimientos.txt"

archivo E6-transaccion.txt 'E6: titular crea una transaccion ficticia'
{
  api POST /transacciones "$TITULAR_TOKEN" '{"tarjetaId":'"${TARJETA_ID:-1}"',"tipo":"abono","monto":1000,"confirmacionNoRepudio":true}'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "idUsuario" = '"$TITULAR_ID"' AND "accion" = '"'"'transaccion.crear'"'"' ORDER BY "secuencia" DESC LIMIT 5;'
} >> "$EVIDENCIA_DIR/E6-transaccion.txt"

archivo E7-control-acceso-logs.txt 'E7: control de acceso a logs'
{
  api GET /auditoria/logs "$TITULAR_TOKEN"
  api GET /auditoria/logs "$ADMIN_TOKEN"
  api GET /auditoria/logs "$AUDITOR_TOKEN"
  sql 'SELECT "secuencia", "fechaAccion" AS hora, "idUsuario", "idAdminRiesgo", "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" WHERE "accion" = '"'"'acceso_denegado'"'"' OR "accion" = '"'"'logs.revisar'"'"' ORDER BY "secuencia" DESC LIMIT 20;'
} >> "$EVIDENCIA_DIR/E7-control-acceso-logs.txt"

archivo E8-sin-datos-personales.txt 'E8: comprobacion de ausencia de datos personales en UserLogs'
{
  sql 'SELECT count(*) FROM "UserLogs" WHERE "recurso" ~ '"'"'[0-9]{1,2}\\.?[0-9]{3}\\.?[0-9]{3}-[0-9kK]'"'"' OR "recurso" LIKE '"'"'%@%'"'"' OR "recurso" ~ '"'"'[0-9]{9,}'"'"';'
  sql 'SELECT "detalle" FROM "UserLogs" ORDER BY "secuencia" DESC LIMIT 3;'
} >> "$EVIDENCIA_DIR/E8-sin-datos-personales.txt"

archivo E9-integridad.txt 'E9: integridad y triggers de UserLogs'
{
  api GET /auditoria/integridad "$AUDITOR_TOKEN"
  printf '+ UPDATE UserLogs (debe fallar)\n'
  psql "$DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -c 'UPDATE "UserLogs" SET "accion" = '"'"'prueba'"'"' WHERE "secuencia" = (SELECT max("secuencia") FROM "UserLogs");' 2>&1 || true
  printf '+ DELETE UserLogs (debe fallar)\n'
  psql "$DATABASE_URL" -X -P pager=off -v ON_ERROR_STOP=1 -c 'DELETE FROM "UserLogs" WHERE "secuencia" = (SELECT max("secuencia") FROM "UserLogs");' 2>&1 || true
  sql 'SELECT "secuencia", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" ORDER BY "secuencia" DESC LIMIT 5;'
} >> "$EVIDENCIA_DIR/E9-integridad.txt"

archivo E10-cobertura.txt 'E10: cobertura por accion y resultado'
{
  sql 'SELECT "accion", "resultado", count(*) FROM "UserLogs" GROUP BY 1,2 ORDER BY 1,2;'
  sql 'SELECT "secuencia", "fechaAccion" AS hora, COALESCE("idUsuario"::text,"idAdminRiesgo"::text) AS actor, "accion", "resultado", "canal", left("dispositivo",20) AS dispositivo, "recurso", left("hashPrevio",16) AS hash_previo, left("hashRegistro",16) AS hash FROM "UserLogs" ORDER BY "secuencia" DESC LIMIT 50;'
} >> "$EVIDENCIA_DIR/E10-cobertura.txt"

printf 'Evidencia generada en %s\n' "$EVIDENCIA_DIR"
