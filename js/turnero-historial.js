// Historial de turnos reasignados/modificados/cancelados (Etapa T7, Fase 3).
// Página independiente (turnero/historial-turnos.html), mismo criterio de independencia
// por página que ya usa el resto del sistema — no depende de turnero-motor.js,
// turnero-carga.js ni turnero-grilla.js (esos tres sí comparten scope entre sí en
// agenda.html; este archivo no convive con ellos en ninguna página, así que no hace
// falta chequear colisión de nombres contra ellos, pero se mantiene igual el sufijo
// "HistorialTurnos" en todo lo propio de este archivo, por prolijidad).
//
// Restringida a administrador y enfermería (a diferencia de la agenda, de lectura
// abierta a los cuatro roles): acá se expone motivo y usuario de cada cambio. La
// restricción real está en firestore.rules (turnoAnulableT7 no cambia; se agregó una
// condición nueva al "allow read" de /turnos — ver Handoff de esta fase). Esta pantalla
// además nunca aparece en el menú para médico/administrativo (ver turnero/index.html).
//
// Diseño de los filtros: cuatro modos MUTUAMENTE EXCLUYENTES (uno a la vez), mismo
// criterio que ya usa medicacion/historial.js para entregas/egresos — evita depender de
// índices compuestos innecesarios. "Por tipo de acción" reemplaza el filtro base
// (reasignado/modificado/cancelado) por un único valor; "Por médico"/"Por
// paciente"/"Por rango de fechas" agregan una condición más, pero siguen trayendo los
// tres tipos de acción para ese médico/paciente/rango.
//
// Índices de Firestore que Firebase puede llegar a pedir la primera vez que se usa cada
// filtro (mismo aviso que ya deja medicacion/historial.js): la consola del navegador
// (F12) trae un enlace directo para crearlos con un clic la primera vez que hace falta.
//
// Campo elegido para ordenar y para el filtro de fecha: "anuladoEn" (cuándo se hizo el
// cambio), no "fecha" (la fecha del turno en sí) — esta pantalla es un registro de
// auditoría de cambios, no una agenda por fecha de tratamiento.

const TAMANO_PAGINA_HISTORIAL_TURNOS = 25;
const ESTADOS_ANULADOS_HISTORIAL_TURNOS = ["reasignado", "modificado", "cancelado"];

const ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS = {
  reasignado: "Reasignado",
  modificado: "Modificado",
  cancelado: "Cancelado"
};

// Mismos tokens de color que ya define css/styles.css (--color-accent, --color-accent-secondary,
// --color-danger, y sus variantes "-soft") — sin agregar clases nuevas a la hoja de estilos,
// mismo criterio que ya usó turnero-grilla.js para el botón "Eliminar" (estilo inline sobre
// la clase genérica ".badge").
const ESTILOS_BADGE_TIPO_ACCION_HISTORIAL_TURNOS = {
  reasignado: "background:var(--color-accent-soft);color:var(--color-accent);border-color:var(--color-accent-soft);",
  modificado: "background:var(--color-accent-secondary-soft);color:#3b6d11;border-color:var(--color-accent-secondary-soft);",
  cancelado: "background:var(--color-danger-soft);color:var(--color-danger);border-color:var(--color-danger-soft);"
};

let usuarioActualHistorialTurnos = null;
let datosUsuarioActualHistorialTurnos = null;
let rolActualHistorialTurnos = null;

let estadoFiltroHistorialTurnos = {
  modo: "recientes", // recientes | tipo | medico | paciente | fecha
  tipoAccion: null,
  medicoId: null,
  medicoEsOtro: false,
  pacienteId: null,
  fechaDesde: null,
  fechaHasta: null
};

let cursorHistorialTurnos = null;
let hayMasHistorialTurnos = true;
let cargandoHistorialTurnos = false;

let medicosCacheHistorialTurnos = null; // catálogo de turneroMedicos, para el <select> del filtro
let pacientesCacheHistorialTurnos = null; // null = todavía no se cargó
let cargandoPacientesHistorialTurnos = false;
let temporizadorBusquedaDocumentoHistorialTurnos = null;

