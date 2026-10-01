// Lógica de la pantalla "Carga de turno" del módulo de Turnero (Etapas T1-T3).
// T1: formulario base. T2: calculadora de fecha. T3: motor de búsqueda de huecos.
// Integración con turnero-motor.js para disponibilidad física pura.
// No depende de egresos.js, entregas.js ni de los turnero-*.js de T0: cada pantalla
// mantiene sus propias funciones, mismo criterio de independencia ya usado en el resto
// del sistema.

const SEDE_CIVIT_ID = "emilio-civit";
const SEDE_ENTRE_RIOS_ID = "entre-rios";
const SEDE_CIVIT_NOMBRE = "Emilio Civit";
const SEDE_ENTRE_RIOS_NOMBRE = "Entre Ríos";
// Etapa T8: direcciones para el comprobante de turno. Hardcodeadas, mismo criterio que
// el resto de las constantes de sede de acá arriba — el catálogo de sedes en Firestore
// no tiene campo de dirección, y con solo dos sedes fijas no vale la pena agregarlo.
const SEDE_CIVIT_DIRECCION = "Emilio Civit esq. Maza, San Rafael, Mza.";
const SEDE_ENTRE_RIOS_DIRECCION = "Entre Ríos 345, San Rafael, Mza.";
const MEDICO_OCCHIPINTI_ID = "occhipinti";

// Etapa 5C (a pedido de Elías): en "Reasignar" la sede es SIEMPRE la que ya tiene el
// turno — en los dos botones ("Buscar disponibilidad" y "Cargar a la fecha y hora
// exactas") y en todos sus caminos de guardado (sobreturnos, internado). Para cambiar
// de sede está "Modificar" (administrador). Antes, si el turno tenía sede automática
// (p. ej. Occhipinti), se volvía a calcular la sede desde cero con la regla de T0
// (Entre Ríos primero para obras sociales que no son POP) y el turno podía saltar de
// sede según el botón usado. En "+ nuevo turno" (modoReasignar falsy) no cambia nada.
function sedeIdManualParaMotor(datosBasicos) {
  if (datosBasicos.modoReasignar) return datosBasicos.sedeId;
  return datosBasicos.sedeAutomatica ? null : datosBasicos.sedeId;
}
function recalcularSedeOcchipinti(datosBasicos) {
  return datosBasicos.medicoId === MEDICO_OCCHIPINTI_ID && !datosBasicos.modoReasignar;
}
const ROLES_MEDICO_OTRO = ["administrador", "enfermeria"];
const PREMEDICACION_MINUTOS = 30;
// Etapa 1 del plan post-integración: 60 → 190. Hay tratamientos que se agendan a seis
// meses; el tope viejo obligaba a usar el modo "calendario" para cualquier cosa más allá
// de dos meses. Va alineado con TOPE_DIAS_ANTICIPACION para que los dos modos de elegir
// la fecha (número de días / calendario) lleguen exactamente igual de lejos.
const TOPE_DIAS_TURNO = 190;
// Etapa T12: tope de anticipación máxima para agendar un turno, acordado con Elías —
// aplica tanto al modo "calendario" (que hasta ahora no tenía ningún tope) como a los
// selectores de fecha de referencia de "Reasignar" y "Consulta de disponibilidad" en
// turnero-grilla.js. Solo del lado del cliente — ver nota en cargarTurnosExistentes()
// sobre por qué no se replica esto en firestore.rules.
//
// Etapa 1 del plan post-integración: 90 → 190, junto con TOPE_DIAS_TURNO (que pasó de 60
// a 190). Los dos modos de elegir fecha llegan ahora al mismo punto, y "Reasignar" y
// "Consulta de disponibilidad" de la grilla lo heredan vía fechaMaximaAnticipacionISO().
const TOPE_DIAS_ANTICIPACION = 190;
// Margen de la consulta de turnos existentes que usa el motor: TOPE_DIAS_ANTICIPACION
// (el máximo que puede pedir un usuario) MÁS el margen de búsqueda del motor
// (TOPE_DIAS_BUSQUEDA = 10 días), para no cortar justo en el límite si el motor empuja
// la fecha encontrada un poco más allá del máximo solicitado.
//
// Etapa 1 del plan post-integración: 100 → 200, forzado por el cambio de tope de arriba.
// NO es cosmético: todo lo que quede fuera de esta ventana el motor NO lo ve, y un
// sillón con un turno ya cargado que no se leyó se evalúa como libre. Con el tope en 190
// y la lectura en 100, los turnos entre el día 100 y el 200 se habrían pisado sin aviso.
// ATENCIÓN ETAPA 6 (revisión integral de consultas a Firestore): esto duplica la
// cantidad de documentos que lee cada apertura de "+ nuevo turno", "Reasignar" y
// "Consulta de disponibilidad". Es correcto pero caro, y es exactamente el tipo de
// consulta que hay que revisar en esa etapa — la salida razonable ahí es acotar la
// lectura a la ventana que el motor va a recorrer de verdad (fecha pedida ± unos pocos
// días) en vez de traer el rango completo desde hoy, que es lo que se hace hoy.
const MARGEN_LECTURA_TURNOS_DIAS = TOPE_DIAS_ANTICIPACION + 10;

function fechaMaximaAnticipacionISO() {
  return fechaISODesdeObjeto(fechaObjetoDesdeDiasHoy(TOPE_DIAS_ANTICIPACION));
}

// Catálogo de obras sociales (reutilizado de pacientes.js)
// Nota: OBRA_SOCIAL_POP ya está declarada en turnero-motor.js (se carga antes que este
// archivo y comparten el mismo scope global del navegador). No redeclarar acá.
const OBRAS_SOCIALES = [
  "ACLISA",
  "ACONCAGUA MEDICINA PREVENTIVA S.A",
  "ASOC MUTUAL 20 DE OCTUBRE",
  "PAPSI - ASOC. COOP HOSP CENTRAL PAPSI",
  "POP - ASOC. COOP HOSP CENTRAL PROG.ESPECIALES",
  "ASOCIACION MUTUAL SANCOR",
  "BOREAL - COBERTURA DE SALUD (BOREAL)",
  "PAMI - INSSJP - COIR SR",
  "CONFERENCIA EPISCOPAL ARGENTINA",
  "DAMSU-DPT.AS.ME.SO.U",
  "DASUTEN",
  "DELTA S.A.",
  "GALENO ARGENTINA S.A.",
  "GERENCIAMIENTO MEDICO SA",
  "HOSPITAL TEODORO SCHESTAKOW",
  "IOSFA",
  "ITER MEDICINA SA",
  "MEDICUS SA",
  "MEDIFE ASOCIACION CIVIL",
  "MUTUAL DEL PERSONAL DE AGUA Y ENERGIA",
  "OBRA SOCIAL DE PETROLEROS",
  "OBRA SOCIAL DEL PERSONAL DE FARMACIAS",
  "OBRA SOCIAL DEL PODER JUDICIAL DE LA NACION",
  "OBRA SOCIAL UNION PERS DE LA UNION PERS CIVIL DE LA NACION",
  "OMINT",
  "OSDE ORGANIZ DE SS DIRECTOS EMPRESARIOS",
  "OSDEPYM",
  "OSEP",
  "OSPELSYM",
  "OSPIA DELEG MENDOZA",
  "OSPJERA",
  "OSPSA - PERS.SANID.ARG",
  "OSSEG",
  "OSTES",
  "PARTICULAR",
  "POLICIA FED ARGENTINA",
  "PREVENCION SALUD SA",
  "PROFE - MENDOZA",
  "ROI SA",
  "SER SALUD PRESTACIONES SA",
  "SISTEMA DE COBERTURA INT. DE SALUD SA",
  "SUMA SALUD",
  "SWISS MEDICAL SA",
  "VISITAR SRL"
];

let usuarioActualCarga = null;
let datosUsuarioActualCarga = null;
let rolActualCarga = null;

let pacientesCacheCarga = [];
let medicosCacheCarga = [];
let protocolosCacheCarga = [];
let sedesCacheCarga = [];
let cuposCacheCarga = []; // T4: array de docs de turneroCupos
let bloqueosCacheCarga = []; // T9: array de docs de turneroBloqueos (activos)

let pacienteSeleccionadoCarga = null;
let protocolosSeleccionados = {}; // filaId -> { protocoloId, nombre, duracionMinutos }
let contadorFilasProtocolo = 0;
let guardandoTurno = false;
let temporizadorBusquedaDocumentoCarga = null;
let buscandoHuecos = false;

// Etapa T2: modo de carga de la fecha del turno.
let modoFechaTurno = "dias";

// Etapa T3: estado de la búsqueda y selección de hueco
let turnosExistentes = []; // array de turnos ya cargados (para el motor)
let ultimaBusquedaHuecos = null; // resultado del último motor.buscarHuecos()
let huecoSeleccionado = null; // el hueco elegido por el usuario antes de guardar

// --- Cache de pacientes en localStorage ---
const CACHE_PACIENTES_KEY = "cache_pacientes_activos";

function fechaLocalHoy() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Etapa 5C (P2): la hora actual para el motor — hoy y el minuto del día (sin segundos), del
// reloj de la PC (el mismo que ya usa calcularTurnosNoReacomodablesIds). El motor no
// ofrece ningún horario de hoy anterior a este minuto (ver inicioMinimoPorAhora en
// turnero-motor.js). El arrastre semanal NO lo usa, a propósito (decisión de Elías).
function ahoraParaMotor() {
  const d = new Date();
  return { fechaISO: fechaLocalHoy(), minuto: d.getHours() * 60 + d.getMinutes() };
}

// Ronda "reacomodo automático de sillones": criterio temporal para turnosNoReacomodablesIds
// (confirmado con Elías, b.3) — protege los turnos de HOY cuyo horarioFin ya pasó respecto
// de la hora actual. No hace falta ningún campo nuevo (hoy el sistema no tiene noción de
// "atendido"): un turno en una fecha futura nunca puede tener el horarioFin ya pasado, así
// que este cálculo solo protege algo cuando la fecha evaluada por el motor es HOY — se
// puede pasar igual en cualquier búsqueda (con o sin reacomodo multi-día) sin necesidad de
// recalcularlo por día.
//
// Etapa 5C (auditoría del motor, decisión de Elías): además de los que ya terminaron, se
// protegen (a) los de HOY que ya EMPEZARON aunque no hayan terminado — el paciente está
// sentado en ese sillón ahora mismo, moverlo "en papel" no tiene sentido — y (b) los
// marcados como presentes (turno.presente === true), en cualquier fecha: el paciente ya
// llegó, su sillón deja de ser intercambiable. Antes solo se protegía horarioFin < ahora.
// También (c) los cargados con horario manual (turno.horarioManual === true).
function calcularTurnosNoReacomodablesIds() {
  const hoyISO = fechaLocalHoy();
  const ahora = new Date();
  const minutoActual = ahora.getHours() * 60 + ahora.getMinutes();
  return turnosExistentes
    .filter((t) =>
      t.presente === true ||
      t.horarioManual === true || // Etapa 5C (decisión de Elías): cargado con horario manual, "se dio así por algo"
      (t.fecha === hoyISO && typeof t.horarioInicio === "string" && minutoDesdeString(t.horarioInicio) <= minutoActual)
    )
    .map((t) => t.id);
}

// --- Cálculo de fecha a partir de "en cuántos días" (Etapa T2) ---

function fechaObjetoDesdeDiasHoy(dias) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  return d;
}

function fechaISODesdeObjeto(fecha) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

function formatearFechaLegible(fecha) {
  const formateador = new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  const texto = formateador.format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function leerDiasTurnoValidos() {
  const valor = document.getElementById("campo-dias-turno").value;
  if (valor === "") return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > TOPE_DIAS_TURNO) return null;
  return numero;
}

function actualizarFechaCalculada() {
  const cont = document.getElementById("fecha-calculada-info");
  const badge = document.getElementById("badge-fecha-calculada");
  const dias = leerDiasTurnoValidos();

  if (dias === null) {
    cont.style.display = "none";
    return;
  }

  const fecha = fechaObjetoDesdeDiasHoy(dias);
  badge.textContent = `Fecha calculada: ${formatearFechaLegible(fecha)}`;
  cont.style.display = "block";
}

function alternarModoFecha() {
  modoFechaTurno = modoFechaTurno === "dias" ? "calendario" : "dias";
  renderizarModoFecha();
}

function usarTurnoHoy() {
  document.getElementById("campo-dias-turno").value = "0";
  actualizarFechaCalculada();
}

function renderizarModoFecha() {
  const bloqueDias = document.getElementById("bloque-dias-turno");
  const bloqueManual = document.getElementById("bloque-fecha-manual");

  if (modoFechaTurno === "dias") {
    bloqueDias.style.display = "block";
    bloqueManual.style.display = "none";
    document.getElementById("campo-fecha").value = "";
  } else {
    bloqueDias.style.display = "none";
    bloqueManual.style.display = "block";
    document.getElementById("campo-dias-turno").value = "";
    document.getElementById("fecha-calculada-info").style.display = "none";
  }
}

function leerCachePacientes() {
  try {
    const crudo = localStorage.getItem(CACHE_PACIENTES_KEY);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (datos.fecha !== fechaLocalHoy()) return null;
    return datos.pacientes;
  } catch (error) {
    console.warn("No se pudo leer el cache de pacientes:", error);
    return null;
  }
}

function guardarCachePacientes(pacientes) {
  try {
    localStorage.setItem(CACHE_PACIENTES_KEY, JSON.stringify({ fecha: fechaLocalHoy(), pacientes }));
  } catch (error) {
    console.warn("No se pudo guardar el cache de pacientes:", error);
  }
}

function agregarPacienteACache(paciente) {
  try {
    const actuales = leerCachePacientes() || [];
    if (actuales.some((p) => p.id === paciente.id)) return;
    actuales.push(paciente);
    guardarCachePacientes(actuales);
  } catch (error) {
    console.warn("No se pudo actualizar el cache de pacientes:", error);
  }
}

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function capitalizarPalabras(texto) {
  return (texto || "")
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase())
    .join(" ");
}

function soloDigitos(texto) {
  return (texto || "").toString().replace(/\D/g, "");
}

