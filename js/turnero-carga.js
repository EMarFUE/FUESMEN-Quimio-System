// Lógica de la pantalla "Carga de turno" del módulo de Turnero (Etapa T1).
// Formulario base sin motor de huecos: fecha y horario se guardan libremente, a modo
// de placeholder funcional (el buscador de huecos llega en la Etapa T3).
// No depende de egresos.js, entregas.js ni de los turnero-*.js de T0: cada pantalla
// mantiene sus propias funciones, mismo criterio de independencia ya usado en el resto
// del sistema.

const SEDE_CIVIT_ID = "emilio-civit";
const SEDE_ENTRE_RIOS_ID = "entre-rios";
const SEDE_CIVIT_NOMBRE = "Emilio Civit";
const SEDE_ENTRE_RIOS_NOMBRE = "Entre Ríos";
const ROLES_MEDICO_OTRO = ["administrador", "enfermeria"];
const PREMEDICACION_MINUTOS = 30;

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

// --- Cache de pacientes en localStorage ---
// Misma clave que entregas.js, egresos.js e historial.js a propósito, para que las
// pestañas abiertas en una misma computadora compartan una sola lectura real por día.
const CACHE_PACIENTES_KEY = "cache_pacientes_activos";

function fechaLocalHoy() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// Escapa texto libre antes de insertarlo con innerHTML (nombre/apellido de paciente,
// obra social, nombre de protocolo, nombre de médico "Otro"). Mismo patrón ya usado en
// medicamentos.js desde la etapa 3.
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
  document.getElementById("campo-fecha").min = fechaLocalHoy();

  // El listado de pacientes activos es, de las cuatro colecciones que usa esta pantalla,
  // la que más tarda en traerse. Se carga en paralelo sin bloquear el resto del formulario,
  // mismo criterio que egresos.js: el buscador de paciente queda deshabilitado con un aviso
  // mientras tanto.
  campoBuscarPaciente.disabled = true;
  campoBuscarPaciente.placeholder = "Cargando listado de pacientes…";
  cargarPacientesCarga().then(() => {
    campoBuscarPaciente.disabled = false;
    campoBuscarPaciente.placeholder = "Buscar por apellido, nombre o documento";
  });

  await Promise.all([cargarMedicosCarga(), cargarProtocolosCarga(), cargarSedesCarga()]);
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

// --- Búsqueda y alta rápida de paciente (mismo patrón que egresos.js) ---

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
}

function mostrarAltaRapida() {
  document.getElementById("bloque-alta-rapida").style.display = "block";
  document.getElementById("mensaje-alta-rapida").style.display = "none";
}

async function altaRapidaPaciente() {
  const tipoDocumento = document.getElementById("alta-tipo-documento").value;
  const numeroDocumento = soloDigitos(document.getElementById("alta-numero-documento").value);
  const nombre = capitalizarPalabras(document.getElementById("alta-nombre").value);
  const apellido = capitalizarPalabras(document.getElementById("alta-apellido").value);
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

  const id = idPaciente(tipoDocumento, numeroDocumento);

  try {
    const existente = await db.collection("pacientes").doc(id).get();
    if (existente.exists) {
      mostrarError("Ya existe un paciente registrado con ese documento. Buscalo arriba en vez de darlo de alta de nuevo.");
      return;
    }

    await db.collection("pacientes").doc(id).set({
      tipoDocumento,
      numeroDocumento,
      nombre,
      apellido,
      obraSocial: "",
      activo: true,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    const nuevo = { id, tipoDocumento, numeroDocumento, nombre, apellido, obraSocial: "", activo: true };
    pacientesCacheCarga.push(nuevo);
    agregarPacienteACache(nuevo);
    seleccionarPaciente(id);
  } catch (error) {
    console.error("Error al dar de alta al paciente:", error);
    mostrarError("No se pudo guardar el paciente. Reintentá en unos segundos.");
  }
}

// --- Médico tratante y sede ---
// Para los médicos fijos, la sede se resuelve sola a partir de diasPorSede (T0): si el
// médico tiene días cargados en una sola sede, esa es su sede y no hace falta preguntar.
// Occhipinti (días en las dos) y cualquier médico mal cargado sin días en ninguna (0 sedes)
// caen en el mismo caso: se pide la sede a mano. Para "Otro" siempre se pide a mano,
// porque no hay ficha de la que derivarla. La asignación automática real para Occhipinti
// (según obra social del paciente) es lógica del motor de huecos, todavía sin construir
// (T3/T4) — ver Handoff_etapa_T0.md, decisión 4.

function poblarSelectMedico() {
  const select = document.getElementById("campo-medico");
  select.innerHTML = `<option value="">Elegir...</option>`;

  medicosCacheCarga.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nombre;
    select.appendChild(opt);
  });

  if (ROLES_MEDICO_OTRO.includes(rolActualCarga)) {
    const optOtro = document.createElement("option");
    optOtro.value = "otro";
    optOtro.textContent = "Otro (especificar)";
    select.appendChild(optOtro);
  }
}

