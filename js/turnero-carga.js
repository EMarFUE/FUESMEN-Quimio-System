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
const MEDICO_OCCHIPINTI_ID = "occhipinti";
const ROLES_MEDICO_OTRO = ["administrador", "enfermeria"];
const PREMEDICACION_MINUTOS = 30;
const TOPE_DIAS_TURNO = 60;

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

  campoBuscarPaciente.disabled = true;
  campoBuscarPaciente.placeholder = "Cargando listado de pacientes…";
  cargarPacientesCarga().then(() => {
    campoBuscarPaciente.disabled = false;
    campoBuscarPaciente.placeholder = "Buscar por apellido, nombre o documento";
  });

  await Promise.all([cargarMedicosCarga(), cargarProtocolosCarga(), cargarSedesCarga(), cargarTurnosExistentes()]);
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

// Etapa T3: cargar turnos existentes para que el motor valide no superposición
async function cargarTurnosExistentes() {
  try {
    const snapshot = await db.collection("turnos").where("estado", "==", "activo").get();
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
    fechaCalculadaDesdeDias
  });
}

// Etapa T3: buscar huecos y guardar automáticamente con el mejor
async function buscarYMostrarHuecos(datosBasicos) {
  buscandoHuecos = true;
  document.getElementById("boton-guardar-turno").disabled = true;
  mostrarMensajeGeneral("Buscando disponibilidad…", "info");

  try {
    const resultado = await buscarHuecos(
      datosBasicos.medicoId || datosBasicos.medicoNombre, // Para "Otro", pasamos nombre; el motor lo maneja
      pacienteSeleccionadoCarga.obraSocial || "",
      datosBasicos.duracionTotalMinutos,
      datosBasicos.fecha,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      rolActualCarga === "medico",
      datosBasicos.sedeAutomatica ? null : datosBasicos.sedeId // sede elegida a mano, si aplica
    );

    ultimaBusquedaHuecos = resultado;

    if (resultado.exito && resultado.huecosEncontrados && resultado.huecosEncontrados.length > 0) {
      // El sistema elige automáticamente el mejor hueco (el primero de la lista, que está ordenado por mejor ajuste)
      const mejorHueco = resultado.huecosEncontrados[0];
      await guardarTurnoConHueco(datosBasicos, mejorHueco, null);
    } else {
      mostrarOpcioneSobreturno(resultado, datosBasicos);
    }
  } catch (error) {
    console.error("Error al buscar huecos:", error);
    mostrarMensajeGeneral(`Error en la búsqueda: ${error.message}`, "error");
  } finally {
    buscandoHuecos = false;
    document.getElementById("boton-guardar-turno").disabled = false;
  }
}



// Mostrar opción de sobreturno cuando no hay huecos
function mostrarOpcioneSobreturno(resultadoBusqueda, datosBasicos) {
  const contenido = document.getElementById("contenido-carga");
  
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

  // Determinar qué opciones de sobreturno mostrar según el rol
  const puedeForzarAutomatico = rolActualCarga !== "medico"; // enfermería o administrador
  const puedeForzarExcepcional = ["administrador", "enfermeria"].includes(rolActualCarga);

  let opcionesHTML = "";
  if (puedeForzarAutomatico) {
    opcionesHTML += `
      <button type="button" class="boton-principal" style="margin-bottom: 10px; width: 100%;" 
        onclick="guardarConSobreturno('automatico', ${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar como sobreturno automático
      </button>
      <div style="font-size: 12px; color: var(--color-muted); margin-bottom: 15px;">
        El sobreturno automático respeta todas las restricciones de rol y disponibilidad.
      </div>
    `;
  }

  if (puedeForzarExcepcional) {
    opcionesHTML += `
      <button type="button" class="boton-principal" style="background: #d4a017; margin-bottom: 10px; width: 100%;" 
        onclick="guardarConSobreturno('excepcional', ${JSON.stringify(datosBasicos).replace(/"/g, '&quot;')})">
        Cargar como sobreturno excepcional (saltea todas las restricciones)
      </button>
      <div style="font-size: 12px; color: var(--color-muted); margin-bottom: 15px;">
        Solo para casos especiales. Saltea la lógica de disponibilidad.
      </div>
    `;
  }

  modal.innerHTML = `
    <div style="background: white; margin: 20px auto; max-width: 600px; padding: 20px; border-radius: 8px;">
      <h2 style="margin-top: 0; color: #c0504d;">No se encontró lugar disponible</h2>
      <p>${resultadoBusqueda.sinHuecosMotivo || "La agenda está completa en la fecha solicitada."}</p>
      <p style="font-size: 14px; color: var(--color-muted);">Opciones disponibles para tu rol:</p>
      <div id="opciones-sobreturno" style="margin-bottom: 20px;">
        ${opcionesHTML}
      </div>
      <button type="button" class="boton-secundario" onclick="cerrarModalSobreturno()">Cancelar (elegir otra fecha)</button>
    </div>
  `;

  modal.style.display = "block";
  mostrarMensajeGeneral("No hay lugar disponible. Mirá las opciones de sobreturno.", "error");
}

function cerrarModalSobreturno() {
  const modal = document.getElementById("modal-sobreturno");
  if (modal) modal.style.display = "none";
  document.getElementById("boton-guardar-turno").disabled = false;
}



async function guardarConSobreturno(tipoSobreturno, datosBasicos) {
  cerrarModalSobreturno();

  let sedeIdSobreturno = datosBasicos.sedeId;
  let sedeNombreSobreturno = datosBasicos.sedeNombre;

  if (datosBasicos.medicoId === MEDICO_OCCHIPINTI_ID) {
    // Occhipinti: incluso en sobreturno, la sede se determina según la obra social
    // (misma regla de T0 que usa la búsqueda normal, primera opción de la lista).
    const sedesCandidatas = await determinarSedesABuscar(
      MEDICO_OCCHIPINTI_ID,
      pacienteSeleccionadoCarga.obraSocial || "",
      medicosCacheCarga
    );
    sedeIdSobreturno = sedesCandidatas[0];
    const sedeDoc = sedesCacheCarga.find((s) => s.id === sedeIdSobreturno);
    sedeNombreSobreturno = sedeDoc ? sedeDoc.nombre : sedeIdSobreturno;
  }

  // Para sobreturno: crear un "hueco" fake con los datos originales del formulario
  const hueco = {
    sedeId: sedeIdSobreturno,
    sedeNombre: sedeNombreSobreturno,
    fecha: datosBasicos.fecha,
    fechaLegible: formatearFechaLegible(new Date(datosBasicos.fecha + "T00:00:00")),
    horaInicio: "09:00", // placeholder, no se usa en sobreturno
    horaFin: "10:00", // placeholder
    sillon: 0, // 0 indica que no hay sillón asignado real
  };
  await guardarTurnoConHueco(datosBasicos, hueco, tipoSobreturno);
}

async function guardarTurnoConHueco(datosBasicos, hueco, tipoSobreturno) {
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

    await db.collection("turnos").add(docTurno);

    mostrarMensajeGeneral("Turno guardado correctamente.", "exito");
    resetearFormularioCarga();
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

  document.getElementById("campo-medico").value = "";
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