function idPaciente(tipoDocumento, numeroDocumento) {
  return `${tipoDocumento}-${numeroDocumento}`;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// --- Comprobante de turno (Etapa T8) ---
// Mismo mecanismo de número correlativo que ya usa entregas.js para Medicación, pero en
// un documento de contador propio ("contadores/comprobantesTurno") para no compartir la
// serie con los comprobantes de medicación, y con un prefijo "T-" para que no se
// confundan a simple vista al reimprimir. El número real se lee DESPUÉS del commit del
// batch que incrementa el contador — FieldValue.increment() recién se resuelve del lado
// del servidor, no se puede conocer el valor final antes de eso.
function formatearNumeroComprobanteTurno(anio, numero) {
  return `T-${anio}-${String(numero).padStart(4, "0")}`;
}

// Abre el comprobante en ventana nueva e imprime automáticamente (mismo patrón que
// abrirComprobante() en entregas.js). La llaman tanto guardarTurnoConHueco() acá abajo
// (alta nueva) como anularYCrearTurnoGrilla() en turnero-grilla.js (reasignar/modificar)
// — turnero-carga.js se carga en agenda.html y en carga.html, así que queda disponible
// en las dos páginas sin duplicarla.
function abrirComprobanteTurno(turnoId) {
  const base = window.location.href.replace(/\/[^/]*$/, "");
  const url = `${base}/comprobante-turno.html?id=${turnoId}`;
  const ventana = window.open(url, "_blank", "width=800,height=600");
  if (!ventana) {
    mostrarMensajeGeneral(
      `Turno guardado. El navegador bloqueó la ventana del comprobante — ` +
      `<a href="${url}" target="_blank">hacé clic acá para abrirlo</a>.`,
      "exito"
    );
  }
}

function mostrarMensajeGeneral(texto, tipo) {
  const el = document.getElementById("mensaje-general");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function iniciarCargaTurno(user, datosUsuario) {
  usuarioActualCarga = user;
  datosUsuarioActualCarga = datosUsuario;
  rolActualCarga = datosUsuario.rol;

  const campoBuscarPaciente = document.getElementById("campo-buscar-paciente");
  campoBuscarPaciente.addEventListener("input", (e) => buscarPaciente(e.target.value));
  document.getElementById("alta-numero-documento").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value).slice(0, 9);
  });
  document.getElementById("campo-medico").addEventListener("change", actualizarBloqueMedico);
  document.getElementById("campo-medico").addEventListener("change", actualizarVisibilidadCamposEspeciales);
  document.getElementById("campo-ciclo").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value);
  });
  document.getElementById("campo-sesion").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value);
  });
  document.getElementById("campo-premedicacion").addEventListener("change", actualizarResumenDuracion);
  document.getElementById("campo-dias-turno").addEventListener("input", actualizarFechaCalculada);
  document.getElementById("campo-dias-turno").max = String(TOPE_DIAS_TURNO);
  document.getElementById("campo-fecha").min = fechaLocalHoy();
  document.getElementById("campo-fecha").max = fechaMaximaAnticipacionISO();

  campoBuscarPaciente.disabled = true;
  campoBuscarPaciente.placeholder = "Cargando listado de pacientes…";
  cargarPacientesCarga().then(() => {
    campoBuscarPaciente.disabled = false;
    campoBuscarPaciente.placeholder = "Buscar por apellido, nombre o documento";
  });

  await Promise.all([cargarMedicosCarga(), cargarProtocolosCarga(), cargarSedesCarga(), cargarTurnosExistentes(), cargarCuposCarga(), cargarBloqueosCarga()]);
  poblarSelectMedico();
  poblarSelectSedeManual();
  agregarFilaProtocolo();
  actualizarVisibilidadCamposEspeciales();
}

async function cargarPacientesCarga() {
  const enCache = leerCachePacientes();
  if (enCache) {
    pacientesCacheCarga = enCache;
    return;
  }
  const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
  pacientesCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  guardarCachePacientes(pacientesCacheCarga);
}

async function cargarMedicosCarga() {
  const snapshot = await db.collection("turneroMedicos").get();
  medicosCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  medicosCacheCarga.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

async function cargarProtocolosCarga() {
  const snapshot = await db.collection("turneroProtocolos").get();
  protocolosCacheCarga = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((p) => p.activo !== false)
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

async function cargarSedesCarga() {
  const snapshot = await db.collection("turneroSedes").get();
  sedesCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  sedesCacheCarga.sort((a, b) => (a.id === SEDE_CIVIT_ID ? -1 : 1));
}

// Etapa T4: cargar cupos por porcentaje para que el motor pueda aplicar el techo por médico
async function cargarCuposCarga() {
  try {
    const snapshot = await db.collection("turneroCupos").get();
    cuposCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn("No se pudieron cargar los cupos para el motor:", error);
    cuposCacheCarga = [];
  }
}

// Etapa T9: cargar bloqueos vigentes para que el motor descuente sillones/franjas/días
// bloqueados al calcular huecos. Mismo criterio defensivo que cargarCuposCarga(): si
// falla, sigue sin bloqueos en vez de romper la carga de turnos.
async function cargarBloqueosCarga() {
  try {
    const snapshot = await db.collection("turneroBloqueos").where("activo", "==", true).get();
    bloqueosCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn("No se pudieron cargar los bloqueos para el motor:", error);
    bloqueosCacheCarga = [];
  }
}

// Etapa T3: cargar turnos existentes para que el motor valide no superposición
// Etapa T12: antes traía TODOS los turnos activos de la historia completa del sistema,
// sin ningún límite de fecha — cada apertura de "+ Nuevo turno" leía más y más
// documentos a medida que se acumulaba historial real. El motor nunca necesita turnos
// fuera de esta ventana (nunca busca en el pasado, y el máximo que puede buscar hacia
// adelante es TOPE_DIAS_ANTICIPACION + el margen de búsqueda del motor), así que
// acotar acá no cambia ningún resultado, solo el costo de leerlo.
async function cargarTurnosExistentes() {
  try {
    const desde = fechaISODesdeObjeto(fechaObjetoDesdeDiasHoy(-1));
    const hasta = fechaISODesdeObjeto(fechaObjetoDesdeDiasHoy(MARGEN_LECTURA_TURNOS_DIAS));
    const snapshot = await db.collection("turnos")
      .where("estado", "==", "activo")
      .where("fecha", ">=", desde)
      .where("fecha", "<=", hasta)
      .get();
    turnosExistentes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.warn("No se pudieron cargar los turnos existentes para el motor:", error);
    turnosExistentes = [];
  }
}

// --- Búsqueda y alta rápida de paciente ---

function buscarPaciente(texto) {
  const cont = document.getElementById("resultados-busqueda-paciente");
  const sinResultados = document.getElementById("sin-resultados");
  document.getElementById("bloque-alta-rapida").style.display = "none";
  cont.innerHTML = "";

  if (!texto.trim()) {
    sinResultados.style.display = "none";
    return;
  }

  const norm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const encontrados = pacientesCacheCarga.filter((p) => {
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  if (encontrados.length === 0) {
    sinResultados.style.display = "block";
    buscarPacientePorDocumentoEnSegundoPlano(digitos);
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPaciente(p.id));
    cont.appendChild(div);
  });
}

function buscarPacientePorDocumentoEnSegundoPlano(digitos) {
  clearTimeout(temporizadorBusquedaDocumentoCarga);
  if (digitos.length < 7 || digitos.length > 9) return;

  temporizadorBusquedaDocumentoCarga = setTimeout(async () => {
    const digitosActuales = soloDigitos(document.getElementById("campo-buscar-paciente").value);
    if (digitosActuales !== digitos) return;

    try {
      const snapshot = await db.collection("pacientes")
        .where("numeroDocumento", "==", digitos)
        .where("activo", "==", true)
        .get();
      if (snapshot.empty) return;

      snapshot.docs.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        if (!pacientesCacheCarga.some((existente) => existente.id === p.id)) {
          pacientesCacheCarga.push(p);
          agregarPacienteACache(p);
        }
      });

      buscarPaciente(document.getElementById("campo-buscar-paciente").value);
    } catch (error) {
      console.error("Error al buscar paciente por documento:", error);
    }
  }, 500);
}

function actualizarListadoPacientes() {
  const boton = document.getElementById("boton-actualizar-pacientes");
  if (boton) { boton.disabled = true; boton.textContent = "actualizando..."; }

  db.collection("pacientes").where("activo", "==", true).get()
    .then((snapshot) => {
      pacientesCacheCarga = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      guardarCachePacientes(pacientesCacheCarga);
      buscarPaciente(document.getElementById("campo-buscar-paciente").value);
    })
    .catch((error) => console.error("Error al actualizar el listado de pacientes:", error))
    .finally(() => {
      if (boton) { boton.disabled = false; boton.textContent = "actualizar listado"; }
    });
}

function seleccionarPaciente(id) {
  pacienteSeleccionadoCarga = pacientesCacheCarga.find((p) => p.id === id);
  document.getElementById("campo-buscar-paciente").value = "";
  document.getElementById("resultados-busqueda-paciente").innerHTML = "";
  document.getElementById("sin-resultados").style.display = "none";
  document.getElementById("bloque-alta-rapida").style.display = "none";
  renderizarPacienteSeleccionado();
  // Si ya había un médico elegido (por ejemplo Occhipinti), refrescar el bloque
  // porque la sede automática depende de la obra social del paciente recién elegido.
  if (document.getElementById("campo-medico").value) {
    actualizarBloqueMedico();
  }
}

function renderizarPacienteSeleccionado() {
  const cont = document.getElementById("paciente-seleccionado");
  const busqueda = document.getElementById("bloque-busqueda-paciente");
  if (!pacienteSeleccionadoCarga) {
    cont.style.display = "none";
    busqueda.style.display = "block";
    return;
  }
  cont.style.display = "flex";
  busqueda.style.display = "none";
  const obraSocialTexto = pacienteSeleccionadoCarga.obraSocial
    ? escaparHtml(pacienteSeleccionadoCarga.obraSocial)
    : "sin especificar";
  document.getElementById("texto-paciente-seleccionado").innerHTML =
    `<strong>${escaparHtml(pacienteSeleccionadoCarga.apellido)}, ${escaparHtml(pacienteSeleccionadoCarga.nombre)}</strong> · ${pacienteSeleccionadoCarga.tipoDocumento} ${pacienteSeleccionadoCarga.numeroDocumento} · Obra social: ${obraSocialTexto}`;
}

function quitarPacienteSeleccionado() {
  pacienteSeleccionadoCarga = null;
  renderizarPacienteSeleccionado();
  if (document.getElementById("campo-medico").value) {
    actualizarBloqueMedico();
  }
}

function mostrarAltaRapida() {
  document.getElementById("bloque-alta-rapida").style.display = "block";
  document.getElementById("mensaje-alta-rapida").style.display = "none";
  
  // Poblar select de obra social si aún no está poblado
  const selectOS = document.getElementById("alta-obra-social");
  if (selectOS.children.length === 1) { // Solo el <option value="">Elegir obra social</option>
    OBRAS_SOCIALES.forEach((os) => {
      const option = document.createElement("option");
      option.value = os;
      option.textContent = os;
      selectOS.appendChild(option);
    });
  }
}

async function altaRapidaPaciente() {
  const tipoDocumento = document.getElementById("alta-tipo-documento").value;
  const numeroDocumento = soloDigitos(document.getElementById("alta-numero-documento").value);
  const nombre = capitalizarPalabras(document.getElementById("alta-nombre").value);
  const apellido = capitalizarPalabras(document.getElementById("alta-apellido").value);
  const obraSocial = document.getElementById("alta-obra-social").value;
  const mensajeEl = document.getElementById("mensaje-alta-rapida");

  const mostrarError = (texto) => {
    mensajeEl.textContent = texto;
    mensajeEl.style.display = "block";
  };

  if (!nombre || !apellido) {
    mostrarError("Nombre y apellido son obligatorios.");
    return;
  }
  if (numeroDocumento.length < 7 || numeroDocumento.length > 9) {
    mostrarError("El número de documento debe tener entre 7 y 9 dígitos.");
    return;
  }
  if (!obraSocial) {
    mostrarError("La obra social es obligatoria.");
    return;
  }

  const id = idPaciente(tipoDocumento, numeroDocumento);

  if (pacientesCacheCarga.some((p) => p.id === id)) {
    mostrarError("Este paciente ya está registrado.");
    return;
  }

  try {
    await db.collection("pacientes").doc(id).set({
      tipoDocumento,
      numeroDocumento,
      nombre,
      apellido,
      obraSocial: obraSocial,
      activo: true
    });

    const pacienteNuevo = { id, tipoDocumento, numeroDocumento, nombre, apellido, obraSocial, activo: true };
    pacientesCacheCarga.push(pacienteNuevo);
    agregarPacienteACache(pacienteNuevo);
    seleccionarPaciente(id);

    document.getElementById("bloque-alta-rapida").style.display = "none";
    document.getElementById("alta-tipo-documento").value = "DNI";
    document.getElementById("alta-numero-documento").value = "";
    document.getElementById("alta-nombre").value = "";
    document.getElementById("alta-apellido").value = "";
    document.getElementById("alta-obra-social").value = "";
  } catch (error) {
    if (error.code === "permission-denied") {
      mostrarError("No tenés permisos para crear pacientes.");
    } else {
      mostrarError("No se pudo guardar el paciente. Reintentá en unos segundos.");
      console.error("Error:", error);
    }
  }
}

// --- Selección de médico y sede ---

function poblarSelectMedico() {
  const select = document.getElementById("campo-medico");
  select.innerHTML = '<option value="">Elegir médico</option>';

  if (rolActualCarga === "medico") {
    // Etapa T4: un médico solo puede cargarse turnos a sí mismo — el selector queda fijo
    // en su propio médico, sin poder elegir otro (reforzado también en firestore.rules,
    // por si se intenta forzar la escritura igual). Depende de que el documento del
    // usuario en Firestore tenga el campo "medicoId" cargado a mano (mismo id que usa
    // turneroMedicos, ej. "occhipinti") — si no lo tiene, se bloquea la carga entera en
    // vez de dejarlo elegir cualquier médico.
    const medicoPropio = medicosCacheCarga.find((m) => m.id === datosUsuarioActualCarga.medicoId);
    if (!medicoPropio) {
      mostrarMensajeGeneral(
        "Tu usuario todavía no tiene un médico asociado. Pedile al administrador que lo configure antes de poder cargar turnos.",
        "error"
      );
      select.disabled = true;
      document.getElementById("boton-guardar-turno").disabled = true;
      return;
    }
    // Permiso nuevo: el administrador puede deshabilitar a un médico puntual para que
    // no cargue ni modifique turnos con su propio usuario (ver turnero-medicos.js).
    // Ausente en el documento = habilitado, no hace falta migrar a los ya cargados.
    if (medicoPropio.habilitadoParaCargar === false) {
      mostrarMensajeGeneral(
        "Tu usuario no tiene permiso para cargar turnos en este momento. Consultá con el administrador.",
        "error"
      );
      select.disabled = true;
      document.getElementById("boton-guardar-turno").disabled = true;
      return;
    }
    const option = document.createElement("option");
    option.value = medicoPropio.id;
    option.textContent = medicoPropio.nombre;
    select.appendChild(option);
    select.value = medicoPropio.id;
    select.disabled = true;
    actualizarBloqueMedico();
    return;
  }

  medicosCacheCarga.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = m.nombre;
    select.appendChild(option);
  });

  const optionOtro = document.createElement("option");
  optionOtro.value = "otro";
  optionOtro.textContent = "Otro";
  select.appendChild(optionOtro);
}

function poblarSelectSedeManual() {
  const select = document.getElementById("campo-sede-manual");
  select.innerHTML = '<option value="">Elegir sede</option>';

  sedesCacheCarga.forEach((s) => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.nombre;
    select.appendChild(option);
  });
}

// Etapa 1 del plan post-integración. Lee el flag de excepción temporal del propio doc de
// Occhipinti, del caché de médicos que ya se carga para el motor — sin consulta extra.
// El motor decide por su cuenta con el mismo campo (determinarSedesABuscar); esto es
// solo para el cartel informativo de la pantalla de carga, no duplica la decisión.
// OJO: el caché se llena al abrir la pantalla. Si el administrador prende o apaga la
// excepción mientras alguien tiene la agenda abierta, esa pantalla sigue con el valor
// viejo hasta recargar — mismo comportamiento que el caché de bloqueos (punto 5 de la
// Etapa 2 del plan), aceptado explícitamente para esta etapa.
function occhipintiConExcepcionDirectaCivit() {
  const doc = medicosCacheCarga.find((m) => m.id === MEDICO_OCCHIPINTI_ID);
  return !!(doc && doc.excepcionSedeDirectaCivit === true);
}

function resolverSedesPosiblesMedico(medicoDoc) {
  if (!medicoDoc) return [];
  return sedesCacheCarga.filter((sede) => {
    const diasDelMedico = medicoDoc.diasPorSede && medicoDoc.diasPorSede[sede.nombre];
    return diasDelMedico && diasDelMedico.length > 0;
  });
}