function poblarSelectSedeManual() {
  const select = document.getElementById("campo-sede-manual");
  select.innerHTML = `<option value="">Elegí la sede...</option>`;
  sedesCacheCarga.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.nombre;
    select.appendChild(opt);
  });
}

function resolverSedesPosiblesMedico(medico) {
  if (!medico || !medico.diasPorSede) return [];
  const sedes = [];
  if ((medico.diasPorSede[SEDE_CIVIT_NOMBRE] || []).length > 0) {
    sedes.push({ id: SEDE_CIVIT_ID, nombre: SEDE_CIVIT_NOMBRE });
  }
  if ((medico.diasPorSede[SEDE_ENTRE_RIOS_NOMBRE] || []).length > 0) {
    sedes.push({ id: SEDE_ENTRE_RIOS_ID, nombre: SEDE_ENTRE_RIOS_NOMBRE });
  }
  return sedes;
}

function actualizarBloqueMedico() {
  const valor = document.getElementById("campo-medico").value;
  const bloqueOtro = document.getElementById("bloque-medico-otro");
  const infoAuto = document.getElementById("sede-automatica-info");
  const badgeAuto = document.getElementById("badge-sede-automatica");
  const avisoSedeIndefinida = document.getElementById("aviso-sede-indefinida");
  const selectManual = document.getElementById("campo-sede-manual");

  if (!valor) {
    bloqueOtro.style.display = "none";
    infoAuto.style.display = "none";
    avisoSedeIndefinida.style.display = "none";
    selectManual.style.display = "none";
    return;
  }

  if (valor === "otro") {
    bloqueOtro.style.display = "block";
    infoAuto.style.display = "none";
    avisoSedeIndefinida.style.display = "none";
    selectManual.style.display = "block";
    return;
  }

  bloqueOtro.style.display = "none";
  document.getElementById("campo-medico-otro-nombre").value = "";

  const medico = medicosCacheCarga.find((m) => m.id === valor);
  const sedesPosibles = resolverSedesPosiblesMedico(medico);

  if (sedesPosibles.length === 1) {
    infoAuto.style.display = "block";
    avisoSedeIndefinida.style.display = "none";
    badgeAuto.textContent = `Sede: ${sedesPosibles[0].nombre}`;
    selectManual.style.display = "none";
    selectManual.value = "";
  } else if (sedesPosibles.length === 0) {
    // Médico sin días cargados en ninguna sede (ficha incompleta en turnero-medicos.js).
    infoAuto.style.display = "none";
    avisoSedeIndefinida.style.display = "block";
    selectManual.style.display = "block";
  } else {
    // Atiende las dos sedes (Occhipinti): la asignación automática es de T3/T4.
    infoAuto.style.display = "none";
    avisoSedeIndefinida.style.display = "none";
    selectManual.style.display = "block";
  }
}

// --- Protocolos (búsqueda por nombre, igual criterio que el buscador de paciente:
// el catálogo tiene 438 registros, así que un <select> plano no es usable) ---

function agregarFilaProtocolo() {
  contadorFilasProtocolo++;
  const id = `fila-protocolo-${contadorFilasProtocolo}`;
  const div = document.createElement("div");
  div.className = "fila-medicamento";
  div.id = id;

  div.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>protocolo ${contadorFilasProtocolo}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div id="protocolo-seleccionado-${id}" class="paciente-seleccionado" style="display:none;">
      <span id="texto-protocolo-seleccionado-${id}"></span>
      <button type="button" class="enlace-accion peligro" data-cambiar="${id}">cambiar</button>
    </div>
    <div id="bloque-busqueda-protocolo-${id}">
      <div class="campo" style="margin-bottom:0;">
        <input type="text" class="input-buscar-protocolo" placeholder="Buscar protocolo por nombre" />
      </div>
      <div class="resultados-busqueda-protocolo"></div>
    </div>
  `;

  div.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaProtocolo(id));
  div.querySelector("[data-cambiar]").addEventListener("click", () => cambiarProtocoloEnFila(id));
  div.querySelector(".input-buscar-protocolo").addEventListener("input", (e) => buscarProtocoloEnFila(id, e.target.value));

  document.getElementById("lista-protocolos").appendChild(div);
  actualizarResumenDuracion();
}

function buscarProtocoloEnFila(filaId, texto) {
  const cont = document.querySelector(`#${filaId} .resultados-busqueda-protocolo`);
  cont.innerHTML = "";
  if (!texto.trim()) return;

  const norm = normalizarTexto(texto);
  const yaElegidos = new Set(
    Object.entries(protocolosSeleccionados)
      .filter(([id]) => id !== filaId)
      .map(([, p]) => p.protocoloId)
  );

  const encontrados = protocolosCacheCarga.filter(
    (p) => normalizarTexto(p.nombre).includes(norm) && !yaElegidos.has(p.id)
  );

  if (encontrados.length === 0) {
    cont.innerHTML = `<div style="font-size:13px;color:var(--color-muted);padding:4px 2px;">Sin coincidencias.</div>`;
    return;
  }

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.nombre)} · ${p.duracionMinutos} min</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarProtocoloEnFila(filaId, p.id));
    cont.appendChild(div);
  });
}

