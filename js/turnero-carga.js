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
const ROLES_MEDICO_OTRO = ["administrador", "enfermeria"];
const PREMEDICACION_MINUTOS = 30;
const TOPE_DIAS_TURNO = 60;
// Etapa T12: tope de anticipación máxima para agendar un turno, acordado con Elías —
// aplica tanto al modo "calendario" (que hasta ahora no tenía ningún tope) como a los
// selectores de fecha de referencia de "Reasignar" y "Consulta de disponibilidad" en
// turnero-grilla.js. El modo "días" ya queda cubierto de por sí (TOPE_DIAS_TURNO=60 +
// hasta 10 días de margen de búsqueda del motor = 70 días como máximo, siempre por
// debajo de este tope). Solo del lado del cliente — ver nota en cargarTurnosExistentes()
// sobre por qué no se replica esto en firestore.rules.
const TOPE_DIAS_ANTICIPACION = 90;
// Margen de la consulta de turnos existentes que usa el motor: un poco más amplio que
// TOPE_DIAS_ANTICIPACION (que es el máximo que puede pedir un usuario) para no cortar
// justo en el límite si el margen de búsqueda del motor (10 días) empuja la fecha
// encontrada un poco más allá del máximo solicitado.
const MARGEN_LECTURA_TURNOS_DIAS = 100;

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
    if (!pacienteSeleccionadoCarga) {
      badgeSedeAutomatica.textContent = "Se determina según la obra social del paciente";
    } else if (pacienteSeleccionadoCarga.obraSocial === OBRA_SOCIAL_POP) {
      badgeSedeAutomatica.textContent = "Emilio Civit (por obra social POP)";
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

  encontrados.slice(0, 5).forEach((p) => {
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
    resultados.appendChild(div);
  });

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

function construirBloqueAgregarProtocoloNuevo(filaId, nombrePropuesto) {
  const bloque = document.createElement("div");
  bloque.className = "resultado-busqueda";
  bloque.style.cssText = "flex-direction:column;align-items:stretch;gap:6px;";

  const etiqueta = document.createElement("span");
  etiqueta.style.cssText = "font-size:13px;color:var(--color-muted);";
  etiqueta.textContent = `¿No está en la lista? Agregar "${nombrePropuesto}" como protocolo nuevo:`;
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

  // Etapa T3: disparar búsqueda de huecos en lugar de guardar directo
  await buscarYMostrarHuecos({
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
    pacienteObraSocial: pacienteSeleccionadoCarga.obraSocial || "" // T7: ver guardarComoSobreturnoFisico (caso Occhipinti)
  });
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
    const resultado = await buscarHuecos(
      datosBasicos.medicoId || datosBasicos.medicoNombre, // Para "Otro", pasamos nombre; el motor lo maneja
      paciente.obraSocial || "",
      datosBasicos.duracionTotalMinutos,
      datosBasicos.fecha,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      rolActualCarga === "medico",
      datosBasicos.sedeAutomatica ? null : datosBasicos.sedeId, // sede elegida a mano, si aplica
      cuposCacheCarga, // Etapa T4
      paciente.id, // regla nueva: un turno por paciente por día (transversal a sedes)
      datosBasicos.turnoIdParaReasignar, // T7: excluye el propio turno del chequeo de "un turno por día" — undefined en un alta nueva, no afecta nada
      bloqueosCacheCarga // Etapa T9
    );

    ultimaBusquedaHuecos = resultado;

    if (resultado.exito && resultado.huecosEncontrados && resultado.huecosEncontrados.length > 0) {
      // El sistema elige automáticamente el mejor hueco (el primero de la lista, que está ordenado por mejor ajuste)
      const mejorHueco = resultado.huecosEncontrados[0];
      await guardarTurnoConHueco(datosBasicos, mejorHueco, null);
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
    cuerpoHTML = `
      <p>${escaparHtml(datosBasicos.medicoNombre)} no atiende en ${escaparHtml(bloqueo.sedeNombre)} el ${bloqueo.fechaLegible}.</p>
      <p style="font-size: 14px; color: var(--color-muted);">
        Se puede cargar igual, como sobreturno de ese mismo día.
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
// día (candidatoAtaduraExcedida en el motor ya lo buscó ignorando la atadura) — no hace
// falta calcularBloqueSobreturno acá porque ese hueco ya es un bloque físico completo.
async function guardarConSobreturnoPorAtadura(huecoDisponible, datosBasicos) {
  cerrarModalBloqueoAtadura();

  const hueco = {
    sedeId: huecoDisponible.sedeId,
    sedeNombre: huecoDisponible.sedeNombre,
    fecha: huecoDisponible.fecha,
    fechaLegible: huecoDisponible.fechaLegible,
    horaInicio: huecoDisponible.horaInicio,
    horaFin: huecoDisponible.horaFin,
    sillon: null // no ocupa un sillón real: es un sobreturno por atadura, no disponibilidad física
  };

  await guardarTurnoConHueco(datosBasicos, hueco, TIPO_SOBRETURNO_ATADURA);
}

// Enfermería/administrador confirman cargar igual, pese a que el motor agotó los 10 días
// sin encontrar sillón físico. Única vía de sobreturno por esta causa — sin variantes.
async function guardarComoSobreturnoFisico(datosBasicos) {
  cerrarModalSobreturno();

  let sedeIdSobreturno = datosBasicos.sedeId;
  let sedeNombreSobreturno = datosBasicos.sedeNombre;

  if (datosBasicos.medicoId === MEDICO_OCCHIPINTI_ID) {
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
  const turnosDelDiaEnSede = turnosExistentes.filter((t) =>
    t.sedeId === sedeIdSobreturno && t.fecha === datosBasicos.fecha
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

async function guardarTurnoConHueco(datosBasicos, hueco, tipoSobreturno) {
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
      // Standard
      estado: "activo",
      creadoPor: { uid: usuarioActualCarga.uid, nombre: datosUsuarioActualCarga.nombre || usuarioActualCarga.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Etapa T8: mismo mecanismo que guardarEntrega() en entregas.js — el turno y el
    // incremento del contador van en el mismo batch; el número real recién se lee (y se
    // escribe en el turno) después del commit.
    const turnoRef = db.collection("turnos").doc();
    const batch = db.batch();
    const anio = new Date().getFullYear().toString();
    const contadorRef = db.collection("contadores").doc("comprobantesTurno");
    batch.set(turnoRef, docTurno);
    batch.set(contadorRef, { [anio]: firebase.firestore.FieldValue.increment(1) }, { merge: true });
    await batch.commit();

    const contadorSnap = await contadorRef.get();
    const numeroCorrelativo = contadorSnap.data()[anio];
    const numeroComprobante = formatearNumeroComprobanteTurno(anio, numeroCorrelativo);
    await turnoRef.update({ numeroComprobante });

    mostrarMensajeGeneral("Turno guardado correctamente. Abriendo comprobante…", "exito");
    resetearFormularioCarga();
    abrirComprobanteTurno(turnoRef.id);
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

  modoFechaTurno = "dias";
  document.getElementById("campo-dias-turno").value = "";
  document.getElementById("campo-fecha").value = "";
  document.getElementById("fecha-calculada-info").style.display = "none";
  renderizarModoFecha();

  actualizarResumenDuracion();
}