// Misma clave de localStorage que ya usa medicacion/historial.js: son los mismos
// pacientes (colección "pacientes" compartida entre los dos módulos), así que compartir
// la clave deja aprovechar el cache ya armado desde la otra pantalla sin depender de su
// archivo — cada página sigue siendo independiente, solo coinciden en qué guardan.
const CACHE_PACIENTES_KEY_HISTORIAL_TURNOS = "cache_pacientes_activos";

// --- Utilidades (duplicadas a propósito, mismo criterio de independencia por página) ---

function fechaLocalHoyHistorialTurnos() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function leerCachePacientesHistorialTurnos() {
  try {
    const crudo = localStorage.getItem(CACHE_PACIENTES_KEY_HISTORIAL_TURNOS);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (datos.fecha !== fechaLocalHoyHistorialTurnos()) return null;
    return datos.pacientes;
  } catch (error) {
    console.warn("No se pudo leer el cache de pacientes:", error);
    return null;
  }
}

function guardarCachePacientesHistorialTurnos(pacientes) {
  try {
    localStorage.setItem(CACHE_PACIENTES_KEY_HISTORIAL_TURNOS, JSON.stringify({ fecha: fechaLocalHoyHistorialTurnos(), pacientes }));
  } catch (error) {
    console.warn("No se pudo guardar el cache de pacientes:", error);
  }
}

function normalizarTextoHistorialTurnos(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function soloDigitosHistorialTurnos(texto) {
  return (texto || "").toString().replace(/\D/g, "");
}

function formatearFechaHoraHistorialTurnos(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// Escapa texto libre antes de insertarlo con innerHTML (motivo, nombres). Mismo patrón
// ya usado en el resto del sistema desde la etapa 3 de Medicación.
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// --- Arranque ---

function iniciarHistorialTurnos(user, datosUsuario) {
  usuarioActualHistorialTurnos = user;
  datosUsuarioActualHistorialTurnos = datosUsuario;
  rolActualHistorialTurnos = datosUsuario.rol;

  configurarTabsHistorialTurnos();
  configurarTabsTipoAccionHistorialTurnos();
  cargarMedicosParaFiltroHistorialTurnos();

  document.getElementById("campo-buscar-paciente-historial-turnos")
    .addEventListener("input", (e) => buscarPacienteFiltroHistorialTurnos(e.target.value));

  configurarCierreCadenaHistorialTurnos();

  cargarPaginaHistorialTurnos(true);
}

function configurarTabsHistorialTurnos() {
  document.querySelectorAll("#filtro-tabs-historial-turnos .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => cambiarModoFiltroHistorialTurnos(btn.dataset.modo));
  });
}

function configurarTabsTipoAccionHistorialTurnos() {
  document.querySelectorAll("#selector-tipo-accion-historial-turnos .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => seleccionarTipoAccionHistorialTurnos(btn.dataset.tipo));
  });
}

function configurarCierreCadenaHistorialTurnos() {
  const overlay = document.getElementById("overlay-cadena-historial-turnos");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") cerrarCadenaHistorialTurnos();
  });
}

function cambiarModoFiltroHistorialTurnos(modo) {
  estadoFiltroHistorialTurnos.modo = modo;

  document.querySelectorAll("#filtro-tabs-historial-turnos .filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  document.getElementById("bloque-filtro-tipo").style.display = modo === "tipo" ? "block" : "none";
  document.getElementById("bloque-filtro-medico").style.display = modo === "medico" ? "block" : "none";
  document.getElementById("bloque-filtro-paciente").style.display = modo === "paciente" ? "block" : "none";
  document.getElementById("bloque-filtro-fecha").style.display = modo === "fecha" ? "block" : "none";

  if (modo === "recientes") {
    cargarPaginaHistorialTurnos(true);
    return;
  }
  if (modo === "tipo") {
    if (estadoFiltroHistorialTurnos.tipoAccion) {
      cargarPaginaHistorialTurnos(true);
    } else {
      mostrarPlaceholderHistorialTurnos("Elegí un tipo de acción.");
    }
    return;
  }
  if (modo === "medico") {
    if (estadoFiltroHistorialTurnos.medicoId || estadoFiltroHistorialTurnos.medicoEsOtro) {
      cargarPaginaHistorialTurnos(true);
    } else {
      mostrarPlaceholderHistorialTurnos("Elegí un médico.");
    }
    return;
  }
  if (modo === "paciente") {
    cargarPacientesHistorialTurnosSiHaceFalta();
    if (estadoFiltroHistorialTurnos.pacienteId) {
      cargarPaginaHistorialTurnos(true);
    } else {
      mostrarPlaceholderHistorialTurnos("Elegí un paciente para ver su historial.");
    }
    return;
  }
  if (modo === "fecha") {
    if (estadoFiltroHistorialTurnos.fechaDesde && estadoFiltroHistorialTurnos.fechaHasta) {
      cargarPaginaHistorialTurnos(true);
    } else {
      mostrarPlaceholderHistorialTurnos("Completá el rango de fechas y presioná «Buscar».");
    }
  }
}

function mostrarPlaceholderHistorialTurnos(texto) {
  document.getElementById("cuerpo-tabla-historial-turnos").innerHTML =
    `<tr><td colspan="8" style="color:var(--color-muted);padding:16px 6px;">${texto}</td></tr>`;
  document.getElementById("zona-cargar-mas-historial-turnos").style.display = "none";
}

// --- Filtro "por tipo de acción" ---

function seleccionarTipoAccionHistorialTurnos(tipo) {
  estadoFiltroHistorialTurnos.tipoAccion = tipo;
  document.querySelectorAll("#selector-tipo-accion-historial-turnos .filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.tipo === tipo);
  });
  cargarPaginaHistorialTurnos(true);
}