function actualizarBloqueMedico() {
  const medicoValor = document.getElementById("campo-medico").value;
  const bloqueMedicoOtro = document.getElementById("bloque-medico-otro");
  const sedeAutomaticaInfo = document.getElementById("sede-automatica-info");
  const selectSedeManual = document.getElementById("campo-sede-manual");
  const avisoSedeIndefinida = document.getElementById("aviso-sede-indefinida");
  const badgeSedeAutomatica = document.getElementById("badge-sede-automatica");

  bloqueMedicoOtro.style.display = "none";
  selectSedeManual.style.display = "none";
  avisoSedeIndefinida.style.display = "none";
  sedeAutomaticaInfo.style.display = "none";
  selectSedeManual.value = "";
  document.getElementById("campo-medico-otro-nombre").value = "";

  if (!medicoValor) return;

  const esMedicoOtro = medicoValor === "otro";

  if (esMedicoOtro) {
    bloqueMedicoOtro.style.display = "block";
    selectSedeManual.style.display = "block";
    return;
  }

  const medico = medicosCacheCarga.find((m) => m.id === medicoValor);
  if (!medico) return;

  if (medicoValor === MEDICO_OCCHIPINTI_ID) {
    // Occhipinti: la sede la determina el sistema según la obra social del paciente
    // (Handoff_etapa_T0.md, decisión 4). Nunca se elige a mano.
    sedeAutomaticaInfo.style.display = "block";
    const excepcionDirectaCivit = occhipintiConExcepcionDirectaCivit();
    if (!pacienteSeleccionadoCarga) {
      badgeSedeAutomatica.textContent = excepcionDirectaCivit
        ? "Emilio Civit (excepción temporal activa)"
        : "Se determina según la obra social del paciente";
    } else if (pacienteSeleccionadoCarga.obraSocial === OBRA_SOCIAL_POP) {
      badgeSedeAutomatica.textContent = "Emilio Civit (por obra social POP)";
    } else if (excepcionDirectaCivit) {
      // La excepción la prende y apaga el administrador desde la pantalla Médicos. Se
      // avisa acá para que quien carga vea que está operando con ella puesta y no quede
      // prendida por olvido — ver determinarSedesABuscar() en turnero-motor.js.
      badgeSedeAutomatica.textContent = "Emilio Civit (excepción temporal activa)";
    } else {
      badgeSedeAutomatica.textContent = "Entre Ríos (o Emilio Civit si no hay lugar)";
    }
    return;
  }

  const sedesPosibles = resolverSedesPosiblesMedico(medico);

  if (sedesPosibles.length === 0) {
    avisoSedeIndefinida.style.display = "block";
    selectSedeManual.style.display = "block";
  } else if (sedesPosibles.length === 1) {
    sedeAutomaticaInfo.style.display = "block";
    badgeSedeAutomatica.textContent = sedesPosibles[0].nombre;
  } else {
    selectSedeManual.style.display = "block";
  }
}

// --- Protocolos ---

function agregarFilaProtocolo() {
  const id = `fila-protocolo-${contadorFilasProtocolo++}`;
  const lista = document.getElementById("lista-protocolos");

  const fila = document.createElement("div");
  fila.id = id;
  fila.className = "fila-medicamento";

  fila.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>protocolo ${contadorFilasProtocolo}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="campo" style="margin-bottom:0;">
      <label>Nombre del protocolo</label>
      <input type="text" class="inp-buscar-protocolo" placeholder="Escribí el nombre o parte del nombre" />
      <div class="resultados-protocolo"></div>
    </div>
  `;

  fila.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaProtocolo(id));
  fila.querySelector(".inp-buscar-protocolo").addEventListener("input", (e) => actualizarBuscadorProtocolo(id, e.target.value));

  lista.appendChild(fila);

  protocolosSeleccionados[id] = null;
}

function actualizarBuscadorProtocolo(filaId, texto) {
  const resultados = document.querySelector(`#${filaId} .resultados-protocolo`);
  resultados.innerHTML = "";

  if (!texto.trim()) {
    protocolosSeleccionados[filaId] = null;
    actualizarResumenDuracion();
    return;
  }

  const norm = normalizarTexto(texto);
  const encontrados = protocolosCacheCarga.filter((p) =>
    normalizarTexto(p.nombre).includes(norm)
  );

  // Etapa 1 del plan post-integración: antes se cortaba en los primeros 5 resultados y
  // el resto era directamente inalcanzable (protocolos con más de 10 variantes con el
  // mismo nombre base no se podían elegir desde acá). Ahora se pintan TODAS las
  // coincidencias dentro de un contenedor con alto máximo de ~5 filas y scroll real.
  // El contenedor scrolleable es interno a propósito: el bloque de "agregar protocolo
  // nuevo" de abajo queda como hermano, fuera del scroll, siempre visible al pie.
  const listaScroll = document.createElement("div");
  listaScroll.className = "lista-resultados-protocolo";

  encontrados.forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.nombre)} (${p.duracionMinutos} min)</span>
      <button type="button" class="enlace-accion">usar</button>`;
    div.querySelector("button").addEventListener("click", () => {
      protocolosSeleccionados[filaId] = {
        protocoloId: p.id,
        nombre: p.nombre,
        duracionMinutos: p.duracionMinutos
      };
      const inputBusqueda = document.querySelector(`#${filaId} input`);
      inputBusqueda.value = p.nombre;
      resultados.innerHTML = "";
      actualizarResumenDuracion();
    });
    listaScroll.appendChild(div);
  });

  if (encontrados.length > 0) {
    resultados.appendChild(listaScroll);
  } else {
    const vacio = document.createElement("div");
    vacio.className = "sin-resultados-protocolo";
    vacio.textContent = "No hay ningún protocolo cargado con ese nombre.";
    resultados.appendChild(vacio);
  }

  // Etapa T12: enfermería y administrador pueden dar de alta un protocolo nuevo al
  // vuelo si no está en el catálogo — apartamiento del punto 16 del alcance (catálogos
  // exclusivos de administrador) acordado explícitamente con Elías, mismo criterio que
  // ya usa "Otro" médico derivante. Médico no ve esta opción acá, ni la tiene habilitada
  // del lado del servidor (ver protocoloValido() en firestore.rules). Queda en el
  // catálogo general (turneroProtocolos), disponible para cualquier turno futuro — no es
  // algo puntual de este turno. No toca el buscador de protocolo de "Modificar turno" ni
  // el de "Consulta de disponibilidad" en turnero-grilla.js, que quedan sin cambios.
  if (rolActualCarga === "administrador" || rolActualCarga === "enfermeria") {
    resultados.appendChild(construirBloqueAgregarProtocoloNuevo(filaId, texto.trim()));
  }
}

// Etapa 1 del plan post-integración: este bloque antes venía siempre desplegado (con su
// campo de duración a la vista) y quedaba pegado abajo de los resultados. Ahora arranca
// colapsado como un botón y se despliega recién al tocarlo — cuando la búsqueda no
// encuentra nada es lo único que queda en pantalla, así que se lee naturalmente como
// "no está: agregalo". Sigue disponible también cuando SÍ hay coincidencias (hace falta:
// podés tener diez variantes de un protocolo y que ninguna sea la que buscás).
function construirBloqueAgregarProtocoloNuevo(filaId, nombrePropuesto) {
  const contenedor = document.createElement("div");
  contenedor.className = "bloque-protocolo-nuevo";

  const botonDesplegar = document.createElement("button");
  botonDesplegar.type = "button";
  botonDesplegar.className = "boton-agregar-protocolo-nuevo";
  botonDesplegar.textContent = `+ Agregar "${nombrePropuesto}" como protocolo nuevo`;

  const bloque = construirFormularioProtocoloNuevo(filaId, nombrePropuesto);
  bloque.style.display = "none";

  botonDesplegar.addEventListener("click", () => {
    botonDesplegar.style.display = "none";
    bloque.style.display = "flex";
    const inputDuracion = bloque.querySelector("input");
    if (inputDuracion) inputDuracion.focus();
  });

  contenedor.appendChild(botonDesplegar);
  contenedor.appendChild(bloque);
  return contenedor;
}

function construirFormularioProtocoloNuevo(filaId, nombrePropuesto) {
  const bloque = document.createElement("div");
  bloque.className = "resultado-busqueda";
  bloque.style.cssText = "flex-direction:column;align-items:stretch;gap:6px;";

  const etiqueta = document.createElement("span");
  etiqueta.style.cssText = "font-size:13px;color:var(--color-muted);";
  etiqueta.textContent = `Agregar "${nombrePropuesto}" al catálogo de protocolos:`;
  bloque.appendChild(etiqueta);

  const filaControles = document.createElement("div");
  filaControles.style.cssText = "display:flex;gap:8px;align-items:center;";

  const inputDuracion = document.createElement("input");
  inputDuracion.type = "number";
  inputDuracion.min = "1";
  inputDuracion.placeholder = "Duración (min)";
  inputDuracion.style.cssText = "width:120px;";

  const botonAgregar = document.createElement("button");
  botonAgregar.type = "button";
  botonAgregar.className = "enlace-accion";
  botonAgregar.textContent = "Agregar protocolo nuevo";

  const mensaje = document.createElement("span");
  mensaje.style.cssText = "font-size:12px;";

  botonAgregar.addEventListener("click", () =>
    agregarProtocoloNuevoCarga(filaId, nombrePropuesto, inputDuracion, botonAgregar, mensaje)
  );

  filaControles.appendChild(inputDuracion);
  filaControles.appendChild(botonAgregar);
  bloque.appendChild(filaControles);
  bloque.appendChild(mensaje);

  return bloque;
}

async function agregarProtocoloNuevoCarga(filaId, nombre, inputDuracion, boton, mensaje) {
  const duracionMinutos = parseInt(inputDuracion.value, 10);
  mensaje.textContent = "";
  mensaje.style.color = "";

  if (!duracionMinutos || duracionMinutos <= 0) {
    mensaje.textContent = "Ingresá una duración válida, mayor a cero.";
    mensaje.style.color = "var(--color-danger)";
    return;
  }

  const clave = normalizarTexto(nombre);
  const yaExiste = protocolosCacheCarga.some(
    (p) => p.activo !== false && normalizarTexto(p.nombre) === clave
  );
  if (yaExiste) {
    mensaje.textContent = "Ese protocolo ya está en el catálogo — buscalo de nuevo, puede que aparezca con otra grafía.";
    mensaje.style.color = "var(--color-danger)";
    return;
  }

  boton.disabled = true;
  try {
    const nuevoDoc = {
      nombre,
      duracionMinutos,
      activo: true,
      claveNormalizada: clave,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection("turneroProtocolos").add(nuevoDoc);

    // Se agrega a la caché local (con valores planos, sin el sentinel de
    // serverTimestamp) para que quede disponible sin recargar la página.
    protocolosCacheCarga.push({
      id: ref.id,
      nombre,
      duracionMinutos,
      activo: true,
      claveNormalizada: clave
    });

    protocolosSeleccionados[filaId] = {
      protocoloId: ref.id,
      nombre,
      duracionMinutos
    };
    const inputBusqueda = document.querySelector(`#${filaId} input.inp-buscar-protocolo`);
    if (inputBusqueda) inputBusqueda.value = nombre;
    document.querySelector(`#${filaId} .resultados-protocolo`).innerHTML = "";
    actualizarResumenDuracion();
  } catch (error) {
    console.error("Error al crear protocolo nuevo:", error);
    mensaje.textContent = "No se pudo guardar el protocolo. Reintentá en unos segundos.";
    mensaje.style.color = "var(--color-danger)";
    boton.disabled = false;
  }
}

function quitarFilaProtocolo(filaId) {
  const filas = document.querySelectorAll(".fila-medicamento");
  if (filas.length <= 1) {
    alert("Tiene que quedar al menos un protocolo cargado.");
    return;
  }
  delete protocolosSeleccionados[filaId];
  document.getElementById(filaId).remove();
  actualizarResumenDuracion();
}

function actualizarResumenDuracion() {
  const sumaProtocolos = Object.values(protocolosSeleccionados)
    .filter(p => p !== null)
    .reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0);
  const premedicacion = document.getElementById("campo-premedicacion").checked;
  const total = sumaProtocolos + (premedicacion ? PREMEDICACION_MINUTOS : 0);

  const detalle = premedicacion
    ? `${sumaProtocolos} min de protocolo(s) + ${PREMEDICACION_MINUTOS} min de premedicación`
    : `${sumaProtocolos} min de protocolo(s)`;

  document.getElementById("resumen-duracion").textContent =
    `Duración total estimada: ${total} min (${detalle}).`;

  // Ronda "mejoras motor": el checkbox de backup depende también de si ya hay
  // protocolo(s) elegido(s) — se recalcula cada vez que cambia la selección.
  actualizarVisibilidadCamposEspeciales();
}

// --- Ronda "mejoras motor" (post T12): visibilidad de horario manual y sillón backup ---
//
// Frente 2 (horario manual): administrador y enfermería (Etapa 5C, punto 2.5 — antes
// exclusivo administrador; médico y administrativo siguen sin verlo). No depende de
// médico ni protocolos, solo del rol.
// Frente 3 (sillón backup): visible recién después de elegir médico y protocolo(s), para
// cualquier rol que pueda cargar turnos (administrador, enfermería o médico) — el sillón
// backup está disponible para todos los médicos por igual, sin permiso individual.
function actualizarVisibilidadCamposEspeciales() {
  const bloqueHorarioManual = document.getElementById("bloque-horario-manual");
  const bloqueBackup = document.getElementById("bloque-sillon-backup");
  if (!bloqueHorarioManual || !bloqueBackup) return; // por si se llama antes de que el DOM esté armado

  const puedeHorarioManual = rolActualCarga === "administrador" || rolActualCarga === "enfermeria";
  bloqueHorarioManual.style.display = puedeHorarioManual ? "block" : "none";
  if (!puedeHorarioManual) {
    const campoHorarioManual = document.getElementById("campo-horario-manual");
    if (campoHorarioManual) campoHorarioManual.value = "";
  }

  // Etapa 5C, punto 2.1 — mismo rol que horario manual. Al tildar "Internado" (ver
  // alternarInternado), el horario manual pasa a ser obligatorio y deja de buscar
  // sillón — por eso comparten exactamente el mismo gateo de rol acá.
  const bloqueInternado = document.getElementById("bloque-internado");
  if (bloqueInternado) {
    bloqueInternado.style.display = puedeHorarioManual ? "block" : "none";
    if (!puedeHorarioManual) {
      const campoInternado = document.getElementById("campo-internado");
      if (campoInternado) campoInternado.checked = false;
    }
  }

  // Etapa 4, punto 8 — semáforo de prioridad: visible/editable solo médico y administrador.
  const bloquePrioridad = document.getElementById("bloque-prioridad-turno");
  if (bloquePrioridad) {
    const puedePrioridad = rolActualCarga === "medico" || rolActualCarga === "administrador";
    bloquePrioridad.style.display = puedePrioridad ? "block" : "none";
    if (!puedePrioridad) {
      const campoPrioridad = document.getElementById("campo-prioridad-turno");
      if (campoPrioridad) campoPrioridad.value = "";
    }
  }

  const medicoSelect = document.getElementById("campo-medico");
  const medicoValor = medicoSelect ? medicoSelect.value : "";
  const hayProtocolos = Object.values(protocolosSeleccionados).some(p => p !== null);
  const puedeBackup = !!(medicoValor && hayProtocolos);

  bloqueBackup.style.display = puedeBackup ? "block" : "none";
  if (!puedeBackup) {
    const campoBackup = document.getElementById("campo-sillon-backup");
    if (campoBackup) campoBackup.checked = false;
  }
}

