export const VERSION_TERMINOS = '1.1';
export const VIGENTE_DESDE = '2026-10-30';

export const FINALIDADES = {
  TERMINOS: 'terminos_y_condiciones',
  DATOS: 'tratamiento_datos_personales',
  EVALUACION: 'evaluacion_crediticia'
} as const;
export type Finalidad = (typeof FINALIDADES)[keyof typeof FINALIDADES];

// Todas las finalidades son obligatorias y cada una se acepta con su propia casilla (campo del cuerpo de la petición).
export const CAMPO_ACEPTACION: Record<Finalidad, string> = {
  [FINALIDADES.TERMINOS]: 'aceptaTerminos',
  [FINALIDADES.DATOS]: 'aceptaTratamientoDatos',
  [FINALIDADES.EVALUACION]: 'aceptaEvaluacionCrediticia'
};
export const FINALIDADES_OBLIGATORIAS = Object.keys(CAMPO_ACEPTACION) as Finalidad[];

// Plazo de respuesta a las solicitudes de derechos (Ley 19.628 modificada por la Ley 21.719: 30 días corridos).
export const DIAS_PLAZO_DERECHOS = 30;

// Saldo mínimo exigido para cerrar la cuenta (CLP).
export const SALDO_PARA_CERRAR_CUENTA = 0;
// Regla oficial: tres intentos consecutivos bloquean temporalmente la cuenta.
export const MAXIMO_INTENTOS_FALLIDOS = 3;

export interface SeccionTerminos {
  id: string;
  titulo: string;
  clausulas: string[];
}

export interface DocumentoTerminos {
  version: string;
  vigenteDesde: string;
  titulo: string;
  introduccion: string;
  secciones: SeccionTerminos[];
}