// --- Filtro "por médico" ---

async function cargarMedicosParaFiltroHistorialTurnos() {
  const select = document.getElementById("campo-filtro-medico");
  try {
    const snapshot = await db.collection("turneroMedicos").get();
    medicosCacheHistorialTurnos = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

    medicosCacheHistorialTurnos.forEach((medico) => {
      const opcion = document.createElement("option");
      opcion.value = medico.id;
      opcion.textContent = medico.nombre || medico.id;
      select.appendChild(opcion);
    });
    const opcionOtro = document.createElement("option");
    opcionOtro.value = "__otro__";
    opcionOtro.textContent = "Otro derivante";
    select.appendChild(opcionOtro);
  } catch (error) {
    console.error("Error al cargar médicos para el filtro:", error);
  }
}

function aplicarFiltroMedicoHistorialTurnos(valor) {
  if (!valor) {
    estadoFiltroHistorialTurnos.medicoId = null;
    estadoFiltroHistorialTurnos.medicoEsOtro = false;
    mostrarPlaceholderHistorialTurnos("Elegí un médico.");
    return;
  }
  if (valor === "__otro__") {
    estadoFiltroHistorialTurnos.medicoId = null;
    estadoFiltroHistorialTurnos.medicoEsOtro = true;
  } else {
    estadoFiltroHistorialTurnos.medicoId = valor;
    estadoFiltroHistorialTurnos.medicoEsOtro = false;
  }
  cargarPaginaHistorialTurnos(true);
}

// --- Filtro "por paciente" (mismo patrón que medicacion/historial.js) ---

async function cargarPacientesHistorialTurnosSiHaceFalta() {
  if (pacientesCacheHistorialTurnos || cargandoPacientesHistorialTurnos) return;
  cargandoPacientesHistorialTurnos = true;

  const campo = document.getElementById("campo-buscar-paciente-historial-turnos");
  campo.disabled = true;
  campo.placeholder = "Cargando listado de pacientes…";

  try {
    const enCache = leerCachePacientesHistorialTurnos();
    if (enCache) {
      pacientesCacheHistorialTurnos = enCache;
    } else {
      const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
      pacientesCacheHistorialTurnos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      guardarCachePacientesHistorialTurnos(pacientesCacheHistorialTurnos);
    }
  } catch (error) {
    console.error("Error al cargar pacientes:", error);
    pacientesCacheHistorialTurnos = [];
  } finally {
    cargandoPacientesHistorialTurnos = false;
    campo.disabled = false;
    campo.placeholder = "Buscar por apellido, nombre o documento";
  }
}