// Etapa 5C, punto 2.1 — al tildar "Internado": el horario manual pasa a obligatorio
// (por eso se fuerza visible acá, aunque actualizarVisibilidadCamposEspeciales ya lo
// muestre para estos mismos roles — no hace daño repetirlo) y el checkbox de sillón
// backup deja de tener sentido (un internado nunca ocupa ningún sillón, ni siquiera el
// de inyectables) — se oculta y se destilda. Al destildar "Internado", se restaura el
// estado normal llamando de nuevo a actualizarVisibilidadCamposEspeciales().
function alternarInternado() {
  const tildado = document.getElementById("campo-internado").checked;
  const bloqueHorarioManual = document.getElementById("bloque-horario-manual");
  const bloqueBackup = document.getElementById("bloque-sillon-backup");

  if (tildado) {
    bloqueHorarioManual.style.display = "block";
    bloqueBackup.style.display = "none";
    const campoBackup = document.getElementById("campo-sillon-backup");
    if (campoBackup) campoBackup.checked = false;
  } else {
    actualizarVisibilidadCamposEspeciales();
  }
}

// Etapa 4, punto 9 — despliega la nota inicial opcional (mismo patrón que "+ agregar
// otro protocolo": arranca colapsado como un botón, se despliega recién al tocarlo).
function mostrarNotaInicialCarga() {
  document.getElementById("boton-abrir-nota-inicial-turno").style.display = "none";
  const contenedor = document.getElementById("contenedor-nota-inicial-turno");
  contenedor.style.display = "block";
  document.getElementById("campo-nota-inicial-turno").focus();
}

// --- Guardado del turno (Etapa T3: motor de búsqueda de huecos) ---

async function intentarGuardarTurno() {
  if (guardandoTurno || buscandoHuecos) return;

  if (!pacienteSeleccionadoCarga) {
    mostrarMensajeGeneral("Falta seleccionar el paciente.", "error");
    return;
  }

  const medicoValor = document.getElementById("campo-medico").value;
  if (!medicoValor) {
    mostrarMensajeGeneral("Falta elegir el médico tratante.", "error");
    return;
  }

  const esMedicoOtro = medicoValor === "otro";
  let medicoId = null;
  let medicoNombre = "";

  if (esMedicoOtro) {
    medicoNombre = document.getElementById("campo-medico-otro-nombre").value.trim();
    if (!medicoNombre) {
      mostrarMensajeGeneral("Falta el nombre del profesional en \"Otro\".", "error");
      return;
    }
  } else {
    const medico = medicosCacheCarga.find((m) => m.id === medicoValor);
    if (!medico) {
      mostrarMensajeGeneral("El médico elegido ya no está disponible. Volvé a elegirlo.", "error");
      return;
    }
    medicoId = medico.id;
    medicoNombre = medico.nombre;
  }

  let sedeId, sedeNombre, sedeAutomatica;
  const selectSedeManual = document.getElementById("campo-sede-manual");

  if (medicoValor === MEDICO_OCCHIPINTI_ID) {
    // Occhipinti: la sede la determina el motor según la obra social del paciente
    // (Handoff_etapa_T0.md, decisión 4). No se exige selección manual.
    sedeId = null;
    sedeNombre = null;
    sedeAutomatica = true;
  } else {
    const sedesPosibles = esMedicoOtro ? [] : resolverSedesPosiblesMedico(medicosCacheCarga.find((m) => m.id === medicoValor));

    if (!esMedicoOtro && sedesPosibles.length === 1) {
      sedeId = sedesPosibles[0].id;
      sedeNombre = sedesPosibles[0].nombre;
      sedeAutomatica = true;
    } else {
      if (!selectSedeManual.value) {
        mostrarMensajeGeneral("Falta elegir la sede para este turno.", "error");
        return;
      }
      const sede = sedesCacheCarga.find((s) => s.id === selectSedeManual.value);
      sedeId = sede.id;
      sedeNombre = sede.nombre;
      sedeAutomatica = false;
    }
  }

  const protocolos = Object.values(protocolosSeleccionados).filter(p => p !== null);
  if (protocolos.length === 0) {
    mostrarMensajeGeneral("Falta elegir al menos un protocolo.", "error");
    return;
  }

  const ciclo = parseInt(document.getElementById("campo-ciclo").value, 10);
  const sesion = parseInt(document.getElementById("campo-sesion").value, 10);
  if (!ciclo || ciclo < 1) {
    mostrarMensajeGeneral("El ciclo tiene que ser un número mayor o igual a 1.", "error");
    return;
  }
  if (!sesion || sesion < 1) {
    mostrarMensajeGeneral("La sesión tiene que ser un número mayor o igual a 1.", "error");
    return;
  }

  let fecha, diasSolicitados, fechaCalculadaDesdeDias;

  if (modoFechaTurno === "dias") {
    diasSolicitados = leerDiasTurnoValidos();
    if (diasSolicitados === null) {
      mostrarMensajeGeneral(`Falta indicar en cuántos días es el turno (número entero entre 0 y ${TOPE_DIAS_TURNO}).`, "error");
      return;
    }
    fecha = fechaISODesdeObjeto(fechaObjetoDesdeDiasHoy(diasSolicitados));
    fechaCalculadaDesdeDias = true;
  } else {
    const fechaManual = document.getElementById("campo-fecha").value;
    if (!fechaManual) {
      mostrarMensajeGeneral("Falta elegir la fecha del turno.", "error");
      return;
    }
    // Etapa T12: el atributo "max" del input ya lo impide en la mayoría de los
    // navegadores, pero se valida también acá — mismo criterio que
    // leerDiasTurnoValidos(), que tampoco confía solo en el "max" del HTML.
    if (fechaManual > fechaMaximaAnticipacionISO()) {
      mostrarMensajeGeneral(`No se pueden agendar turnos con más de ${TOPE_DIAS_ANTICIPACION} días de anticipación.`, "error");
      return;
    }
    fecha = fechaManual;
    diasSolicitados = null;
    fechaCalculadaDesdeDias = false;
  }

  const premedicacion = document.getElementById("campo-premedicacion").checked;
  const duracionTotalMinutos =
    protocolos.reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0) +
    (premedicacion ? PREMEDICACION_MINUTOS : 0);

  const datosBasicos = {
    esMedicoOtro,
    medicoId,
    medicoNombre,
    sedeId,
    sedeNombre,
    sedeAutomatica,
    protocolos,
    premedicacion,
    duracionTotalMinutos,
    ciclo,
    sesion,
    fecha,
    diasSolicitados,
    fechaCalculadaDesdeDias,
    pacienteObraSocial: pacienteSeleccionadoCarga.obraSocial || "", // T7: ver guardarComoSobreturnoFisico (caso Occhipinti)
    pacienteId: pacienteSeleccionadoCarga.id, // Etapa 5C: regla "un turno por día" en el horario exacto
    // Etapa 4, punto 8: se lee del <select> solo si el rol puede definirlo — para el
    // resto de los roles el bloque está oculto y campoPrioridad.value siempre es "" de
    // todas formas, pero se refuerza acá para no depender solo del CSS del lado del cliente.
    prioridad: (() => {
      if (rolActualCarga !== "medico" && rolActualCarga !== "administrador") return null;
      const campoPrioridad = document.getElementById("campo-prioridad-turno");
      return (campoPrioridad && campoPrioridad.value) || null;
    })(),
    // Etapa 4, punto 9: habilitado para los cuatro roles, sin gating por rol acá (a
    // diferencia de prioridad).
    notaInicial: (() => {
      const campoNota = document.getElementById("campo-nota-inicial-turno");
      const texto = campoNota ? campoNota.value.trim() : "";
      return texto ? texto.slice(0, 200) : null;
    })()
  };

  // Ronda "mejoras motor": horario manual (Frente 2, administrador y enfermería desde
  // la Etapa 5C, punto 2.5) y checkbox de "solo sillón backup" (Frente 3) — ninguno de
  // los dos aplica a "Reasignar" (que no pasa por acá, tiene su propio flujo en
  // turnero-grilla.js).
  const campoHorarioManual = document.getElementById("campo-horario-manual");
  const horarioManual = ((rolActualCarga === "administrador" || rolActualCarga === "enfermeria") && campoHorarioManual)
    ? campoHorarioManual.value : "";
  const campoBackup = document.getElementById("campo-sillon-backup");
  const bloqueBackup = document.getElementById("bloque-sillon-backup");
  const soloBackup = !!(campoBackup && bloqueBackup && bloqueBackup.style.display !== "none" && campoBackup.checked);

  // Etapa 5C, punto 2.1 — turno de internado: nunca busca sillón (ni siquiera backup),
  // nunca evalúa atadura/cupo/franja, nunca pasa por buscarHuecos ni
  // buscarSillonHorarioFijo. El horario manual de arriba es OBLIGATORIO acá (a
  // diferencia del Frente 2 normal, donde es opcional) porque es el único dato que le
  // dice al sistema a qué hora arranca el tratamiento.
  const campoInternado = document.getElementById("campo-internado");
  const esInternado = !!(campoInternado
    && (rolActualCarga === "administrador" || rolActualCarga === "enfermeria")
    && campoInternado.checked);

  if (esInternado) {
    if (!horarioManual) {
      mostrarMensajeGeneral("Para un turno de internado, cargá el horario en que arranca el tratamiento.", "error");
      return;
    }
    await guardarTurnoInternado(datosBasicos, horarioManual);
    return;
  }

  if (horarioManual) {
    // Frente 2: horario fijado a mano, pasa por encima de atadura/cupo/franja. Si
    // además está tildado el checkbox de backup, restringe la búsqueda de sillón a ese
    // único tipo a esa hora exacta (Frente 2 + 3 combinados).
    await buscarYGuardarConHorarioManual(datosBasicos, horarioManual, soloBackup);
    return;
  }

  if (soloBackup) {
    // Frente 3 solo: búsqueda automática normal (hasta 10 días) pero restringida al
    // sillón backup, ignorando atadura/cupo/franja.
    datosBasicos.soloSillonTipo = "backup";
  }

  // Etapa T3: disparar búsqueda de huecos en lugar de guardar directo
  await buscarYMostrarHuecos(datosBasicos);
}

// Etapa T3: buscar huecos y guardar automáticamente con el mejor
// Etapa T7: acepta un "pacienteInfo" explícito {id, obraSocial} — lo usa "Reasignar"
// (turnero-grilla.js), donde no hay ningún paciente elegido en el formulario de "nuevo
// turno": el paciente es el que ya tiene el turno que se está reasignando. Sin este
// parámetro, sigue usando pacienteSeleccionadoCarga como siempre (alta nueva).
async function buscarYMostrarHuecos(datosBasicos, pacienteInfo) {
  const paciente = pacienteInfo || pacienteSeleccionadoCarga;

  buscandoHuecos = true;
  document.getElementById("boton-guardar-turno").disabled = true;
  mostrarMensajeGeneral("Buscando disponibilidad…", "info");
  // T7: el formulario de "nuevo turno" está cerrado durante una reasignación, así que
  // mostrarMensajeGeneral (arriba) escribe en un modal que no se ve — se espeja acá en
  // el propio modal de "Reasignar".
  if (datosBasicos.modoReasignar) mostrarMensajeReasignarGrilla("Buscando disponibilidad…", "info");

  try {
    // Ronda "reacomodo automático de sillones": la búsqueda automática (nunca horario
    // manual, nunca "Modificar" — ninguno de los dos pasa por acá) usa
    // buscarHuecosConReacomodo en vez de buscarHuecos. "Reasignar" (modoReasignar) queda
    // afuera por ahora a propósito, no estaba pedido explícitamente y su UI (mensaje
    // inline en la grilla, no el modal de sobreturno) no tiene todavía el cartel de
    // confirmación — sigue con buscarHuecos tal cual. Cuando soloSillonTipo === "backup"
    // el reacomodo nunca puede ayudar de verdad (un solo sillón de ese tipo por sede, no
    // hay con qué reacomodar), así que llamarla es inocuo pero el resultado nunca trae
    // reacomodo.
    const usaReacomodo = !datosBasicos.modoReasignar;
    const idsNoReacomodables = usaReacomodo ? calcularTurnosNoReacomodablesIds() : undefined;

    // Etapa 5C (P2): hoy no se ofrece ningún horario anterior a la hora actual. Las dos
    // búsquedas se llaman por separado (antes era un único buscarFn): sus parámetros a
    // partir del 15° no significan lo mismo, así que `ahora` no se puede pasar "por
    // posición" a ambas con una sola lista de argumentos.
    const ahora = ahoraParaMotor();
    const argsBusqueda = [
      datosBasicos.medicoId || datosBasicos.medicoNombre, // Para "Otro", pasamos nombre; el motor lo maneja
      paciente.obraSocial || "",
      datosBasicos.duracionTotalMinutos,
      datosBasicos.fecha,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      rolActualCarga === "medico",
      sedeIdManualParaMotor(datosBasicos), // sede elegida a mano, si aplica (en Reasignar: siempre la del turno)
      cuposCacheCarga, // Etapa T4
      paciente.id, // regla nueva: un turno por paciente por día (transversal a sedes)
      datosBasicos.turnoIdParaReasignar, // T7: excluye el propio turno del chequeo de "un turno por día" — undefined en un alta nueva, no afecta nada
      bloqueosCacheCarga, // Etapa T9
      datosBasicos.soloSillonTipo || null, // Ronda "mejoras motor", Frente 3: "backup" si se tildó el checkbox dedicado de "+ nuevo turno"; también "backup" desde "Reasignar" (Etapa 2, punto 4) cuando el turno que se reasigna ya estaba en ese tipo de sillón (ver buscarReasignarGrilla en turnero-grilla.js); null/undefined en cualquier otro caso
    ];
    const resultado = usaReacomodo
      ? await buscarHuecosConReacomodo(
          ...argsBusqueda,
          idsNoReacomodables,
          false, // probarDiasPosteriores: intento inicial, siempre acotado a la fecha pedida
          // Etapa 5C (decisión de Elías): si el lugar encontrado es OTRO día, ofrecer también
          // reacomodar el día pedido — solo en "+ nuevo turno" (usaReacomodo) y solo para
          // quien puede autorizar un reacomodo (administrador/enfermería; el médico sigue
          // viendo solo el otro día, como antes).
          rolActualCarga !== "medico",
          ahora
        )
      : await buscarHuecos(...argsBusqueda, ahora);

    ultimaBusquedaHuecos = resultado;

    if (resultado.exito && resultado.huecosEncontrados && resultado.huecosEncontrados.length > 0) {
      const mejorHueco = resultado.huecosEncontrados[0];
      if (resultado.reacomodo) {
        // El hueco encontrado exige mover de sillón a otro(s) turno(s) ya cargados (nunca
        // su horario ni fecha) — acción deliberada, nunca se aplica sin confirmar (a.2).
        mostrarConfirmarReacomodo(resultado, datosBasicos);
      } else if (resultado.alternativaReacomodo) {
        // Etapa 5C: hay lugar otro día sin mover a nadie, pero el día pedido también entra
        // reacomodando sillones — la persona elige (cartel aprobado por Elías).
        mostrarElegirOtroDiaOReacomodo(resultado, datosBasicos);
      } else {
        // El sistema elige automáticamente el mejor hueco (el primero de la lista, que está ordenado por mejor ajuste)
        await guardarTurnoConHueco(datosBasicos, mejorHueco, null);
      }
    } else if (resultado.bloqueoPaciente) {
      // Regla nueva: bloqueo total sin excepción de rol, nunca ofrece sobreturno (a
      // diferencia de cupo/atadura, que sí lo hacen) — se corta acá con un mensaje simple.
      mostrarMensajeGeneral(resultado.sinHuecosMotivo, "error");
      if (datosBasicos.modoReasignar) mostrarMensajeReasignarGrilla(resultado.sinHuecosMotivo, "error");
    } else if (resultado.bloqueoCupo) {
      // Etapa T4: no es que no haya sillón físico — el médico llegó a su cupo del día
      // pedido. Distinto del modal de sobreturno de siempre (ver mostrarBloqueoCupo).
      mostrarBloqueoCupo(resultado, datosBasicos);
    } else if (resultado.bloqueoAtadura) {
      // Etapa T4 (31/8): no es que no haya sillón físico — el médico no atiende ese día
      // en esa sede. Distinto del modal de sobreturno de siempre (ver mostrarBloqueoAtadura).
      mostrarBloqueoAtadura(resultado, datosBasicos);
    } else if (resultado.bloqueoFranja) {
      // Ronda "mejoras motor", Frente 1: no es que no haya sillón físico — el turno no
      // podía empezar dentro de la franja horaria propia del médico en ningún día de la
      // ventana. Distinto del modal de sobreturno de siempre (ver mostrarBloqueoFranja).
      mostrarBloqueoFranja(resultado, datosBasicos);
    } else if (usaReacomodo && !datosBasicos.soloSillonTipo) {
      // Ronda "reacomodo automático de sillones": llegamos acá con causaEsFisica true Y
      // el reacomodo YA se intentó en la fecha pedida (buscarHuecosConReacomodo) y
      // también falló — para que entrara haría falta mover el HORARIO de otro turno, algo
      // que el reacomodo nunca hace. Cartel distinto del sobreturno de siempre: ver
      // mostrarReacomodoAgotado.
      mostrarReacomodoAgotado(resultado, datosBasicos);
    } else {
      mostrarSobreturnoFisico(resultado, datosBasicos);
    }
  } catch (error) {
    console.error("Error al buscar huecos:", error);
    mostrarMensajeGeneral(`Error en la búsqueda: ${error.message}`, "error");
    if (datosBasicos.modoReasignar) mostrarMensajeReasignarGrilla(`Error en la búsqueda: ${error.message}`, "error");
  } finally {
    buscandoHuecos = false;
    document.getElementById("boton-guardar-turno").disabled = false;
  }
}