export const TERMINOS: DocumentoTerminos = {
  version: VERSION_TERMINOS,
  vigenteDesde: VIGENTE_DESDE,
  titulo: 'Términos y Condiciones de Uso de Monify',
  introduccion:
    'Monify es una billetera digital que permite recibir, enviar y guardar dinero y solicitar líneas de crédito de consumo. '
    + 'Al marcar la casilla de aceptación declaras haber leído estos términos. Esa aceptación queda registrada en nuestra base de datos '
    + '(versión, fecha, canal y dispositivo) como evidencia de no repudio. Este documento es parte de un proyecto educativo y no reemplaza asesoría legal.',
  secciones: [
    {
      id: 'requisitos',
      titulo: '1. Requisitos para usar Monify',
      clausulas: [
        'Debes ser mayor de 18 años para contratar productos financieros. Solo se registra si eres mayor de edad, no tu fecha de nacimiento.',
        'Debes entregar información veraz y mantenerla actualizada. Monify puede exigir la verificación de identidad (KYC) a través de una entidad verificadora externa.',
        'Cada persona puede tener una sola cuenta asociada a su RUT.'
      ]
    },
    {
      id: 'cuenta',
      titulo: '2. Cuenta y credenciales',
      clausulas: [
        'Eres responsable de mantener la confidencialidad de tu contraseña. Monify solo almacena su hash y nunca puede recuperarla.',
        `Tras ${MAXIMO_INTENTOS_FALLIDOS} intentos fallidos consecutivos de inicio de sesión tu cuenta se bloquea temporalmente por seguridad y debe ser habilitada por un administrador.`,
        'Todo acceso y acción realizados con tus credenciales se presumen hechos por ti.'
      ]
    },
    {
      id: 'transacciones',
      titulo: '3. Billetera, tarjetas y transacciones',
      clausulas: [
        'Puedes asociar tarjetas de bancos habilitados. Monify no almacena el CVV ni la fecha de vencimiento: los valida el procesador de pagos externo.',
        'Cada transacción requiere que marques una casilla de confirmación. Una vez confirmada y ejecutada no puedes desconocerla; los reclamos se tratan por los canales de atención.',
        'El saldo de una tarjeta no puede quedar negativo: los cargos que superen el saldo disponible serán rechazados.'
      ]
    },
    {
      id: 'creditos',
      titulo: '4. Solicitud y evaluación de créditos',
      clausulas: [
        'Solicitar un crédito no garantiza su aprobación. Cada solicitud es evaluada por personal de riesgo a partir de tu score y tu comportamiento financiero.',
        'La evaluación de tu riesgo crediticio, incluida la consulta a una central de riesgo o buró de crédito, es una de las finalidades que aceptas al crear tu cuenta, porque el producto principal de Monify son las líneas de crédito.',
        'Los montos, tasas y cuotas se informan antes de confirmar la solicitud. La resolución (aprobada o rechazada) queda registrada junto con quien la tomó.'
      ]
    },
    {
      id: 'datos',
      titulo: '5. Protección de datos personales',
      clausulas: [
        'Aplicamos minimización: solo guardamos los datos necesarios. En lugar de tu fecha de nacimiento guardamos si eres mayor de edad; en lugar de tu renta exacta, un tramo; en lugar de tiempos exactos de mora o deuda, tramos.',
        'Tu nombre, RUT, celular y correo se almacenan seudonimizados: los datos originales viven cifrados en una bóveda separada de la base de datos principal.',
        'Los datos financieros se cifran con AES-256-GCM o RSA-OAEP y las contraseñas se almacenan con bcrypt.',
        'Tratamos tus datos solo para tres finalidades: (a) aceptar y ejecutar estos Términos y Condiciones, (b) el tratamiento de tus datos personales para operar la cuenta y cumplir obligaciones legales y (c) la evaluación crediticia. No usamos tus datos para publicidad ni para obtener valor agregado.',
        'Cada finalidad se acepta por separado y todas son obligatorias: la aceptación de una no implica la de otra. Cada consentimiento se registra con su finalidad, versión del texto, canal, dispositivo y fecha.',
        'Puedes revocar cualquier consentimiento en todo momento; la fecha y hora de la revocación quedan registradas. Mientras falte un consentimiento no podrás operar ni ver información de la cuenta, salvo el módulo de ejercicio de derechos. Al iniciar sesión se te pedirá otorgarlo nuevamente y, si lo rechazas, la sesión se cerrará.'
      ]
    },
    {
      id: 'auditoria',
      titulo: '6. Registro de actividad y auditoría',
      clausulas: [
        'Monify registra una bitácora de tus acciones: qué hiciste, cuándo, por qué canal (web, móvil o API) y desde qué dispositivo. No se almacena tu dirección IP.',
        'La bitácora es inalterable. El Auditor la consulta en modo de solo lectura; el Admin solo puede consultarla cuando existe una autorización vigente otorgada por un Auditor.',
        'El personal de Monify solo accede a tus datos financieros según su rol, por necesidad justificada o con tu autorización expresa, y cada acceso queda auditado.'
      ]
    },
    {
      id: 'cierre',
      titulo: '7. Cierre y eliminación de la cuenta',
      clausulas: [
        'Para eliminar tu cuenta el saldo de todas tus tarjetas y de tu billetera debe ser $0 (cero pesos). Debes retirar o transferir tus fondos antes de solicitarlo.',
        'No podrás eliminar tu cuenta si mantienes deudas registradas, créditos aprobados con saldo pendiente o solicitudes de crédito en curso.',
        'La eliminación se pide como una solicitud de supresión en el módulo de derechos y exige tu contraseña, un código de verificación y la casilla de confirmación.',
        'Al eliminar tu cuenta tus datos personales se anonimizan de forma irreversible: se destruye el vínculo con la bóveda de seudónimos. Los registros contables y la bitácora se conservan sin posibilidad de identificarte, por el plazo que exija la normativa financiera y tributaria aplicable.'
      ]
    },
    {
      id: 'derechos',
      titulo: '8. Ejercicio de tus derechos',
      clausulas: [
        'Conforme a la Ley N° 19.628 y la Ley N° 21.719 puedes ejercer tus derechos de acceso y portabilidad, rectificación y supresión desde el módulo "Mis derechos", disponible aunque hayas revocado un consentimiento.',
        'Cada solicitud sigue el flujo: recepción, verificación de identidad, evaluación, ejecución o respuesta fundamentada, y cierre. Registramos el estado y las fechas de cada etapa y te respondemos dentro de 30 días corridos.',
        'La verificación de identidad es proporcional al riesgo: la rectificación de datos de contacto exige tu contraseña; el acceso a una copia de tus datos, el cambio de correo y la supresión exigen además un código de un solo uso enviado a tu correo registrado. No pedimos documentos ni datos adicionales.',
        'La copia de tus datos se entrega en formato JSON estructurado, legible por personas y por máquinas, con una huella SHA-256 de integridad. Incluye solo tus datos: no contiene datos de terceros, seudónimos internos, firmas ni claves.',
        'La supresión puede rechazarse, con una respuesta fundamentada, mientras existan obligaciones pendientes (saldo, deudas, créditos o solicitudes en curso). Los registros contables y la bitácora se conservan anonimizados por la obligación legal de trazabilidad financiera.'
      ]
    },
    {
      id: 'responsabilidad',
      titulo: '9. Responsabilidad y terceros',
      clausulas: [
        'Monify se apoya en terceros (entidad verificadora de identidad, central de riesgo y procesador de pagos). No respondemos por errores atribuibles exclusivamente a ellos, pero facilitaremos su corrección.',
        'Monify no es responsable por el uso indebido de tus credenciales cuando no hayas dado aviso oportuno de su pérdida o filtración.'
      ]
    },
    {
      id: 'modificaciones',
      titulo: '10. Modificaciones y ley aplicable',
      clausulas: [
        'Podemos modificar estos términos. Cada versión tiene un número; si cambia, deberás aceptar la nueva versión para seguir operando.',
        'Estos términos se rigen por las leyes de la República de Chile.'
      ]
    }
  ]
};