function buscarPacienteFiltroHistorialTurnos(texto) {
  const cont = document.getElementById("resultados-busqueda-paciente-historial-turnos");
  const sinResultados = document.getElementById("sin-resultados-historial-turnos");
  cont.innerHTML = "";

  if (!texto.trim() || !pacientesCacheHistorialTurnos) {
    sinResultados.style.display = "none";
    return;
  }

  const norm = normalizarTextoHistorialTurnos(texto);
  const digitos = soloDigitosHistorialTurnos(texto);
  const encontrados = pacientesCacheHistorialTurnos.filter((p) => {
    const coincideNombre = normalizarTextoHistorialTurnos(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  if (encontrados.length === 0) {
    sinResultados.style.display = "block";
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPacienteFiltroHistorialTurnos(p));
    cont.appendChild(div);
  });
}

function seleccionarPacienteFiltroHistorialTurnos(p) {
  estadoFiltroHistorialTurnos.pacienteId = p.id;

  document.getElementById("campo-buscar-paciente-historial-turnos").value = "";
  document.getElementById("resultados-busqueda-paciente-historial-turnos").innerHTML = "";
  document.getElementById("sin-resultados-historial-turnos").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial-turnos").style.display = "none";

  const cont = document.getElementById("paciente-seleccionado-historial-turnos");
  cont.style.display = "flex";
  document.getElementById("texto-paciente-seleccionado-historial-turnos").innerHTML =
    `<strong>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;

  cargarPaginaHistorialTurnos(true);
}

function quitarPacienteFiltroHistorialTurnos() {
  estadoFiltroHistorialTurnos.pacienteId = null;

  document.getElementById("paciente-seleccionado-historial-turnos").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial-turnos").style.display = "block";

  mostrarPlaceholderHistorialTurnos("Elegí un paciente para ver su historial.");
}

// --- Filtro "por rango de fechas" (sobre "anuladoEn", ver nota al principio del archivo) ---

function aplicarFiltroFechaHistorialTurnos() {
  const desdeStr = document.getElementById("campo-filtro-fecha-desde-historial-turnos").value;
  const hastaStr = document.getElementById("campo-filtro-fecha-hasta-historial-turnos").value;

  if (!desdeStr || !hastaStr) {
    alert("Completá las dos fechas.");
    return;
  }

  const desde = new Date(desdeStr + "T00:00:00");
  const hasta = new Date(hastaStr + "T23:59:59");

  if (desde > hasta) {
    alert('La fecha "desde" no puede ser posterior a la fecha "hasta".');
    return;
  }

  estadoFiltroHistorialTurnos.fechaDesde = desde;
  estadoFiltroHistorialTurnos.fechaHasta = hasta;
  cargarPaginaHistorialTurnos(true);
}

// --- Construcción y ejecución de la consulta paginada ---

function construirConsultaHistorialTurnos(paraExportar) {
  let consulta = db.collection("turnos");

  if (estadoFiltroHistorialTurnos.modo === "tipo" && estadoFiltroHistorialTurnos.tipoAccion) {
    consulta = consulta.where("estado", "==", estadoFiltroHistorialTurnos.tipoAccion);
  } else {
    consulta = consulta.where("estado", "in", ESTADOS_ANULADOS_HISTORIAL_TURNOS);
  }

  if (estadoFiltroHistorialTurnos.modo === "medico") {
    if (estadoFiltroHistorialTurnos.medicoEsOtro) {
      consulta = consulta.where("esMedicoOtro", "==", true);
    } else if (estadoFiltroHistorialTurnos.medicoId) {
      consulta = consulta.where("medicoId", "==", estadoFiltroHistorialTurnos.medicoId);
    }
  } else if (estadoFiltroHistorialTurnos.modo === "paciente" && estadoFiltroHistorialTurnos.pacienteId) {
    consulta = consulta.where("paciente.id", "==", estadoFiltroHistorialTurnos.pacienteId);
  } else if (estadoFiltroHistorialTurnos.modo === "fecha" && estadoFiltroHistorialTurnos.fechaDesde && estadoFiltroHistorialTurnos.fechaHasta) {
    consulta = consulta
      .where("anuladoEn", ">=", estadoFiltroHistorialTurnos.fechaDesde)
      .where("anuladoEn", "<=", estadoFiltroHistorialTurnos.fechaHasta);
  }

  consulta = consulta.orderBy("anuladoEn", "desc");

  if (!paraExportar) {
    consulta = consulta.limit(TAMANO_PAGINA_HISTORIAL_TURNOS);
    if (cursorHistorialTurnos) consulta = consulta.startAfter(cursorHistorialTurnos);
  }

  return consulta;
}

async function cargarPaginaHistorialTurnos(reset) {
  if (cargandoHistorialTurnos) return;
  cargandoHistorialTurnos = true;

  const tbody = document.getElementById("cuerpo-tabla-historial-turnos");
  const botonMas = document.getElementById("boton-cargar-mas-historial-turnos");

  if (reset) {
    cursorHistorialTurnos = null;
    hayMasHistorialTurnos = true;
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--color-muted);">Cargando...</td></tr>`;
  }
  botonMas.disabled = true;
  botonMas.textContent = "Cargando...";

  try {
    const snapshot = await construirConsultaHistorialTurnos(false).get();

    if (reset) tbody.innerHTML = "";

    if (snapshot.empty && reset) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--color-muted);padding:16px 6px;">No hay registros con ese filtro.</td></tr>`;
    } else {
      snapshot.docs.forEach((doc) => {
        tbody.appendChild(filaHistorialTurnos(doc.id, doc.data()));
      });
    }

    hayMasHistorialTurnos = snapshot.docs.length === TAMANO_PAGINA_HISTORIAL_TURNOS;
    if (snapshot.docs.length > 0) cursorHistorialTurnos = snapshot.docs[snapshot.docs.length - 1];
    actualizarBotonCargarMasHistorialTurnos();
  } catch (error) {
    console.error("Error al cargar el historial de turnos:", error);
    if (reset) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--color-danger);padding:16px 6px;">
        No se pudo cargar el historial. Si es la primera vez que se usa este filtro, puede
        faltar crear un índice en Firestore — abrí la consola del navegador (F12): el error
        trae un enlace directo para crearlo con un clic.
      </td></tr>`;
    }
    hayMasHistorialTurnos = false;
    actualizarBotonCargarMasHistorialTurnos();
  } finally {
    cargandoHistorialTurnos = false;
    botonMas.disabled = false;
    botonMas.textContent = "Cargar más";
  }
}

function cargarMasHistorialTurnos() {
  cargarPaginaHistorialTurnos(false);
}

function actualizarBotonCargarMasHistorialTurnos() {
  document.getElementById("zona-cargar-mas-historial-turnos").style.display = hayMasHistorialTurnos ? "block" : "none";
}

// --- Fila de la tabla ---

function badgeTipoAccionHistorialTurnos(estado) {
  const etiqueta = ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS[estado] || estado;
  const estilo = ESTILOS_BADGE_TIPO_ACCION_HISTORIAL_TURNOS[estado] || "";
  return `<span class="badge" style="${estilo}">${etiqueta}</span>`;
}

function filaHistorialTurnos(id, d) {
  const tr = document.createElement("tr");
  const paciente = d.paciente || {};

  tr.innerHTML = `
    <td>${formatearFechaHoraHistorialTurnos(d.anuladoEn)}</td>
    <td>${badgeTipoAccionHistorialTurnos(d.estado)}</td>
    <td>${escaparHtml(d.fecha || "-")}<br><span style="color:var(--color-muted);font-size:12px;">${escaparHtml(d.horarioInicio || "-")}–${escaparHtml(d.horarioFin || "-")}</span></td>
    <td>${escaparHtml(paciente.apellido || "")}, ${escaparHtml(paciente.nombre || "")}</td>
    <td>${escaparHtml(d.medicoNombre || "-")}</td>
    <td>${escaparHtml(d.motivoCambio || "-")}</td>
    <td>${escaparHtml((d.anuladoPor && d.anuladoPor.nombre) || "-")}</td>
    <td class="acciones-fila"></td>
  `;

  const celdaAcciones = tr.querySelector(".acciones-fila");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "enlace-accion";
  boton.textContent = "Ver cadena completa";
  boton.addEventListener("click", () => abrirCadenaHistorialTurnos(id));
  celdaAcciones.appendChild(boton);

  return tr;
}

// --- Reconstrucción de la cadena completa (turno original → reemplazos sucesivos) ---
//
// ordenarCadenaDesdeMapa() es la parte PURA, sin ninguna llamada a Firestore — se puede
// probar en Node con un mapa armado a mano (ver notas de esta fase). cargarCadenaCompleta()
// es la que de verdad trae los documentos, uno por uno, siguiendo turnoOriginalId hacia
// atrás y turnoNuevoId hacia adelante desde cualquier eslabón de la cadena.

function ordenarCadenaDesdeMapa(idInicial, docsPorId) {
  let actual = docsPorId[idInicial];
  if (!actual) return [];

  // Retroceder hasta el origen (turno sin turnoOriginalId). Protegido contra ciclos,
  // que no deberían poder darse con el mecanismo actual, pero mejor no confiar en eso.
  const vistosAtras = new Set([actual.id]);
  while (actual.turnoOriginalId && docsPorId[actual.turnoOriginalId] && !vistosAtras.has(actual.turnoOriginalId)) {
    actual = docsPorId[actual.turnoOriginalId];
    vistosAtras.add(actual.id);
  }

  // Desde el origen, avanzar armando la cadena completa hasta la punta (activa o cancelada).
  const cadena = [actual];
  const vistosAdelante = new Set([actual.id]);
  while (cadena[cadena.length - 1].turnoNuevoId) {
    const siguienteId = cadena[cadena.length - 1].turnoNuevoId;
    const siguiente = docsPorId[siguienteId];
    if (!siguiente || vistosAdelante.has(siguienteId)) break;
    cadena.push(siguiente);
    vistosAdelante.add(siguienteId);
  }
  return cadena;
}

async function cargarCadenaCompleta(turnoIdInicial) {
  const docsPorId = {};

  async function obtenerYGuardar(id) {
    if (docsPorId[id]) return docsPorId[id];
    const snap = await db.collection("turnos").doc(id).get();
    if (!snap.exists) return null;
    const datos = { id: snap.id, ...snap.data() };
    docsPorId[id] = datos;
    return datos;
  }

  let actual = await obtenerYGuardar(turnoIdInicial);
  if (!actual) return [];

  while (actual.turnoOriginalId) {
    const anterior = await obtenerYGuardar(actual.turnoOriginalId);
    if (!anterior) break;
    actual = anterior;
  }

  let puntero = actual;
  while (puntero.turnoNuevoId) {
    const siguiente = await obtenerYGuardar(puntero.turnoNuevoId);
    if (!siguiente) break;
    puntero = siguiente;
  }

  return ordenarCadenaDesdeMapa(actual.id, docsPorId);
}

async function abrirCadenaHistorialTurnos(turnoId) {
  const overlay = document.getElementById("overlay-cadena-historial-turnos");
  const contenedor = document.getElementById("modal-panel-cadena-historial-turnos");
  overlay.style.display = "flex";
  contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">Cargando…</div>`;

  try {
    const cadena = await cargarCadenaCompleta(turnoId);
    renderizarCadenaHistorialTurnos(cadena);
  } catch (error) {
    console.error("Error al reconstruir la cadena del turno:", error);
    contenedor.innerHTML = `<div style="padding:20px;color:var(--color-danger);">No se pudo cargar la cadena completa. Reintentá en unos segundos.</div>`;
  }
}