// Mostrar sobreturno cuando el motor agotó los 10 días sin encontrar ningún sillón físico
// libre. Una sola acción manual y deliberada (no una elección entre variantes) — mismo
// criterio que el cartel de cupo excedido: enfermería/administrador pueden forzarlo con
// contexto, el rol médico ve el mismo bloqueo genérico que en cualquier otra restricción.
function mostrarSobreturnoFisico(resultadoBusqueda, datosBasicos) {
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  let cuerpoHTML;
  if (rolActualCarga === "medico") {
    // Mismo texto genérico que cualquier otra restricción (ver mostrarBloqueoCupo) — no
    // le sirve a un médico saber si fue por sillones o por otra causa, solo qué hacer.
    cuerpoHTML = `
      <p>Ha alcanzado el límite máximo de pacientes para este día.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Probá con otra fecha, o pedile a enfermería/administrador que lo cargue si hace falta una excepción.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Entendido</button>
    `;
  } else if (datosBasicos.soloSillonTipo === "backup") {
    // Ronda "mejoras motor", Frente 3: la búsqueda se restringió al sillón backup — el
    // mensaje y la acción son específicos de ese único sillón, no del resto de la sede.
    cuerpoHTML = `
      <p>No hay lugar en el puesto para inyectables para este turno dentro de los próximos 10 días.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Se puede cargar igual, forzado a ese puesto.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="guardarComoSobreturnoSoloBackup(${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar igual en el puesto para inyectables
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar (elegir otra fecha)</button>
    `;
  } else {
    cuerpoHTML = `
      <p>No hay sillón libre para este turno dentro de los próximos 10 días.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Se puede cargar igual, como sobreturno.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="guardarComoSobreturnoFisico(${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar como sobreturno
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar (elegir otra fecha)</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      ${cuerpoHTML}
    </div>
  `;

  modal.style.display = "block";
  mostrarMensajeGeneral("No se pudo cargar el turno como se pidió.", "error");
}

function cerrarModalSobreturno() {
  const modal = document.getElementById("modal-sobreturno");
  if (modal) modal.style.display = "none";
  document.getElementById("boton-guardar-turno").disabled = false;
}

// --- Ronda "reacomodo automático de sillones" ---
//
// Reutiliza el mismo div "modal-sobreturno" que el resto de estos carteles (mismo
// criterio que ya usa mostrarSobreturnoFisico/mostrarBloqueoCupo/etc.: un único overlay,
// contenido distinto según el caso) — cerrarModalSobreturno() sigue sirviendo para
// cerrar cualquiera de los tres estados nuevos de abajo.

// Confirmación deliberada (a.2): el hueco encontrado (ese día o uno posterior, según
// venga resultadoBusqueda.huecosEncontrados[0].fecha) exige mover de sillón a otro(s)
// turno(s) ya cargados — nunca su horario ni su fecha. Nunca se aplica sin este paso:
// el reacomodo mueve turnos de OTROS pacientes, aunque sea solo de sillón. Mismo gate de
// rol que mostrarSobreturnoFisico: médico no puede forzar nada, solo se entera.
function mostrarConfirmarReacomodo(resultadoBusqueda, datosBasicos) {
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  const hueco = resultadoBusqueda.huecosEncontrados[0];
  const cambios = resultadoBusqueda.reacomodo.cambios;
  const cantidadTexto = cambios.length === 1 ? "1 turno" : `${cambios.length} turnos`;

  let cuerpoHTML;
  if (rolActualCarga === "medico") {
    // Mismo criterio que mostrarSobreturnoFisico: un médico no puede autorizar mover
    // turnos de otros pacientes por su cuenta, ni aunque sea solo de sillón.
    cuerpoHTML = `
      <p>No hay sillón libre para este turno tal como está pedido.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Pedile a enfermería/administrador que lo cargue si hace falta una excepción.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Entendido</button>
    `;
  } else {
    const datosConReacomodo = { ...datosBasicos, hueco, cambiosReacomodo: cambios };
    cuerpoHTML = `
      <p>Hay lugar el ${escaparHtml(hueco.fechaLegible)} de ${escaparHtml(hueco.horaInicio)} a ${escaparHtml(hueco.horaFin)},
        moviendo ${cantidadTexto} de sillón para hacer lugar.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Nunca se toca el horario ni la fecha de esos turnos — solo cambian de sillón dentro de la misma sede.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="confirmarYGuardarConReacomodo(${JSON.stringify(datosConReacomodo).replace(/"/g, '&quot;')})">
        Confirmar y cargar
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar (elegir otra fecha)</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0;">Hace falta reacomodar sillones</h2>
      ${cuerpoHTML}
    </div>
  `;
  modal.style.display = "block";
}

// Etapa 5C (cartel aprobado por Elías): la búsqueda normal encontró lugar en OTRO día
// sin mover a nadie, y el día pedido también entra pero reacomodando sillones. Se
// muestran las dos opciones; nunca se elige sola ninguna. Solo llega acá con
// administrador/enfermería (carga no pide la alternativa para el rol médico).
function fechaCortaCarga(fechaISOString) {
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const d = new Date(fechaISOString + "T00:00:00");
  return `${dias[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function nombrePacienteDeTurnoCarga(turnoId) {
  const t = (turnosExistentes || []).find((x) => x.id === turnoId);
  if (!t || !t.paciente) return "Paciente";
  return `${t.paciente.apellido || ""}, ${t.paciente.nombre || ""}`.trim();
}

function mostrarElegirOtroDiaOReacomodo(resultadoBusqueda, datosBasicos) {
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  const huecoOtroDia = resultadoBusqueda.huecosEncontrados[0];
  const alternativa = resultadoBusqueda.alternativaReacomodo;
  const huecoDiaPedido = alternativa.hueco;
  const fechaPedidaLegibleOriginal = formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00"));
  // "El lunes, 7 de octubre…" — en minúscula, va en medio de la frase del título.
  const fechaPedidaLegible = fechaPedidaLegibleOriginal.charAt(0).toLowerCase() + fechaPedidaLegibleOriginal.slice(1);

  const listaCambios = alternativa.cambios.map((c) =>
    `<li>${escaparHtml(nombrePacienteDeTurnoCarga(c.turnoId))}: sillón ${escaparHtml(String(c.sillonAnterior))} → ${escaparHtml(String(c.sillonNuevo))}</li>`
  ).join("");

  const datosOtroDia = { ...datosBasicos, hueco: huecoOtroDia };
  const datosConReacomodo = { ...datosBasicos, hueco: huecoDiaPedido, cambiosReacomodo: alternativa.cambios };

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0;">El ${escaparHtml(fechaPedidaLegible)} está completo</h2>
      <p>Hay dos formas de darle el turno:</p>

      <div style="border: 1px solid var(--color-border, #ddd); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
        <div style="font-weight: 600; margin-bottom: 4px;">Otro día, sin mover a nadie</div>
        <div style="margin-bottom: 10px;">${escaparHtml(huecoOtroDia.fechaLegible)} · ${escaparHtml(huecoOtroDia.horaInicio)} a ${escaparHtml(huecoOtroDia.horaFin)} · Sillón ${escaparHtml(String(huecoOtroDia.sillon))}</div>
        <button type="button" class="boton-principal" style="width: 100%;"
          onclick="elegirOtroDiaSinReacomodo(${JSON.stringify(datosOtroDia).replace(/"/g, '&quot;')})">
          Dar el turno el ${escaparHtml(fechaCortaCarga(huecoOtroDia.fecha))}
        </button>
      </div>

      <div style="border: 1px solid var(--color-border, #ddd); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
        <div style="font-weight: 600; margin-bottom: 4px;">El día pedido, reacomodando sillones</div>
        <div style="margin-bottom: 6px;">${escaparHtml(huecoDiaPedido.fechaLegible)} · ${escaparHtml(huecoDiaPedido.horaInicio)} a ${escaparHtml(huecoDiaPedido.horaFin)} · Sillón ${escaparHtml(String(huecoDiaPedido.sillon))}</div>
        <div style="font-size: 14px; color: var(--color-muted);">Cambian de sillón (mismo horario):</div>
        <ul style="margin: 4px 0 10px; font-size: 14px;">${listaCambios}</ul>
        <button type="button" class="boton-principal" style="width: 100%;"
          onclick="confirmarYGuardarConReacomodo(${JSON.stringify(datosConReacomodo).replace(/"/g, '&quot;')})">
          Reacomodar y dar el turno el ${escaparHtml(fechaCortaCarga(huecoDiaPedido.fecha))}
        </button>
      </div>

      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar</button>
    </div>
  `;
  modal.style.display = "block";
}

async function elegirOtroDiaSinReacomodo(datosOtroDia) {
  cerrarModalSobreturno();
  await guardarTurnoConHueco(datosOtroDia, datosOtroDia.hueco, null);
}

async function confirmarYGuardarConReacomodo(datosConReacomodo) {
  cerrarModalSobreturno();
  await guardarTurnoConHueco(datosConReacomodo, datosConReacomodo.hueco, null, datosConReacomodo.cambiosReacomodo);
}

// Ni siquiera reacomodando sillones entra en la fecha pedida (causaEsFisica true, y
// buscarHuecosConReacomodo ya lo intentó ahí y también falló) — para esa fecha puntual
// haría falta mover el HORARIO de otro turno, algo que el reacomodo nunca hace. Dos
// caminos (confirmado con Elías): dar el turno en una fecha posterior (repite la misma
// búsqueda con reacomodo, pero recorriendo los días siguientes) o cancelar. Mismo gate de
// rol que mostrarSobreturnoFisico.
function mostrarReacomodoAgotado(resultadoBusqueda, datosBasicos) {
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  let cuerpoHTML;
  if (rolActualCarga === "medico") {
    cuerpoHTML = `
      <p>No hay sillón libre para este turno tal como está pedido.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Pedile a enfermería/administrador que lo cargue si hace falta una excepción.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Entendido</button>
    `;
  } else {
    cuerpoHTML = `
      <p>No hay lugar para este turno en la fecha pedida dentro de los próximos 10 días —
        ni siquiera reacomodando sillones de otros turnos.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Para cargarlo justo en esa fecha hace falta mover turnos de lugar a mano desde la grilla.
        También se puede buscar en una fecha posterior, con el mismo criterio de reacomodo.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="buscarFechaPosteriorConReacomodo(${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Dar el turno en fecha posterior
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno en esa fecha</h2>
      ${cuerpoHTML}
    </div>
  `;
  modal.style.display = "block";
  mostrarMensajeGeneral("No se pudo cargar el turno como se pidió.", "error");
}

async function buscarFechaPosteriorConReacomodo(datosBasicos) {
  cerrarModalSobreturno();
  mostrarMensajeGeneral("Buscando en fechas posteriores…", "info");

  try {
    const idsNoReacomodables = calcularTurnosNoReacomodablesIds();
    const resultado = await buscarHuecosConReacomodo(
      datosBasicos.medicoId || datosBasicos.medicoNombre,
      (pacienteSeleccionadoCarga && pacienteSeleccionadoCarga.obraSocial) || "",
      datosBasicos.duracionTotalMinutos,
      datosBasicos.fecha,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      rolActualCarga === "medico",
      datosBasicos.sedeAutomatica ? null : datosBasicos.sedeId,
      cuposCacheCarga,
      pacienteSeleccionadoCarga && pacienteSeleccionadoCarga.id,
      datosBasicos.turnoIdParaReasignar,
      bloqueosCacheCarga,
      datosBasicos.soloSillonTipo || null,
      idsNoReacomodables,
      true, // probarDiasPosteriores
      undefined, // ofrecerAlternativaDiaPedido: no aplica en esta búsqueda
      ahoraParaMotor() // Etapa 5C (P2)
    );

    if (resultado.exito && resultado.reacomodo) {
      mostrarConfirmarReacomodo(resultado, datosBasicos);
    } else {
      mostrarReacomodoSinSolucion();
    }
  } catch (error) {
    console.error("Error al buscar fecha posterior con reacomodo:", error);
    mostrarMensajeGeneral(`Error en la búsqueda: ${error.message}`, "error");
  }
}

function mostrarReacomodoSinSolucion() {
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      <p>Tampoco hay lugar en los próximos 10 días reacomodando sillones.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        La única vía que queda es mover turnos de lugar a mano desde la grilla.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Entendido</button>
    </div>
  `;
  modal.style.display = "block";
}

// Etapa T4: cartel de cupo excedido — distinto del modal de sobreturno de siempre.
// No es que falte sillón físico: el médico llegó a su porcentaje del día pedido.
function mostrarBloqueoCupo(resultadoBusqueda, datosBasicos) {
  const bloqueo = resultadoBusqueda.bloqueoCupo;

  let modal = document.getElementById("modal-bloqueo-cupo");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-bloqueo-cupo";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  let cuerpoHTML;
  if (bloqueo.tipo === "bloqueoTotal") {
    // Rol médico: mensaje genérico, igual para cualquier restricción que lo haya bloqueado
    // (cupo hoy; lo mismo vale si en el futuro se agrega otro motivo de bloqueo total).
    // No se detalla el motivo puntual — a un médico no le sirve saber el porcentaje ni la
    // sede, solo que no puede cargarlo y qué hacer al respecto.
    cuerpoHTML = `
      <p>Ha alcanzado el límite máximo de pacientes para este día.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Probá con otra fecha, o pedile a enfermería/administrador que lo cargue si hace falta una excepción.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoCupo()">Entendido</button>
    `;
  } else {
    // Rol enfermería/administrador: sí necesitan contexto para decidir, pero sin el
    // porcentaje (dato interno del catálogo) — alcanza con cuánto le queda disponible.
    const minutosRestantes = Math.max(0, Math.round(bloqueo.techoMinutos - bloqueo.minutosUsados));
    cuerpoHTML = `
      <p>${escaparHtml(datosBasicos.medicoNombre)} ya usó el tiempo que tiene asignado el ${bloqueo.fechaLegible} en ${escaparHtml(bloqueo.sedeNombre)}
        (le quedan ${minutosRestantes} minutos disponibles y este turno necesita ${datosBasicos.duracionTotalMinutos} minutos).</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Se puede cargar igual, como sobreturno de ese mismo día.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="guardarConSobreturnoPorCupo(${JSON.stringify(bloqueo.huecoDisponible).replace(/"/g, '&quot;')}, ${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar igual como sobreturno este día
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoCupo()">Cancelar (elegir otra fecha)</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      ${cuerpoHTML}
    </div>
  `;

  modal.style.display = "block";
  mostrarMensajeGeneral("No se pudo cargar el turno como se pidió.", "error");
}

function cerrarModalBloqueoCupo() {
  const modal = document.getElementById("modal-bloqueo-cupo");
  if (modal) modal.style.display = "none";
  document.getElementById("boton-guardar-turno").disabled = false;
}

// Etapa T4: enfermería/admin confirman cargar igual, excediendo el cupo del médico.
// Se guarda como sobreturno (sillon: null) del mismo día pedido, no como turno con sillón
// real — así no interfiere con el reparto de sillones de los demás médicos ese día.
async function guardarConSobreturnoPorCupo(huecoDisponible, datosBasicos) {
  cerrarModalBloqueoCupo();

  const hueco = {
    sedeId: huecoDisponible.sedeId,
    sedeNombre: huecoDisponible.sedeNombre,
    fecha: huecoDisponible.fecha,
    fechaLegible: huecoDisponible.fechaLegible,
    horaInicio: huecoDisponible.horaInicio,
    horaFin: huecoDisponible.horaFin,
    sillon: null // no ocupa un sillón real: es un sobreturno por cupo, no disponibilidad física
  };

  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_CUPO);
}

// Etapa T4 (31/8, segunda ronda): nombres de día legibles (con tilde) para el mensaje
// específico del rol médico en el cartel de atadura — turneroSedes/turneroMedicos/
// turneroCupos guardan los días sin tilde ("miercoles", "sabado"), pero acá sí hace
// falta mostrarlos bien escritos.
const DIAS_LEGIBLES_ATADURA = {
  lunes: "lunes", martes: "martes", miercoles: "miércoles",
  jueves: "jueves", viernes: "viernes", sabado: "sábado", domingo: "domingo"
};

function diaLegible(nombreDia) {
  return DIAS_LEGIBLES_ATADURA[nombreDia] || nombreDia || "";
}

function formatearListaDiasLegibles(diasArray) {
  const legibles = (diasArray || []).map(diaLegible).filter(Boolean);
  if (legibles.length === 0) return "";
  if (legibles.length === 1) return legibles[0];
  return `${legibles.slice(0, -1).join(", ")} y ${legibles[legibles.length - 1]}`;
}

// Etapa T4 (31/8, a pedido de Elías): cartel de atadura de día — distinto del modal de
// sobreturno de siempre. No es que falte sillón físico: el médico no atiende ese día en
// esa sede. Mismo patrón que mostrarBloqueoCupo.
function mostrarBloqueoAtadura(resultadoBusqueda, datosBasicos) {
  const bloqueo = resultadoBusqueda.bloqueoAtadura;

  let modal = document.getElementById("modal-bloqueo-atadura");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-bloqueo-atadura";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  let cuerpoHTML;
  if (bloqueo.tipo === "bloqueoTotal") {
    // Rol médico (agregado 31/8, segunda ronda, a pedido de Elías): a diferencia del
    // cupo excedido, acá SÍ conviene un mensaje específico — le sirve saber qué días le
    // corresponden en esta sede para poder cargar el turno él mismo, en vez de un
    // mensaje genérico que lo manda a "probar otra fecha" a ciegas.
    const diaSolicitadoLegible = diaLegible(bloqueo.nombreDiaSolicitado);
    const diasValidosLegible = formatearListaDiasLegibles(bloqueo.diasAtencionMedico);
    cuerpoHTML = diasValidosLegible
      ? `
        <p>Los días ${diaSolicitadoLegible} no atiende consultas en esta institución.</p>
        <p style="font-size: 14px; color: var(--color-muted);">
          Intente cargar el turno los días ${diasValidosLegible}.
        </p>
        <p style="font-size: 14px; color: var(--color-muted);">
          Si es una urgencia o hace falta una excepción, contáctese con enfermería o administrador.
        </p>
        <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoAtadura()">Entendido</button>
      `
      : `
        <p>Los días ${diaSolicitadoLegible} no atiende consultas en esta institución.</p>
        <p style="font-size: 14px; color: var(--color-muted);">
          No tiene ningún día configurado en esta sede. Si es una urgencia o hace falta una
          excepción, contáctese con enfermería o administrador.
        </p>
        <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoAtadura()">Entendido</button>
      `;
  } else {
    // Rol enfermería/administrador: sí necesitan el motivo para decidir.
    // Etapa 5C (P1): si el día pedido ADEMÁS no tenía lugar (sinHuecoFisico), se avisa las
    // dos cosas — antes ese caso caía en "no hay lugar en 10 días" y la atadura no se veía.
    const diaCompleto = !!(bloqueo.huecoDisponible && bloqueo.huecoDisponible.sinHuecoFisico);
    cuerpoHTML = `
      <p>${escaparHtml(datosBasicos.medicoNombre)} no atiende en ${escaparHtml(bloqueo.sedeNombre)} el ${bloqueo.fechaLegible}.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        ${diaCompleto
          ? "Además, ese día no queda lugar en ningún sillón. Se puede cargar igual como sobreturno sin sillón ese mismo día."
          : "Se puede cargar igual, como sobreturno de ese mismo día."}
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="guardarConSobreturnoPorAtadura(${JSON.stringify(bloqueo.huecoDisponible).replace(/"/g, '&quot;')}, ${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar igual como sobreturno este día
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoAtadura()">Cancelar (elegir otra fecha)</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      ${cuerpoHTML}
    </div>
  `;

  modal.style.display = "block";
  mostrarMensajeGeneral("No se pudo cargar el turno como se pidió.", "error");
}

function cerrarModalBloqueoAtadura() {
  const modal = document.getElementById("modal-bloqueo-atadura");
  if (modal) modal.style.display = "none";
  document.getElementById("boton-guardar-turno").disabled = false;
}

// Etapa T4 (31/8): enfermería/admin confirman cargar igual, saltando la atadura de día.
// Se guarda como sobreturno (sillon: null) usando el hueco físico real que ya había ese
// día (candidatoAtaduraExcedida en el motor ya lo buscó ignorando la atadura) — en ese
// caso no hace falta calcularBloqueSobreturno porque ese hueco ya es un bloque completo.
// Etapa 5C (P1): si el día pedido no tenía lugar (huecoDisponible.sinHuecoFisico, sin
// horario), no hay bloque real: el horario se calcula como en cualquier sobreturno sin
// sillón (calcularBloqueSobreturno), sin contar al propio turno si se está reasignando.
async function guardarConSobreturnoPorAtadura(huecoDisponible, datosBasicos) {
  cerrarModalBloqueoAtadura();

  let horaInicioSobreturno = huecoDisponible.horaInicio;
  let horaFinSobreturno = huecoDisponible.horaFin;
  if (huecoDisponible.sinHuecoFisico) {
    const sedeDocAtadura = sedesCacheCarga.find((s) => s.id === huecoDisponible.sedeId);
    const turnosDelDiaAtadura = turnosExistentes.filter((t) =>
      t.sedeId === huecoDisponible.sedeId && t.fecha === huecoDisponible.fecha &&
      !(datosBasicos.turnoIdParaReasignar && t.id === datosBasicos.turnoIdParaReasignar)
    );
    const sillonesAtadura = sedeDocAtadura ? (sedeDocAtadura.sillones || []).map((s) => s.numero) : [];
    const pseudoTurnosBloqueoAtadura = sedeDocAtadura
      ? pseudoTurnosBloqueoEnFecha(
          bloqueosCacheCarga, huecoDisponible.sedeId, huecoDisponible.fecha,
          sillonesAtadura, sedeDocAtadura.horaApertura, sedeDocAtadura.horaCierre
        )
      : [];
    const bloqueAtadura = sedeDocAtadura
      ? calcularBloqueSobreturno(
          sedeDocAtadura.horaApertura,
          sedeDocAtadura.horaCierre,
          [...turnosDelDiaAtadura, ...pseudoTurnosBloqueoAtadura],
          datosBasicos.duracionTotalMinutos
        )
      : { horaInicio: "09:00", horaFin: "10:00" }; // resguardo si la sede no está en caché (mismo criterio que guardarComoSobreturnoFisico)
    horaInicioSobreturno = bloqueAtadura.horaInicio;
    horaFinSobreturno = bloqueAtadura.horaFin;
  }

  const hueco = {
    sedeId: huecoDisponible.sedeId,
    sedeNombre: huecoDisponible.sedeNombre,
    fecha: huecoDisponible.fecha,
    fechaLegible: huecoDisponible.fechaLegible,
    horaInicio: horaInicioSobreturno,
    horaFin: horaFinSobreturno,
    sillon: null // no ocupa un sillón real: es un sobreturno por atadura, no disponibilidad física
  };

  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_ATADURA);
}

// Ronda "mejoras motor", Frente 1: cartel de franja horaria excedida — distinto del
// modal de sobreturno de siempre. No es que falte sillón físico: el turno no podía
// EMPEZAR dentro del rango horario propio del médico en ningún día de la ventana.
// Mismo patrón que mostrarBloqueoAtadura/mostrarBloqueoCupo.
function mostrarBloqueoFranja(resultadoBusqueda, datosBasicos) {
  const bloqueo = resultadoBusqueda.bloqueoFranja;

  let modal = document.getElementById("modal-bloqueo-franja");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-bloqueo-franja";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  let cuerpoHTML;
  if (bloqueo.tipo === "bloqueoTotal") {
    // Rol médico: mensaje específico, le sirve saber su propio horario de atención para
    // poder cargar el turno él mismo en otra fecha, mismo criterio que la atadura.
    cuerpoHTML = `
      <p>Su horario de atención es de ${bloqueo.franjaHorario.horaInicio} a ${bloqueo.franjaHorario.horaFin}, y no hay lugar para iniciar este turno dentro de ese rango en los próximos 10 días.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Probá con otra fecha, o pedile a enfermería/administrador que lo cargue si hace falta una excepción.
      </p>
      <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoFranja()">Entendido</button>
    `;
  } else {
    cuerpoHTML = `
      <p>${escaparHtml(datosBasicos.medicoNombre)} solo atiende de ${bloqueo.franjaHorario.horaInicio} a ${bloqueo.franjaHorario.horaFin}, y no hay ningún inicio posible dentro de ese horario el ${bloqueo.fechaLegible}.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Se puede cargar igual, como sobreturno de ese mismo día.
      </p>
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
        onclick="guardarConSobreturnoPorFranja(${JSON.stringify(bloqueo.huecoDisponible).replace(/"/g, '&quot;')}, ${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar igual como sobreturno este día
      </button>
      <button type="button" class="boton-secundario" onclick="cerrarModalBloqueoFranja()">Cancelar (elegir otra fecha)</button>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      ${cuerpoHTML}
    </div>
  `;

  modal.style.display = "block";
  mostrarMensajeGeneral("No se pudo cargar el turno como se pidió.", "error");
}

function cerrarModalBloqueoFranja() {
  const modal = document.getElementById("modal-bloqueo-franja");
  if (modal) modal.style.display = "none";
  document.getElementById("boton-guardar-turno").disabled = false;
}

// Ronda "mejoras motor", Frente 1: enfermería/admin confirman cargar igual, fuera de la
// franja horaria del médico. Se guarda como sobreturno (sillon: null) usando el hueco
// físico real que ya había ese día (candidatoFranjaExcedida en el motor ya lo buscó
// ignorando la franja, en el horario REAL de la sede) — no hace falta
// calcularBloqueSobreturno acá porque ese hueco ya es un bloque físico completo.
async function guardarConSobreturnoPorFranja(huecoDisponible, datosBasicos) {
  cerrarModalBloqueoFranja();

  const hueco = {
    sedeId: huecoDisponible.sedeId,
    sedeNombre: huecoDisponible.sedeNombre,
    fecha: huecoDisponible.fecha,
    fechaLegible: huecoDisponible.fechaLegible,
    horaInicio: huecoDisponible.horaInicio,
    horaFin: huecoDisponible.horaFin,
    sillon: null // no ocupa un sillón real: es un sobreturno por franja, no disponibilidad física
  };

  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_FRANJA);
}

// Enfermería/administrador confirman cargar igual, pese a que el motor agotó los 10 días
// sin encontrar sillón físico. Única vía de sobreturno por esta causa — sin variantes.
async function guardarComoSobreturnoFisico(datosBasicos) {
  cerrarModalSobreturno();

  let sedeIdSobreturno = datosBasicos.sedeId;
  let sedeNombreSobreturno = datosBasicos.sedeNombre;

  if (recalcularSedeOcchipinti(datosBasicos)) { // en Reasignar se respeta la sede del turno
    // Occhipinti: incluso en sobreturno, la sede se determina según la obra social
    // (misma regla de T0 que usa la búsqueda normal, primera opción de la lista).
    // T7: usa datosBasicos.pacienteObraSocial, no pacienteSeleccionadoCarga directo —
    // en "Reasignar" no hay ningún paciente elegido en este formulario.
    const sedesCandidatas = await determinarSedesABuscar(
      MEDICO_OCCHIPINTI_ID,
      datosBasicos.pacienteObraSocial || "",
      medicosCacheCarga
    );
    sedeIdSobreturno = sedesCandidatas[0];
    const sedeDoc = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
    sedeNombreSobreturno = sedeDoc ? sedeDoc.nombre : sedeIdSobreturno;
  }

  // Etapa T4 (31/8, a pedido de Elías): ya no se guarda un horario fijo 09:00-10:00.
  // Se calcula el bloque real según la agenda de ese día en esa sede: si hay lugar
  // después del último turno ya cargado, ocupa la duración completa pedida; si no entra
  // completa, se acomoda en lo que quede; si no queda nada de lugar, se carga con 1
  // minuto (marca administrativa). Ver calcularBloqueSobreturno en turnero-motor.js.
  const sedeDocParaHorario = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
  // Etapa 5C (P3): en Reasignar, el turno que se está reasignando NO cuenta para calcular el
  // horario del sobreturno (antes sí: si estaba ese mismo día, el sobreturno quedaba más
  // tarde de lo necesario, a veces como la marca de 1 minuto al cierre). undefined en un
  // alta nueva: sin cambios.
  const turnosDelDiaEnSede = turnosExistentes.filter((t) =>
    t.sedeId === sedeIdSobreturno && t.fecha === datosBasicos.fecha &&
    !(datosBasicos.turnoIdParaReasignar && t.id === datosBasicos.turnoIdParaReasignar)
  );
  // Etapa T9: un sobreturno por falta de disponibilidad física es el último recurso del
  // motor (agotó los 10 días sin encontrar nada) — antes de esta etapa no tenía en cuenta
  // los bloqueos, así que podía terminar cayendo en pleno mantenimiento o ausencia de
  // personal, sin ningún aviso. Se agregan los bloqueos vigentes de ese día como si fueran
  // "el último turno cargado" a los efectos de este cálculo (mismo mecanismo de
  // pseudoTurnosBloqueoEnFecha que usa el resto del motor) — sillonesDisponibles no
  // importa acá porque el sobreturno nunca ocupa un sillón real (sillon: null), así que
  // alcanza con que el bloqueo aporte su horarioFin para correr el punto de partida.
  const sillonesSobreturno = sedeDocParaHorario
    ? (sedeDocParaHorario.sillones || []).map((s) => s.numero)
    : [];
  const pseudoTurnosBloqueoSobreturno = sedeDocParaHorario
    ? pseudoTurnosBloqueoEnFecha(
        bloqueosCacheCarga, sedeIdSobreturno, datosBasicos.fecha,
        sillonesSobreturno, sedeDocParaHorario.horaApertura, sedeDocParaHorario.horaCierre
      )
    : [];
  const bloque = sedeDocParaHorario
    ? calcularBloqueSobreturno(
        sedeDocParaHorario.horaApertura,
        sedeDocParaHorario.horaCierre,
        [...turnosDelDiaEnSede, ...pseudoTurnosBloqueoSobreturno],
        datosBasicos.duracionTotalMinutos
      )
    : { horaInicio: "09:00", horaFin: "10:00" }; // resguardo si la sede no está en caché

  // Etapa 2 (feedback post-testeo, ronda 2): si lo que dejó sin espacio real fue (al
  // menos en parte) un bloqueo, corte total — nunca se crea el sobreturno simbólico de
  // 1 minuto en un día bloqueado, para ningún rol.
  const motivoBloqueoResponsable = sedeDocParaHorario
    ? bloqueoResponsableDeSobreturnoAgotado(pseudoTurnosBloqueoSobreturno, bloque)
    : null;
  if (motivoBloqueoResponsable) {
    mostrarMensajeGeneral(
      `Ese día está bloqueado (${motivoBloqueoResponsable}). No se puede cargar un turno — elegí otra fecha.`,
      "error"
    );
    document.getElementById("boton-guardar-turno").disabled = false;
    return;
  }

  // Para sobreturno: crear un "hueco" con los datos originales del formulario
  const hueco = {
    sedeId: sedeIdSobreturno,
    sedeNombre: sedeNombreSobreturno,
    fecha: datosBasicos.fecha,
    fechaLegible: formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00")),
    horaInicio: bloque.horaInicio,
    horaFin: bloque.horaFin,
    sillon: null // no hay sillón asignado real
  };
  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_SIN_DISPONIBILIDAD);
}

// Etapa 2 (feedback post-testeo, ronda 2): "si un día está bloqueado, ese día no se
// carga turno, no importa la situación" — calcularBloqueSobreturno() (turnero-motor.js)
// ya corre el sobreturno para después de cualquier bloqueo vigente ese día, pero si el
// bloqueo (solo o combinado con turnos reales) deja CERO espacio real, igual terminaba
// creando un sobreturno simbólico de 1 minuto justo al cierre — un turno "fantasma" en
// un día bloqueado. Esta función decide si ese resultado degenerado (duracionAsignada
// === 1) es por culpa de un bloqueo (bloquea del todo, sin sobreturno) o solo por
// turnos reales acumulados (sigue permitido, es el comportamiento de siempre). Un
// bloqueo es "responsable" si su horarioFin llega hasta donde quedó forzado el inicio
// del sobreturno — es decir, si fue uno de los que empujó ultimoFin hasta el tope.
function bloqueoResponsableDeSobreturnoAgotado(pseudoTurnosBloqueo, bloque) {
  if (bloque.duracionAsignada !== 1) return null; // hubo espacio real: no es este caso
  const inicioSobreturnoMinutos = minutoDesdeString(bloque.horaInicio);
  const bloqueoResponsable = (pseudoTurnosBloqueo || []).find(pt =>
    minutoDesdeString(pt.horarioFin) >= inicioSobreturnoMinutos
  );
  return bloqueoResponsable ? bloqueoResponsable.motivoBloqueo : null;
}


// restringida al sillón backup — se usa cuando la búsqueda con soloSillonTipo="backup"
// agotó los 10 días sin encontrar hueco en ESE único sillón. A diferencia del sobreturno
// genérico (sillon: null, no reclama ningún recurso físico), acá el turno SÍ se fuerza al
// número real del sillón backup — es la silla pensada justamente para absorber excedente,
// así que ocuparla de más no rompe el reparto de sillones regulares del resto de médicos.
async function guardarComoSobreturnoSoloBackup(datosBasicos) {
  cerrarModalSobreturno();

  let sedeIdSobreturno = datosBasicos.sedeId;
  let sedeNombreSobreturno = datosBasicos.sedeNombre;

  if (recalcularSedeOcchipinti(datosBasicos)) { // en Reasignar se respeta la sede del turno
    const sedesCandidatas = await determinarSedesABuscar(
      MEDICO_OCCHIPINTI_ID,
      datosBasicos.pacienteObraSocial || "",
      medicosCacheCarga
    );
    sedeIdSobreturno = sedesCandidatas[0];
    const sedeDoc = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
    sedeNombreSobreturno = sedeDoc ? sedeDoc.nombre : sedeIdSobreturno;
  }

  const sedeDocParaHorario = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
  const sillonBackup = sedeDocParaHorario
    ? (sedeDocParaHorario.sillones || []).find((s) => s.tipo === "backup")
    : null;

  if (!sedeDocParaHorario || !sillonBackup) {
    mostrarMensajeGeneral("Esta sede no tiene un puesto para inyectables configurado.", "error");
    document.getElementById("boton-guardar-turno").disabled = false;
    return;
  }

  // Etapa 5C (P3): mismo criterio que guardarComoSobreturnoFisico — el turno que se está
  // reasignando no cuenta para calcular su propio horario.
  const turnosDelDiaEnSillonBackup = turnosExistentes.filter((t) =>
    t.sedeId === sedeIdSobreturno && t.fecha === datosBasicos.fecha && t.sillon === sillonBackup.numero &&
    !(datosBasicos.turnoIdParaReasignar && t.id === datosBasicos.turnoIdParaReasignar)
  );
  const pseudoTurnosBloqueoBackup = pseudoTurnosBloqueoEnFecha(
    bloqueosCacheCarga, sedeIdSobreturno, datosBasicos.fecha,
    [sillonBackup.numero], sedeDocParaHorario.horaApertura, sedeDocParaHorario.horaCierre
  );
  const bloque = calcularBloqueSobreturno(
    sedeDocParaHorario.horaApertura,
    sedeDocParaHorario.horaCierre,
    [...turnosDelDiaEnSillonBackup, ...pseudoTurnosBloqueoBackup],
    datosBasicos.duracionTotalMinutos
  );

  // Etapa 2 (feedback post-testeo, ronda 2): mismo criterio que
  // guardarComoSobreturnoFisico — si un bloqueo es responsable de que no quede nada de
  // espacio real en el puesto para inyectables, corte total, sin sobreturno simbólico.
  const motivoBloqueoResponsable = bloqueoResponsableDeSobreturnoAgotado(pseudoTurnosBloqueoBackup, bloque);
  if (motivoBloqueoResponsable) {
    mostrarMensajeGeneral(
      `Ese día está bloqueado (${motivoBloqueoResponsable}). No se puede cargar un turno — elegí otra fecha.`,
      "error"
    );
    document.getElementById("boton-guardar-turno").disabled = false;
    return;
  }

  const hueco = {
    sedeId: sedeIdSobreturno,
    sedeNombre: sedeNombreSobreturno,
    fecha: datosBasicos.fecha,
    fechaLegible: formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00")),
    horaInicio: bloque.horaInicio,
    horaFin: bloque.horaFin,
    sillon: sillonBackup.numero // forzado a la silla backup, a diferencia del sobreturno genérico
  };
  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_SIN_DISPONIBILIDAD);
}

// --- Ronda "mejoras motor", Frente 2: horario manual (administrador y enfermería desde
// la Etapa 5C, punto 2.5) ---
//
// A diferencia de buscarYMostrarHuecos (que recorre hasta 10 días con buscarHuecos()),
// este camino valida UN horario puntual con buscarSillonHorarioFijo() — pasa por encima
// de atadura, cupo y franja horaria a propósito, pero nunca de sillón físicamente libre,
// bloqueos vigentes ni el horario de la sede.
//
// Etapa 5C, punto 2.8: ahora SÍ se usa desde "Reasignar" (turnero-grilla.js,
// buscarReasignarHorarioManualGrilla) además de "+ nuevo turno" — guardarTurnoConHueco
// ya sabía redirigir a abrirMotivoReasignarGrilla cuando datosBasicos.modoReasignar es
// true, así que el guardado en sí no necesitó tocarse. Lo que si hacía falta: esta
// función tenía "#mensaje-general" y "#boton-guardar-turno" (los de "+ nuevo turno")
// escritos a mano adentro — si Reasignar la llamaba tal cual, sus propios mensajes de
// error (horario fuera de sede, bloqueado) aparecían en el formulario equivocado,
// escondido, y quien reasigna no veía nada. El parámetro opcional "opciones" resuelve
// esto: por defecto usa mostrarMensajeGeneral/"boton-guardar-turno" (cero cambio para
// "+ nuevo turno", que no pasa el 4to argumento), y Reasignar pasa los suyos propios.
// Etapa 5C, punto 2.1 — a diferencia de buscarYGuardarConHorarioManual (que SÍ intenta
// encontrar un sillón físico libre a esa hora, y recién si no hay ofrece sobreturno),
// acá nunca se intenta: un internado no ocupa sillón nunca, por más que a esa hora haya
// uno libre. Se arma un "hueco" a mano (sillon: null) y se reutiliza
// guardarTurnoConHueco tal cual, igual que ya hace guardarComoSobreturnoHorarioFijo,
// incluida la resolución de sede para Occhipinti (determinarSedesABuscar) porque acá
// tampoco pasa por el motor que la resolvería de otra forma.
async function guardarTurnoInternado(datosBasicos, horarioManualString) {
  let sedeId = datosBasicos.sedeId;
  let sedeNombre = datosBasicos.sedeNombre;

  if (recalcularSedeOcchipinti(datosBasicos)) { // en Reasignar se respeta la sede del turno
    const sedesCandidatas = await determinarSedesABuscar(
      MEDICO_OCCHIPINTI_ID,
      datosBasicos.pacienteObraSocial || "",
      medicosCacheCarga
    );
    sedeId = sedesCandidatas[0];
    const sedeDoc = sedesCacheCarga.find((s) => s.id === sedeId);
    sedeNombre = sedeDoc ? sedeDoc.nombre : sedeId;
  }

  const horaFinString = stringDesdeMinuto(minutoDesdeString(horarioManualString) + datosBasicos.duracionTotalMinutos);
  const hueco = {
    sedeId,
    sedeNombre,
    fecha: datosBasicos.fecha,
    fechaLegible: formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00")),
    horaInicio: horarioManualString,
    horaFin: horaFinString,
    sillon: null
  };
  await guardarTurnoConHueco({ ...datosBasicos, internado: true }, hueco, null);
}

async function buscarYGuardarConHorarioManual(datosBasicos, horarioManualString, soloBackup, opciones) {
  const mostrarMensaje = (opciones && opciones.mostrarMensaje) || mostrarMensajeGeneral;
  const botonId = (opciones && opciones.botonId) || "boton-guardar-turno";

  buscandoHuecos = true;
  document.getElementById(botonId).disabled = true;
  mostrarMensaje("Verificando el horario indicado…", "info");

  try {
    const resultado = await buscarSillonHorarioFijo(
      datosBasicos.medicoId || datosBasicos.medicoNombre,
      // Bug reportado por Elías (Etapa 5C, 2.8): esta función se escribió originalmente
      // solo para "+ nuevo turno" y usaba pacienteSeleccionadoCarga.obraSocial directo —
      // en Reasignar no hay ningún paciente elegido en ESTE formulario, esa variable
      // global queda en null y explota. Mismo criterio ya establecido en el resto del
      // archivo (ver comentario en buscarComoSobreturnoFisico, línea ~1981): usar
      // datosBasicos.pacienteObraSocial, que tanto "+ nuevo turno" (buscarYMostrarHuecos)
      // como Reasignar (buscarReasignarGrilla/buscarReasignarHorarioManualGrilla) ya
      // completan antes de llamar para acá.
      datosBasicos.pacienteObraSocial || "",
      datosBasicos.duracionTotalMinutos,
      datosBasicos.fecha,
      horarioManualString,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      sedeIdManualParaMotor(datosBasicos), // en Reasignar: siempre la sede del turno
      bloqueosCacheCarga,
      soloBackup,
      // Etapa 5C, bug de Reasignar con horario exacto: sin esto el turno que se está
      // reasignando se contaba a sí mismo como ocupando su sillón. undefined en un alta
      // nueva (datosBasicos no trae turnoIdParaReasignar), sin ningún cambio para ese caso.
      datosBasicos.turnoIdParaReasignar,
      // Etapa 5C: regla "un turno por paciente por día" también para el horario exacto.
      // Se toma SIEMPRE de datosBasicos (nunca de pacienteSeleccionadoCarga directo): en
      // Reasignar esa variable global puede tener un paciente viejo de un "+ nuevo turno"
      // anterior, o null.
      datosBasicos.pacienteId,
      ahoraParaMotor() // Etapa 5C (P2): una hora de hoy que ya pasó se rechaza
    );

    if (resultado.exito) {
      // Etapa 5C (decisión de Elías): un turno con horario manual "se dio así por algo" —
      // queda marcado (turno.horarioManual) y el reacomodo nunca lo mueve de sillón (ver
      // calcularTurnosNoReacomodablesIds). En Reasignar, la marca viaja en el hueco hasta
      // abrirMotivoReasignarGrilla (turnero-grilla.js).
      await guardarTurnoConHueco(datosBasicos, { ...resultado.hueco, horarioManual: true }, null);
      return;
    }

    // Etapa 5C: bloqueo total, mismo criterio y mismo texto que bloqueoPaciente en la
    // búsqueda automática — nunca se ofrece sobreturno.
    if (resultado.motivo === "pacienteMismoDia") {
      mostrarMensaje(
        `Este paciente ya tiene un turno cargado el ${formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00"))}. No se puede agendar otro el mismo día.`,
        "error"
      );
      return;
    }

    // Etapa 5C (P2, decisión de Elías): el horario exacto no sirve para cargar retroactivo.
    // Corte total, sin sobreturno (la hora ya pasó, no es un problema de sillón).
    if (resultado.motivo === "horaPasada") {
      mostrarMensaje(
        `Esa hora ya pasó (ahora son las ${resultado.horaActual}). Elegí una hora de ahí en adelante.`,
        "error"
      );
      return;
    }

    if (resultado.motivo === "horarioFueraDeSede" || resultado.motivo === "sinSede") {
      mostrarMensaje(
        "Ese horario queda fuera del horario de atención de la sede (o antes de que termine el turno). Elegí un horario dentro del horario de apertura y cierre.",
        "error"
      );
      buscandoHuecos = false;
      document.getElementById(botonId).disabled = false;
      return;
    }

    // Feedback post-testeo (Etapa 2): ese horario cae sobre un bloqueo administrativo
    // vigente — corte total, mismo criterio que bloqueoPaciente en la búsqueda
    // automática: nunca se ofrece "cargar igual", para ningún rol (acá "horario manual"
    // ya es exclusivo de administrador/enfermería, así que no hay una versión más
    // restringida que mostrarle a otro rol).
    if (resultado.motivo === "bloqueado") {
      mostrarMensaje(
        `Ese horario está bloqueado${resultado.motivoBloqueo ? ` (${resultado.motivoBloqueo})` : ""}. No se puede cargar un turno ahí — elegí otro horario.`,
        "error"
      );
      buscandoHuecos = false;
      document.getElementById(botonId).disabled = false;
      return;
    }

    // motivo === "sinSillon" (o "error"): a esa hora exacta no queda sillón libre — se
    // ofrece el mismo modal de sobreturno de siempre, pero fijado a este horario puntual
    // en vez de calcular el próximo espacio libre del día (decisión del handoff de
    // planificación, Frente 2).
    mostrarSobreturnoHorarioFijo(datosBasicos, horarioManualString, soloBackup, opciones);
  } catch (error) {
    console.error("Error al validar el horario manual:", error);
    mostrarMensaje(`Error en la búsqueda: ${error.message}`, "error");
  } finally {
    buscandoHuecos = false;
    document.getElementById(botonId).disabled = false;
  }
}