function seleccionarProtocoloEnFila(filaId, protocoloId) {
  const protocolo = protocolosCacheCarga.find((p) => p.id === protocoloId);
  if (!protocolo) return;

  protocolosSeleccionados[filaId] = {
    protocoloId: protocolo.id,
    nombre: protocolo.nombre,
    duracionMinutos: protocolo.duracionMinutos
  };

  document.querySelector(`#${filaId} .input-buscar-protocolo`).value = "";
  document.querySelector(`#${filaId} .resultados-busqueda-protocolo`).innerHTML = "";
  renderizarProtocoloSeleccionado(filaId);
  actualizarResumenDuracion();
}

function renderizarProtocoloSeleccionado(filaId) {
  const contSeleccionado = document.getElementById(`protocolo-seleccionado-${filaId}`);
  const bloqueBusqueda = document.getElementById(`bloque-busqueda-protocolo-${filaId}`);
  const seleccionado = protocolosSeleccionados[filaId];

  if (!seleccionado) {
    contSeleccionado.style.display = "none";
    bloqueBusqueda.style.display = "block";
    return;
  }

  contSeleccionado.style.display = "flex";
  bloqueBusqueda.style.display = "none";
  document.getElementById(`texto-protocolo-seleccionado-${filaId}`).innerHTML =
    `<strong>${escaparHtml(seleccionado.nombre)}</strong> · ${seleccionado.duracionMinutos} min`;
}

function cambiarProtocoloEnFila(filaId) {
  delete protocolosSeleccionados[filaId];
  renderizarProtocoloSeleccionado(filaId);
  actualizarResumenDuracion();
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
    .reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0);
  const premedicacion = document.getElementById("campo-premedicacion").checked;
  const total = sumaProtocolos + (premedicacion ? PREMEDICACION_MINUTOS : 0);

  const detalle = premedicacion
    ? `${sumaProtocolos} min de protocolo(s) + ${PREMEDICACION_MINUTOS} min de premedicación`
    : `${sumaProtocolos} min de protocolo(s)`;

  document.getElementById("resumen-duracion").textContent =
    `Duración total estimada: ${total} min (${detalle}). No reserva ningún sillón todavía — eso lo hace el motor de huecos en una etapa posterior.`;
}

// --- Guardado del turno ---

function intentarGuardarTurno() {
  if (guardandoTurno) return;

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

  // Sede: automática si el médico atiende una sola sede, manual en cualquier otro caso
  // (Occhipinti, "Otro", o un médico sin días cargados en ninguna sede).
  let sedeId, sedeNombre, sedeAutomatica;
  const selectSedeManual = document.getElementById("campo-sede-manual");
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

  const protocolos = Object.values(protocolosSeleccionados);
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

  const fecha = document.getElementById("campo-fecha").value;
  const horario = document.getElementById("campo-horario").value;
  if (!fecha) {
    mostrarMensajeGeneral("Falta elegir la fecha del turno.", "error");
    return;
  }
  if (!horario) {
    mostrarMensajeGeneral("Falta elegir el horario del turno.", "error");
    return;
  }

  const premedicacion = document.getElementById("campo-premedicacion").checked;
  const duracionTotalMinutos =
    protocolos.reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0) +
    (premedicacion ? PREMEDICACION_MINUTOS : 0);

  guardarTurnoReal({
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
    horario
  });
}

async function guardarTurnoReal(datos) {
  guardandoTurno = true;
  document.getElementById("boton-guardar-turno").disabled = true;

  try {
    await db.collection("turnos").add({
      paciente: {
        id: pacienteSeleccionadoCarga.id,
        tipoDocumento: pacienteSeleccionadoCarga.tipoDocumento,
        numeroDocumento: pacienteSeleccionadoCarga.numeroDocumento,
        nombre: pacienteSeleccionadoCarga.nombre,
        apellido: pacienteSeleccionadoCarga.apellido,
        obraSocial: pacienteSeleccionadoCarga.obraSocial || ""
      },
      medicoId: datos.medicoId,
      medicoNombre: datos.medicoNombre,
      esMedicoOtro: datos.esMedicoOtro,
      sedeId: datos.sedeId,
      sedeNombre: datos.sedeNombre,
      sedeAutomatica: datos.sedeAutomatica,
      protocolos: datos.protocolos,
      premedicacion: datos.premedicacion,
      duracionTotalMinutos: datos.duracionTotalMinutos,
      ciclo: datos.ciclo,
      sesion: datos.sesion,
      fecha: datos.fecha,
      horario: datos.horario,
      // Placeholder para la Etapa T7 (reasignar/modificar/eliminar sin borrado físico).
      // Todo turno cargado en T1 nace "activo"; el resto de los valores ("cancelado",
      // "reasignado") no tienen todavía ninguna pantalla que los produzca.
      estado: "activo",
      creadoPor: { uid: usuarioActualCarga.uid, nombre: datosUsuarioActualCarga.nombre || usuarioActualCarga.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

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
  document.getElementById("campo-fecha").value = "";
  document.getElementById("campo-horario").value = "";
  actualizarResumenDuracion();
}