function renderizarCadenaHistorialTurnos(cadena) {
  const contenedor = document.getElementById("modal-panel-cadena-historial-turnos");

  if (!cadena.length) {
    contenedor.innerHTML = `
      <div class="modal-encabezado"><button type="button" class="modal-cerrar" onclick="cerrarCadenaHistorialTurnos()" aria-label="Cerrar">×</button></div>
      <div style="padding:12px;color:var(--color-muted);">No se pudo reconstruir la cadena — puede que algún turno vinculado ya no exista.</div>
    `;
    return;
  }

  const paciente = cadena[0].paciente || {};

  const eslabonesHtml = cadena.map((turno, indice) => {
    const esUltimo = indice === cadena.length - 1;
    const encabezadoEslabon = indice === 0 ? "Turno original" : `Reemplazo n.° ${indice}`;

    let bloqueTransicion = "";
    if (turno.estado !== "activo") {
      bloqueTransicion = `
        <div style="margin:8px 0 0;padding:10px 12px;border-left:3px solid var(--color-border);background:var(--color-bg);font-size:12.5px;">
          ${badgeTipoAccionHistorialTurnos(turno.estado)} el ${formatearFechaHoraHistorialTurnos(turno.anuladoEn)}
          por <strong>${escaparHtml((turno.anuladoPor && turno.anuladoPor.nombre) || "-")}</strong><br>
          <strong>Motivo:</strong> ${escaparHtml(turno.motivoCambio || "-")}
        </div>
      `;
    } else if (esUltimo) {
      bloqueTransicion = `<div style="margin-top:8px;font-size:12.5px;color:#3b6d11;">Turno vigente actualmente.</div>`;
    }

    return `
      <div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:12px;margin-bottom:10px;">
        <div style="font-weight:600;font-size:12.5px;color:var(--color-muted);margin-bottom:6px;">${encabezadoEslabon}</div>
        <div style="font-size:13px;line-height:1.7;">
          <strong>Fecha / horario:</strong> ${escaparHtml(turno.fecha || "-")} · ${escaparHtml(turno.horarioInicio || "-")}–${escaparHtml(turno.horarioFin || "-")}<br>
          <strong>Médico:</strong> ${escaparHtml(turno.medicoNombre || "-")}<br>
          <strong>Sillón:</strong> ${turno.sillon != null ? turno.sillon : "sin asignar (sobreturno)"}<br>
          <span style="color:var(--color-muted);font-size:12px;">Creado por ${escaparHtml((turno.creadoPor && turno.creadoPor.nombre) || "-")} · ${formatearFechaHoraHistorialTurnos(turno.creadoEn)}</span>
        </div>
        ${bloqueTransicion}
      </div>
    `;
  }).join("");

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarCadenaHistorialTurnos()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">Cadena completa del turno</div>
    <div style="font-size:13px;color:var(--color-muted);margin-bottom:14px;">
      Paciente: <strong>${escaparHtml(paciente.apellido || "")}, ${escaparHtml(paciente.nombre || "")}</strong>
    </div>
    ${eslabonesHtml}
    <div style="display:flex;justify-content:flex-end;margin-top:6px;">
      <button type="button" class="boton-secundario" style="width:auto;" onclick="cerrarCadenaHistorialTurnos()">Cerrar</button>
    </div>
  `;
}

function cerrarCadenaHistorialTurnos() {
  document.getElementById("overlay-cadena-historial-turnos").style.display = "none";
  document.getElementById("modal-panel-cadena-historial-turnos").innerHTML = "";
}

function cerrarCadenaHistorialTurnosSiFondo(evento) {
  if (evento.target.id === "overlay-cadena-historial-turnos") cerrarCadenaHistorialTurnos();
}

// --- Exportar a Excel ---
//
// Trae TODO lo que coincide con el filtro activo, sin el límite de paginación (decisión
// tomada con Elías: el botón exporta el universo filtrado completo, no solo lo ya
// cargado en pantalla con "Cargar más"). Mismo patrón que ya usa js/stock.js
// (exportarStockAExcel): XLSX.utils.json_to_sheet + XLSX.writeFile, librería SheetJS ya
// cargada en la página vía CDN.

async function exportarHistorialTurnosAExcel() {
  const boton = document.getElementById("boton-exportar-historial-turnos");
  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Exportando...";

  try {
    const snapshot = await construirConsultaHistorialTurnos(true).get();

    if (snapshot.empty) {
      alert("No hay datos para exportar con el filtro actual.");
      return;
    }

    const filas = snapshot.docs.map((doc) => {
      const d = doc.data();
      const paciente = d.paciente || {};
      return {
        "Cuándo (cambio)": formatearFechaHoraHistorialTurnos(d.anuladoEn),
        "Tipo de acción": ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS[d.estado] || d.estado,
        "Fecha del turno": d.fecha || "",
        "Horario": `${d.horarioInicio || ""}–${d.horarioFin || ""}`,
        "Paciente": `${paciente.apellido || ""}, ${paciente.nombre || ""}`,
        Documento: paciente.numeroDocumento || "",
        Médico: d.medicoNombre || "",
        Motivo: d.motivoCambio || "",
        "Realizado por": (d.anuladoPor && d.anuladoPor.nombre) || ""
      };
    });

    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Historial de turnos");

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `historial_turnos_${fecha}.xlsx`);
  } catch (error) {
    console.error("Error al exportar el historial a Excel:", error);
    alert("No se pudo exportar. Si es la primera vez que se usa este filtro puede faltar crear un índice en Firestore — mirá la consola del navegador (F12).");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// Exporta la función pura para poder probarla en Node (mismo criterio que ya usa
// turnero-motor.js con validarModificacionTurno, etc.). No exporta nada más porque el
// resto del archivo depende del DOM y de Firestore.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ordenarCadenaDesdeMapa };
}