function mostrarSobreturnoHorarioFijo(datosBasicos, horarioManualString, soloBackup, opciones) {
  const mostrarMensaje = (opciones && opciones.mostrarMensaje) || mostrarMensajeGeneral;
  let modal = document.getElementById("modal-sobreturno");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-sobreturno";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
      overflow-y: auto;
    `;
    document.body.appendChild(modal);
  }

  const datosConHorario = { ...datosBasicos, horarioManualString, soloBackup };
  const textoSillon = soloBackup ? "en el puesto para inyectables" : "";
  const cuerpoHTML = `
    <p>No hay sillón libre ${textoSillon} justo a las ${horarioManualString} para este turno.</p>
    <p style="font-size: 14px; color: var(--color-muted);">
      Se puede cargar igual, como sobreturno fijado a ese horario.
    </p>
    <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;"
      onclick="guardarComoSobreturnoHorarioFijo(${JSON.stringify(datosConHorario).replace(/"/g, '&quot;')})">
      Cargar igual a las ${horarioManualString}
    </button>
    <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar</button>
  `;

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se puede cargar este turno</h2>
      ${cuerpoHTML}
    </div>
  `;

  modal.style.display = "block";
  mostrarMensaje("No se pudo cargar el turno como se pidió.", "error");
}

// A diferencia de guardarComoSobreturnoSoloBackup (que busca el próximo espacio libre
// real en el sillón backup), acá el horario ya viene fijado a mano y ese instante puntual
// ya se confirmó ocupado — forzar igual el número del sillón real duplicaría la ocupación
// sobre el mismo recurso físico al mismo tiempo. Por eso, igual que el sobreturno fijo sin
// backup, queda sillon: null (marca administrativa, no reclama ningún sillón físico).
async function guardarComoSobreturnoHorarioFijo(datosBasicos) {
  cerrarModalSobreturno();

  const horarioManualString = datosBasicos.horarioManualString;
  const duracion = datosBasicos.duracionTotalMinutos;
  const horaFinString = stringDesdeMinuto(minutoDesdeString(horarioManualString) + duracion);

  let sedeIdSobreturno = datosBasicos.sedeId;
  let sedeNombreSobreturno = datosBasicos.sedeNombre;

  if (recalcularSedeOcchipinti(datosBasicos)) { // en Reasignar se respeta la sede del turno
    const sedesCandidatas = await determinarSedesABuscar(
      MEDICO_OCCHIPINTI_ID,
      datosBasicos.pacienteObraSocial || "",
      medicosCacheCarga
    );
    sedeIdSobreturno = sedesCandidatas[0];
    const sedeDoc = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
    sedeNombreSobreturno = sedeDoc ? sedeDoc.nombre : sedeIdSobreturno;
  }

  const hueco = {
    sedeId: sedeIdSobreturno,
    sedeNombre: sedeNombreSobreturno,
    fecha: datosBasicos.fecha,
    fechaLegible: formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00")),
    horaInicio: horarioManualString,
    horaFin: horaFinString,
    sillon: null // marca administrativa: el instante pedido ya estaba ocupado, no reclama sillón físico
  };
  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_SIN_DISPONIBILIDAD);
}

// cambiosReacomodo (opcional): [{turnoId, sillonAnterior, sillonNuevo}] devuelto por
// buscarHuecosConReacomodo cuando el hueco elegido exigió mover de sillón a otros turnos
// ya cargados. Se aplica en el MISMO batch que crea el turno nuevo (atómico: o se cargan
// los dos, o ninguno) — nunca toca horario ni fecha de esos turnos, solo `sillon`, más un
// campo `reacomodo` embebido a modo de auditoría liviana (sin colección aparte — ver
// turnero-historial.js, que ya lo muestra en "Ver cadena completa"). Si ese turno ya
// tenía un reacomodo previo, este lo reemplaza (se audita el último movimiento, no el
// historial completo de todos).
async function guardarTurnoConHueco(datosBasicos, hueco, tipoSobreturno, cambiosReacomodo) {
  // Etapa T7: en modo reasignar no se guarda directo — hace falta motivo obligatorio
  // primero (mismo modal que ya usa el arrastre). abrirMotivoReasignarGrilla
  // (turnero-grilla.js) retoma el guardado real (anular el turno viejo + crear el nuevo
  // enlazado) una vez confirmado el motivo — ver anularYCrearTurnoGrilla.
  if (datosBasicos.modoReasignar) {
    abrirMotivoReasignarGrilla(datosBasicos, hueco, tipoSobreturno);
    return;
  }

  guardandoTurno = true;
  document.getElementById("boton-guardar-turno").disabled = true;

  try {
    const docTurno = {
      paciente: {
        id: pacienteSeleccionadoCarga.id,
        tipoDocumento: pacienteSeleccionadoCarga.tipoDocumento,
        numeroDocumento: pacienteSeleccionadoCarga.numeroDocumento,
        nombre: pacienteSeleccionadoCarga.nombre,
        apellido: pacienteSeleccionadoCarga.apellido,
        obraSocial: pacienteSeleccionadoCarga.obraSocial || ""
      },
      medicoId: datosBasicos.medicoId,
      medicoNombre: datosBasicos.medicoNombre,
      esMedicoOtro: datosBasicos.esMedicoOtro,
      sedeId: hueco.sedeId,
      sedeNombre: hueco.sedeNombre,
      sedeAutomatica: datosBasicos.sedeAutomatica,
      protocolos: datosBasicos.protocolos,
      premedicacion: datosBasicos.premedicacion,
      duracionTotalMinutos: datosBasicos.duracionTotalMinutos,
      ciclo: datosBasicos.ciclo,
      sesion: datosBasicos.sesion,
      fecha: hueco.fecha,
      diasSolicitados: datosBasicos.diasSolicitados,
      fechaCalculadaDesdeDias: datosBasicos.fechaCalculadaDesdeDias,
      horario: hueco.horaInicio, // mantener para compatibilidad con comprobante
      // T3: campos nuevos
      sillon: hueco.sillon || null,
      horarioInicio: hueco.horaInicio,
      horarioFin: hueco.horaFin,
      tipoSobreturno: tipoSobreturno || null,
      // Etapa 4, punto 8 — semáforo de prioridad. null si no se definió (incluye
      // siempre: turno cargado por enfermería/administrativo, o médico/administrador
      // que lo dejó "Sin definir").
      prioridad: datosBasicos.prioridad || null,
      // Etapa 4, punto 9 — contador denormalizado (ver comentario de
      // contadorNotasValido() en firestore.rules). Se fija en 0 o 1 acá mismo, en la
      // creación — no hace falta pasar por esa regla de "+1/-1" para el caso inicial,
      // ya viene resuelto en el mismo batch de abajo.
      cantidadNotas: datosBasicos.notaInicial ? 1 : 0,
      // Etapa 5C, punto 2.1 — solo se agrega cuando corresponde; el resto de los turnos
      // no lleva este campo en absoluto (no hace falta "internado: false" en cada uno).
      ...(datosBasicos.internado ? { internado: true } : {}),
      ...(hueco.horarioManual === true ? { horarioManual: true } : {}), // Etapa 5C: ver buscarYGuardarConHorarioManual
      // Standard
      estado: "activo",
      creadoPor: { uid: usuarioActualCarga.uid, nombre: datosUsuarioActualCarga.nombre || usuarioActualCarga.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Etapa T8: mismo mecanismo que guardarEntrega() en entregas.js — el turno y el
    // incremento del contador van en el mismo batch; el número real recién se lee (y se
    // escribe en el turno) después del commit.
    //
    // Etapa 5C, punto 2.1: un internado NUNCA imprime comprobante (decisión con Elías),
    // así que tampoco consume un número — se salta el contador entero, no solo la
    // impresión.
    const esInternado = datosBasicos.internado === true;
    const turnoRef = db.collection("turnos").doc();
    const batch = db.batch();
    const anio = new Date().getFullYear().toString();
    const contadorRef = db.collection("contadores").doc("comprobantesTurno");
    batch.set(turnoRef, docTurno);
    if (!esInternado) {
      batch.set(contadorRef, { [anio]: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    }

    // Etapa 4, punto 9 — nota inicial opcional (bloque colapsado del modal de carga). Va
    // en el mismo batch que el turno: el "create" de una nota no depende de que el
    // turno padre ya exista (ver /turnos/{id}/notas/{notaId} en firestore.rules), así
    // que no hace falta un segundo viaje al servidor para esto.
    if (datosBasicos.notaInicial) {
      const notaRef = turnoRef.collection("notas").doc();
      batch.set(notaRef, {
        texto: datosBasicos.notaInicial,
        autorUid: usuarioActualCarga.uid,
        autorNombre: datosUsuarioActualCarga.nombre || usuarioActualCarga.email,
        autorRol: rolActualCarga,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    if (cambiosReacomodo && cambiosReacomodo.length > 0) {
      const quienDisparo = { uid: usuarioActualCarga.uid, nombre: datosUsuarioActualCarga.nombre || usuarioActualCarga.email };
      for (const cambio of cambiosReacomodo) {
        batch.update(db.collection("turnos").doc(cambio.turnoId), {
          sillon: cambio.sillonNuevo,
          reacomodo: {
            sillonAnterior: cambio.sillonAnterior,
            sillonNuevo: cambio.sillonNuevo,
            turnoQueLoMotivo: turnoRef.id,
            en: firebase.firestore.FieldValue.serverTimestamp(),
            por: quienDisparo
          }
        });
      }
    }

    await batch.commit();

    if (esInternado) {
      // Elías reportó dos cosas que en realidad son la misma causa: (a) no hay una
      // notificación clara de que se guardó, (b) el modal "+ nuevo turno" no se cierra
      // solo como con cualquier otro turno. La razón: observarGuardadoTurnoGrilla() (en
      // turnero-grilla.js) mira este mismo mensaje con
      // startsWith("Turno guardado correctamente.") para cerrar el modal a los 900ms —
      // "Turno DE INTERNADO guardado..." no matcheaba ese prefijo, así que nunca
      // disparaba el cierre. No hace falta un pop-up nuevo: alcanza con que el mensaje
      // empiece igual que el de siempre (el cartel que se desvanece solo, más el modal
      // cerrándose a los 900ms, ya es la notificación que pidió).
      mostrarMensajeGeneral("Turno guardado correctamente. No se generó comprobante: es un turno de internado.", "exito");
      resetearFormularioCarga();
    } else {
      const contadorSnap = await contadorRef.get();
      const numeroCorrelativo = contadorSnap.data()[anio];
      const numeroComprobante = formatearNumeroComprobanteTurno(anio, numeroCorrelativo);
      await turnoRef.update({ numeroComprobante });

      mostrarMensajeGeneral("Turno guardado correctamente. Abriendo comprobante…", "exito");
      resetearFormularioCarga();
      abrirComprobanteTurno(turnoRef.id);
    }
    setTimeout(() => {
      document.getElementById("mensaje-general").style.display = "none";
    }, 4000);
  } catch (error) {
    console.error("Error al guardar el turno:", error);
    mostrarMensajeGeneral("No se pudo guardar el turno. Reintentá en unos segundos.", "error");
  } finally {
    guardandoTurno = false;
    document.getElementById("boton-guardar-turno").disabled = false;
  }
}

function resetearFormularioCarga() {
  quitarPacienteSeleccionado();
  document.getElementById("campo-buscar-paciente").value = "";

  // Etapa T4: para el rol médico, el selector queda fijo en su propio médico — resetear
  // el value a "" lo dejaría sin médico elegido después de cada turno. poblarSelectMedico()
  // ya sabe volver a fijarlo (y a los demás roles los deja en blanco como siempre).
  poblarSelectMedico();
  actualizarBloqueMedico();

  protocolosSeleccionados = {};
  document.getElementById("lista-protocolos").innerHTML = "";
  agregarFilaProtocolo();

  document.getElementById("campo-premedicacion").checked = false;
  document.getElementById("campo-ciclo").value = "";
  document.getElementById("campo-sesion").value = "";

  // Bug reportado por Elías en el retesteo de esta ronda: quedaban pisados entre un
  // turno y el siguiente sin reabrir la página — el horario manual (Frente 2) y el
  // checkbox de puesto para inyectables (Frente 3) no se tocaban acá.
  const campoHorarioManual = document.getElementById("campo-horario-manual");
  if (campoHorarioManual) campoHorarioManual.value = "";
  const campoBackup = document.getElementById("campo-sillon-backup");
  if (campoBackup) campoBackup.checked = false;

  // Etapa 5C, punto 2.1 — mismo motivo que horario manual/backup arriba: sin este
  // reset, "Internado" quedaba tildado en el siguiente turno.
  const campoInternado = document.getElementById("campo-internado");
  if (campoInternado) campoInternado.checked = false;

  // Etapa 4, punto 8 — mismo motivo que el bug de horario manual/backup de arriba: sin
  // este reset, la prioridad del turno anterior quedaba pisada en el siguiente.
  const campoPrioridad = document.getElementById("campo-prioridad-turno");
  if (campoPrioridad) campoPrioridad.value = "";

  // Etapa 4, punto 9 — mismo motivo: sin esto, una nota tipeada y no guardada (turno
  // cancelado antes de guardar, o guardado con otra) quedaba pisada en el siguiente, y
  // el bloque quedaba desplegado en vez de volver a su estado colapsado inicial.
  const campoNotaInicial = document.getElementById("campo-nota-inicial-turno");
  if (campoNotaInicial) campoNotaInicial.value = "";
  const contenedorNotaInicial = document.getElementById("contenedor-nota-inicial-turno");
  if (contenedorNotaInicial) contenedorNotaInicial.style.display = "none";
  const botonNotaInicial = document.getElementById("boton-abrir-nota-inicial-turno");
  if (botonNotaInicial) botonNotaInicial.style.display = "inline-block";

  modoFechaTurno = "dias";
  document.getElementById("campo-dias-turno").value = "";
  document.getElementById("campo-fecha").value = "";
  document.getElementById("fecha-calculada-info").style.display = "none";
  renderizarModoFecha();

  actualizarResumenDuracion();
}
