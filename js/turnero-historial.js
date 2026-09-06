// Historial de TODOS los turnos — otorgados con normalidad, reasignados, modificados y
// cancelados (Etapa T7, Fase 3; ampliado a pedido de Elías tras la primera entrega, que
// solo traía los tres tipos de cambio). Página independiente
// (turnero/historial-turnos.html), mismo criterio de independencia por página que ya usa
// el resto del sistema — no depende de turnero-motor.js, turnero-carga.js ni
// turnero-grilla.js (esos tres sí comparten scope entre sí en agenda.html; este archivo
// no convive con ellos en ninguna página, así que no hace falta chequear colisión de
// nombres contra ellos, pero se mantiene igual el sufijo "HistorialTurnos" en todo lo
// propio de este archivo, por prolijidad).
//
// Etapa T8: se abrió a los cuatro roles (antes, administrador y enfermería
// únicamente). Motivo y usuario de cada cambio siguen expuestos solo para
// administrador/enfermería — para médico y administrativo esas dos columnas (y el
// badge de tipo de acción no se oculta, pero motivo/quién sí) quedan ocultas del lado
// del cliente (ver mostrarMotivoUsuarioHistorialTurnos()/columnasVisiblesHistorialTurnos
// más abajo). OJO: firestore.rules ahora permite leer cualquier turno a cualquier
// autenticado — la restricción de motivo/usuario es solo de interfaz, no de datos; un
// usuario con conocimientos técnicos podría leerlos igual consultando Firestore directo
// (decisión tomada con Elías: el motivo de un cambio de turno no es un dato sensible al
// nivel de justificar una restricción de servidor). Esta pantalla ahora sí aparece en el
// menú para los cuatro roles (ver turnero/index.html). Además de las cuatro acciones de
// siempre, cada fila tiene un enlace "Reimprimir" que abre comprobante-turno.html — ese
// comprobante reemplaza la necesidad de un listado propio de comprobantes: este mismo
// historial hace las veces de listado filtrable que pide el punto 14 del alcance.
//
// Diseño de los filtros: SEIS modos MUTUAMENTE EXCLUYENTES (uno a la vez, agregado "por
// sede" en la Etapa T8), mismo criterio que ya usa medicacion/historial.js para
// entregas/egresos — evita depender de índices compuestos innecesarios.
// "Recientes"/"Por médico"/"Por paciente"/"Por sede" traen los CUATRO estados (activo,
// reasignado, modificado, cancelado); "Por tipo de acción" los separa uno por uno,
// incluido "Otorgado" (estado "activo", el turno tal como quedó, sin ningún cambio
// posterior); "Por rango de fechas" filtra por la fecha del TURNO (ver más abajo), no
// por estado.
//
// Índices de Firestore que Firebase puede llegar a pedir la primera vez que se usa cada
// filtro (mismo aviso que ya deja medicacion/historial.js): la consola del navegador
// (F12) trae un enlace directo para crearlos con un clic la primera vez que hace falta.
//
// Campos de fecha usados (dos, con propósitos distintos — no confundirlos):
// - "creadoEn": cuándo se cargó ESTE documento (alta original o el turno de reemplazo
//   de una reasignación/modificación). Lo tiene el 100% de los turnos. Es el campo de
//   orden por defecto en Recientes/Por tipo/Por médico/Por paciente/Por sede, y el que
//   se muestra en la columna "Cuándo" — pero SOLO para un turno "activo" (otorgado,
//   nunca tocado). El campo de orden real para paginar sigue siendo "creadoEn" siempre,
//   así la paginación no se rompe por documentos sin "anuladoEn".
// - "fecha": la fecha PARA LA QUE está programado el turno (la que ve el paciente).
//   Confirmado con Elías: el filtro "por rango de fechas" usa este campo, no "creadoEn"
//   ni "anuladoEn" — responde "qué turnos hay/hubo en tal semana", mezclando los cuatro
//   estados. Al filtrar por "fecha" hace falta ordenar también por "fecha" (Firestore
//   exige que el primer orderBy coincida con el campo del filtro por rango) — es el
//   único modo que no ordena por "creadoEn". Ajuste post-entrega de la Etapa T8: para un
//   turno reasignado/modificado/cancelado, la columna "Cuándo" también pasó a mostrar
//   este campo (en vez de "anuladoEn") — mostrar la fecha/hora exacta del cambio al lado
//   de la fecha del turno, con formatos y valores distintos, resultaba confuso. Esa
//   fecha/hora del cambio sigue disponible en "Ver cadena completa" y, para
//   administrador/enfermería, en el propio comprobante reimpreso.
//
// Etapa T11 — reporte de cambios (sección nueva al pie de esta misma pantalla, solo
// administrador, punto 12 del alcance): a diferencia de TODO lo de arriba, esta consulta
// sí usa "anuladoEn" con un filtro de rango, precisamente porque acá la pregunta es "qué
// cambios ocurrieron esta semana", no "qué turnos había programados esta semana". El
// campo "anuladoEn" solo existe en turnos reasignados/modificados/cancelados (nunca en
// uno "activo" — ver anularYCrearTurnoGrilla() en turnero-grilla.js, que lo excluye
// explícitamente de los campos copiados al turno nuevo), así que el filtro de rango solo
// ya alcanza para traer exactamente esos tres tipos, sin necesitar además un "where"
// sobre "estado". Al ser un filtro de rango sobre un único campo (no combinado con
// igualdad/"in" sobre otro), no debería hacer falta crear un índice compuesto nuevo en
// Firestore.

const TAMANO_PAGINA_HISTORIAL_TURNOS = 25;

const ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS = {
  activo: "Otorgado",
  reasignado: "Reasignado",
  modificado: "Modificado",
  cancelado: "Cancelado"
};

// Mismos tokens de color que ya define css/styles.css (--color-accent, --color-accent-secondary,
// --color-danger, y sus variantes "-soft") — sin agregar clases nuevas a la hoja de estilos,
// mismo criterio que ya usó turnero-grilla.js para el botón "Eliminar" (estilo inline sobre
// la clase genérica ".badge"). "activo"/"Otorgado" no lleva estilo propio: usa el gris
// neutro por defecto de ".badge", porque es el estado de base, no un cambio a destacar.
const ESTILOS_BADGE_TIPO_ACCION_HISTORIAL_TURNOS = {
  reasignado: "background:var(--color-accent-soft);color:var(--color-accent);border-color:var(--color-accent-soft);",
  modificado: "background:var(--color-accent-secondary-soft);color:#3b6d11;border-color:var(--color-accent-secondary-soft);",
  cancelado: "background:var(--color-danger-soft);color:var(--color-danger);border-color:var(--color-danger-soft);"
};

let usuarioActualHistorialTurnos = null;
let datosUsuarioActualHistorialTurnos = null;
let rolActualHistorialTurnos = null;

let estadoFiltroHistorialTurnos = {
  modo: "recientes", // recientes | tipo | medico | paciente | fecha | sede
  tipoAccion: null,
  medicoId: null,
  medicoEsOtro: false,
  pacienteId: null,
  fechaDesde: null,
  fechaHasta: null,
  sedeId: null
};

// Etapa T8: qué tan restringida queda la vista según el rol. Administrador/enfermería
// ven todo, igual que antes de esta etapa; médico/administrativo ven los mismos turnos
// pero sin las columnas de motivo y quién hizo el cambio.
let mostrarMotivoUsuarioHistorialTurnos = true;
let columnasVisiblesHistorialTurnos = 8;

// Etiquetas y direcciones de sede — duplicadas a propósito de turnero-carga.js (mismo
// criterio de independencia por página que ya usa el resto del archivo).
const SEDES_HISTORIAL_TURNOS = [
  { id: "emilio-civit", nombre: "Emilio Civit" },
  { id: "entre-rios", nombre: "Entre Ríos" }
];

let cursorHistorialTurnos = null;
let hayMasHistorialTurnos = true;
let cargandoHistorialTurnos = false;

// Etapa T11 — reporte de cambios: guarda el último resultado traído de Firestore para que
// "Exportar a Excel" no tenga que repetir la consulta (a diferencia del historial general,
// acá no hay paginación — el rango de fechas ya acota el volumen).
let ultimosDocsReporteCambiosHistorialTurnos = [];

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

  // Etapa T8: administrador/enfermería ven motivo y quién hizo el cambio, igual que
  // antes; médico/administrativo ven el resto de la fila (incluido el badge de tipo de
  // acción) pero sin esas dos columnas.
  mostrarMotivoUsuarioHistorialTurnos = rolActualHistorialTurnos === "administrador" || rolActualHistorialTurnos === "enfermeria";
  columnasVisiblesHistorialTurnos = mostrarMotivoUsuarioHistorialTurnos ? 8 : 6;
  if (!mostrarMotivoUsuarioHistorialTurnos) {
    const thMotivo = document.getElementById("th-motivo-historial-turnos");
    const thQuien = document.getElementById("th-quien-historial-turnos");
    if (thMotivo) thMotivo.style.display = "none";
    if (thQuien) thQuien.style.display = "none";
  }

  // Etapa T11: reporte de cambios, exclusivo de administrador (punto 12 del alcance) —
  // ni enfermería, que sí ve motivo/quién en la tabla de arriba, ve esta sección.
  if (rolActualHistorialTurnos === "administrador") {
    document.getElementById("bloque-reporte-cambios-historial-turnos").style.display = "block";
  }

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
  document.getElementById("bloque-filtro-sede").style.display = modo === "sede" ? "block" : "none";

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
    return;
  }
  if (modo === "sede") {
    if (estadoFiltroHistorialTurnos.sedeId) {
      cargarPaginaHistorialTurnos(true);
    } else {
      mostrarPlaceholderHistorialTurnos("Elegí una sede.");
    }
  }
}

function mostrarPlaceholderHistorialTurnos(texto) {
  document.getElementById("cuerpo-tabla-historial-turnos").innerHTML =
    `<tr><td colspan="${columnasVisiblesHistorialTurnos}" style="color:var(--color-muted);padding:16px 6px;">${texto}</td></tr>`;
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

// --- Filtro "por sede" (Etapa T8) ---

function aplicarFiltroSedeHistorialTurnos(valor) {
  estadoFiltroHistorialTurnos.sedeId = valor || null;
  if (!valor) {
    mostrarPlaceholderHistorialTurnos("Elegí una sede.");
    return;
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

// --- Filtro "por rango de fechas" (sobre "fecha" DEL TURNO, no sobre cuándo se cargó o
// cambió el registro — ver nota al principio del archivo) ---

function aplicarFiltroFechaHistorialTurnos() {
  const desde = document.getElementById("campo-filtro-fecha-desde-historial-turnos").value;
  const hasta = document.getElementById("campo-filtro-fecha-hasta-historial-turnos").value;

  if (!desde || !hasta) {
    alert("Completá las dos fechas.");
    return;
  }
  if (desde > hasta) {
    alert('La fecha "desde" no puede ser posterior a la fecha "hasta".');
    return;
  }

  // "fecha" se guarda como string "YYYY-MM-DD" (ver turnero-motor.js, fechaISO()): mismo
  // formato que ya devuelve <input type="date">, así que se compara tal cual, sin pasar
  // por Date — la comparación lexicográfica de un ISO con ceros a la izquierda ya
  // ordena cronológicamente.
  estadoFiltroHistorialTurnos.fechaDesde = desde;
  estadoFiltroHistorialTurnos.fechaHasta = hasta;
  cargarPaginaHistorialTurnos(true);
}

// --- Construcción y ejecución de la consulta paginada ---

function construirConsultaHistorialTurnos(paraExportar) {
  let consulta = db.collection("turnos");
  let ordenarPor = "creadoEn";

  if (estadoFiltroHistorialTurnos.modo === "tipo" && estadoFiltroHistorialTurnos.tipoAccion) {
    consulta = consulta.where("estado", "==", estadoFiltroHistorialTurnos.tipoAccion);
  }
  // "recientes"/"medico"/"paciente" no agregan filtro de estado: traen los cuatro
  // (otorgado, reasignado, modificado, cancelado).

  if (estadoFiltroHistorialTurnos.modo === "medico") {
    if (estadoFiltroHistorialTurnos.medicoEsOtro) {
      consulta = consulta.where("esMedicoOtro", "==", true);
    } else if (estadoFiltroHistorialTurnos.medicoId) {
      consulta = consulta.where("medicoId", "==", estadoFiltroHistorialTurnos.medicoId);
    }
  } else if (estadoFiltroHistorialTurnos.modo === "paciente" && estadoFiltroHistorialTurnos.pacienteId) {
    consulta = consulta.where("paciente.id", "==", estadoFiltroHistorialTurnos.pacienteId);
  } else if (estadoFiltroHistorialTurnos.modo === "fecha" && estadoFiltroHistorialTurnos.fechaDesde && estadoFiltroHistorialTurnos.fechaHasta) {
    // Filtro por rango + orderBy: Firestore exige que el primer orderBy coincida con el
    // campo del filtro por rango — por eso este modo, único, ordena por "fecha" y no
    // por "creadoEn".
    consulta = consulta
      .where("fecha", ">=", estadoFiltroHistorialTurnos.fechaDesde)
      .where("fecha", "<=", estadoFiltroHistorialTurnos.fechaHasta);
    ordenarPor = "fecha";
  } else if (estadoFiltroHistorialTurnos.modo === "sede" && estadoFiltroHistorialTurnos.sedeId) {
    consulta = consulta.where("sedeId", "==", estadoFiltroHistorialTurnos.sedeId);
  }

  consulta = consulta.orderBy(ordenarPor, "desc");

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
    tbody.innerHTML = `<tr><td colspan="${columnasVisiblesHistorialTurnos}" style="color:var(--color-muted);">Cargando...</td></tr>`;
  }
  botonMas.disabled = true;
  botonMas.textContent = "Cargando...";

  try {
    const snapshot = await construirConsultaHistorialTurnos(false).get();

    if (reset) tbody.innerHTML = "";

    if (snapshot.empty && reset) {
      tbody.innerHTML = `<tr><td colspan="${columnasVisiblesHistorialTurnos}" style="color:var(--color-muted);padding:16px 6px;">No hay registros con ese filtro.</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="${columnasVisiblesHistorialTurnos}" style="color:var(--color-danger);padding:16px 6px;">
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
  const esActivo = d.estado === "activo";
  // Ajuste post-entrega, a pedido de Elías: un turno "activo" (otorgado, nunca tocado)
  // sigue mostrando cuándo se CARGÓ (creadoEn, con hora). Uno ya anulado/reasignado/
  // modificado/cancelado, en cambio, muestra la fecha DEL TURNO — la misma que ya
  // aparece en la columna "Turno" — en vez de la fecha/hora exacta en que se hizo el
  // cambio (que quedaba confusa al lado de la fecha del turno, con formatos y valores
  // distintos). Esa fecha/hora del cambio sigue disponible igual: aparece en "Ver
  // cadena completa" y, para administrador/enfermería, en el propio comprobante
  // reimpreso (aviso de reasignado/modificado/cancelado).
  const cuandoTexto = esActivo
    ? formatearFechaHoraHistorialTurnos(d.creadoEn)
    : escaparHtml(d.fecha || "-");

  // Etapa T8: motivo y quién hizo el cambio solo se arman si el rol puede verlos —
  // médico/administrativo directamente no reciben esas dos celdas (los <th> ya quedaron
  // ocultos en iniciarHistorialTurnos()).
  const celdasMotivoQuien = mostrarMotivoUsuarioHistorialTurnos
    ? `
    <td>${esActivo ? "—" : escaparHtml(d.motivoCambio || "-")}</td>
    <td>${esActivo ? "—" : escaparHtml((d.anuladoPor && d.anuladoPor.nombre) || "-")}</td>`
    : "";

  tr.innerHTML = `
    <td>${cuandoTexto}</td>
    <td>${badgeTipoAccionHistorialTurnos(d.estado)}</td>
    <td>${escaparHtml(d.fecha || "-")}<br><span style="color:var(--color-muted);font-size:12px;">${escaparHtml(d.horarioInicio || "-")}–${escaparHtml(d.horarioFin || "-")}</span></td>
    <td>${escaparHtml(paciente.apellido || "")}, ${escaparHtml(paciente.nombre || "")}</td>
    <td>${escaparHtml(d.medicoNombre || "-")}</td>
    ${celdasMotivoQuien}
    <td class="acciones-fila"></td>
  `;

  const celdaAcciones = tr.querySelector(".acciones-fila");

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "enlace-accion";
  boton.textContent = "Ver cadena completa";
  boton.addEventListener("click", () => abrirCadenaHistorialTurnos(id));
  celdaAcciones.appendChild(boton);


  // Etapa T8: reimprime el comprobante de ESTE turno puntual (no necesariamente el
  // vigente de la cadena) — mismo criterio que "Reimprimir" en medicacion/historial.js,
  // un enlace liso que abre comprobante-turno.html en pestaña nueva, con impresión
  // automática ya resuelta ahí adentro.
  const enlaceReimprimir = document.createElement("a");
  enlaceReimprimir.className = "enlace-accion";
  enlaceReimprimir.href = `comprobante-turno.html?id=${id}`;
  enlaceReimprimir.target = "_blank";
  enlaceReimprimir.textContent = "Reimprimir";
  enlaceReimprimir.style.marginLeft = "10px";
  celdaAcciones.appendChild(enlaceReimprimir);

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
      const esActivo = d.estado === "activo";
      // Mismo criterio que en pantalla (ver filaHistorialTurnos): activo muestra cuándo
      // se cargó, el resto muestra la fecha del turno en vez de la fecha/hora del cambio.
      const cuandoTexto = esActivo ? formatearFechaHoraHistorialTurnos(d.creadoEn) : (d.fecha || "");
      const fila = {
        "Cuándo": cuandoTexto,
        "Tipo de acción": ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS[d.estado] || d.estado,
        "Fecha del turno": d.fecha || "",
        "Horario": `${d.horarioInicio || ""}–${d.horarioFin || ""}`,
        "Paciente": `${paciente.apellido || ""}, ${paciente.nombre || ""}`,
        Documento: paciente.numeroDocumento || "",
        Médico: d.medicoNombre || ""
      };
      // Etapa T8: mismo criterio que las columnas de la tabla en pantalla — médico y
      // administrativo no exportan motivo ni quién hizo el cambio.
      if (mostrarMotivoUsuarioHistorialTurnos) {
        fila.Motivo = esActivo ? "" : (d.motivoCambio || "");
        fila["Realizado por"] = esActivo ? "" : ((d.anuladoPor && d.anuladoPor.nombre) || "");
      }
      return fila;
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

// --- Etapa T11: reporte de cambios (solo administrador) ---

// Arma un Date en horario local a partir de un input type="date" (string "YYYY-MM-DD"),
// evitando el corrimiento de día que da parsear ese string directo con `new Date(iso)`
// (lo interpreta en UTC) — mismo problema ya resuelto en turnero-motor.js/
// turnero-bloqueos.js para este mismo formato.
function fechaLocalDesdeInputReporteCambiosHistorialTurnos(valorInput, finDelDia) {
  const [anio, mes, dia] = valorInput.split("-").map(Number);
  return finDelDia
    ? new Date(anio, mes - 1, dia, 23, 59, 59, 999)
    : new Date(anio, mes - 1, dia, 0, 0, 0, 0);
}

function formatearFechaCortaReporteCambiosHistorialTurnos(valorInput) {
  const [anio, mes, dia] = valorInput.split("-");
  return `${dia}/${mes}/${anio}`;
}

async function generarReporteCambiosHistorialTurnos() {
  const desdeInput = document.getElementById("campo-reporte-cambios-desde").value;
  const hastaInput = document.getElementById("campo-reporte-cambios-hasta").value;
  const contenedor = document.getElementById("resultado-reporte-cambios-historial-turnos");
  const botonGenerar = document.getElementById("boton-generar-reporte-cambios");
  const botonExportar = document.getElementById("boton-exportar-reporte-cambios");

  if (!desdeInput || !hastaInput) {
    alert("Completá las dos fechas.");
    return;
  }
  if (desdeInput > hastaInput) {
    alert('La fecha "desde" no puede ser posterior a la fecha "hasta".');
    return;
  }

  botonGenerar.disabled = true;
  botonExportar.disabled = true;
  ultimosDocsReporteCambiosHistorialTurnos = [];
  contenedor.innerHTML = "Buscando...";

  const desdeTimestamp = firebase.firestore.Timestamp.fromDate(
    fechaLocalDesdeInputReporteCambiosHistorialTurnos(desdeInput, false)
  );
  const hastaTimestamp = firebase.firestore.Timestamp.fromDate(
    fechaLocalDesdeInputReporteCambiosHistorialTurnos(hastaInput, true)
  );

  try {
    // Sin filtro de "estado": ver nota al comienzo del archivo — "anuladoEn" solo existe
    // en turnos reasignados/modificados/cancelados, así que el rango ya trae exactamente
    // esos tres tipos.
    const snapshot = await db.collection("turnos")
      .where("anuladoEn", ">=", desdeTimestamp)
      .where("anuladoEn", "<=", hastaTimestamp)
      .orderBy("anuladoEn", "desc")
      .get();

    ultimosDocsReporteCambiosHistorialTurnos = snapshot.docs.map((doc) => doc.data());
    renderizarReporteCambiosHistorialTurnos(ultimosDocsReporteCambiosHistorialTurnos, desdeInput, hastaInput);
    botonExportar.disabled = ultimosDocsReporteCambiosHistorialTurnos.length === 0;
  } catch (error) {
    console.error("Error al generar el reporte de cambios:", error);
    contenedor.innerHTML =
      '<div style="color:var(--color-danger);">No se pudo generar el reporte. Mirá la consola del navegador (F12) — puede faltar crear un índice en Firestore.</div>';
  } finally {
    botonGenerar.disabled = false;
  }
}

// Etapa T12: crea un elemento con texto plano (nunca HTML interpretado), atributos y
// clases opcionales. Reemplaza al patrón innerHTML+escaparHtml que usaba antes esta
// función — CodeQL marcaba esa combinación como "DOM text reinterpreted as HTML" (alerta
// #7) porque no reconoce escaparHtml() como una sanitización válida, aunque en la
// práctica ya escapaba todo correctamente. Construir el DOM así resuelve la alerta de
// raíz en vez de dejarla documentada como falso positivo.
function crearElementoTexto(tag, texto, opciones) {
  const el = document.createElement(tag);
  if (texto != null) el.textContent = texto;
  if (opciones && opciones.className) el.className = opciones.className;
  if (opciones && opciones.style) el.style.cssText = opciones.style;
  return el;
}

function renderizarReporteCambiosHistorialTurnos(docs, desdeInput, hastaInput) {
  const contenedor = document.getElementById("resultado-reporte-cambios-historial-turnos");
  contenedor.innerHTML = "";

  if (docs.length === 0) {
    contenedor.appendChild(
      crearElementoTexto("p", "No hubo reasignaciones, modificaciones ni cancelaciones en ese rango.")
    );
    return;
  }

  // Por persona (anuladoPor.nombre, tal cual quedó guardado — sin filtrar por rol actual,
  // decisión explícita de Elías) × tipo de acción. Por motivo: texto exacto de
  // "motivoCambio", sin normalizar (motivo libre, decisión explícita de Elías — agrupar
  // por texto exacto puede no discriminar mucho hasta que haya datos reales de uso).
  const porPersona = new Map();
  const porMotivo = new Map();
  const totales = { reasignado: 0, modificado: 0, cancelado: 0 };

  docs.forEach((d) => {
    const nombre = (d.anuladoPor && d.anuladoPor.nombre) || "Sin usuario registrado";
    const tipo = d.estado;
    if (!porPersona.has(nombre)) {
      porPersona.set(nombre, { reasignado: 0, modificado: 0, cancelado: 0 });
    }
    const fila = porPersona.get(nombre);
    if (fila[tipo] !== undefined) fila[tipo]++;
    if (totales[tipo] !== undefined) totales[tipo]++;

    const motivo = (d.motivoCambio || "").trim() || "(sin motivo)";
    porMotivo.set(motivo, (porMotivo.get(motivo) || 0) + 1);
  });

  const totalGeneral = docs.length;

  const filasPersona = [...porPersona.entries()]
    .map(([nombre, c]) => ({ nombre, ...c, total: c.reasignado + c.modificado + c.cancelado }))
    .sort((a, b) => b.total - a.total);

  const filasMotivo = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]);

  const plural = (n, singular, pluralForm) => (n === 1 ? singular : pluralForm);

  // --- Resumen ---
  const resumen = crearElementoTexto("div", null, { style: "font-size:13px;color:var(--color-muted);" });
  resumen.textContent =
    `${totalGeneral} ${plural(totalGeneral, "cambio", "cambios")} entre el ` +
    `${formatearFechaCortaReporteCambiosHistorialTurnos(desdeInput)} y el ` +
    `${formatearFechaCortaReporteCambiosHistorialTurnos(hastaInput)}: ` +
    `${totales.reasignado} ${plural(totales.reasignado, "reasignado", "reasignados")}, ` +
    `${totales.modificado} ${plural(totales.modificado, "modificado", "modificados")}, ` +
    `${totales.cancelado} ${plural(totales.cancelado, "cancelado", "cancelados")}.`;
  contenedor.appendChild(resumen);

  // --- Tabla "por quién hizo el cambio" ---
  contenedor.appendChild(
    crearElementoTexto("div", "por quién hizo el cambio", { className: "titulo-bloque", style: "margin-top:20px;" })
  );
  const wrapPersona = crearElementoTexto("div", null, { style: "overflow-x:auto;" });
  const tablaPersona = document.createElement("table");
  tablaPersona.className = "tabla";

  const theadPersona = document.createElement("thead");
  const filaEncabezadoPersona = document.createElement("tr");
  ["Persona", "Reasignado", "Modificado", "Cancelado", "Total"].forEach((titulo) => {
    filaEncabezadoPersona.appendChild(crearElementoTexto("th", titulo));
  });
  theadPersona.appendChild(filaEncabezadoPersona);
  tablaPersona.appendChild(theadPersona);

  const tbodyPersona = document.createElement("tbody");
  filasPersona.forEach((f) => {
    const tr = document.createElement("tr");
    tr.appendChild(crearElementoTexto("td", f.nombre));
    tr.appendChild(crearElementoTexto("td", String(f.reasignado)));
    tr.appendChild(crearElementoTexto("td", String(f.modificado)));
    tr.appendChild(crearElementoTexto("td", String(f.cancelado)));
    const tdTotal = document.createElement("td");
    tdTotal.appendChild(crearElementoTexto("strong", String(f.total)));
    tr.appendChild(tdTotal);
    tbodyPersona.appendChild(tr);
  });

  const trTotales = document.createElement("tr");
  trTotales.style.cssText = "border-top:2px solid var(--color-border);";
  const tdTituloTotal = document.createElement("td");
  tdTituloTotal.appendChild(crearElementoTexto("strong", "Total"));
  trTotales.appendChild(tdTituloTotal);
  [totales.reasignado, totales.modificado, totales.cancelado, totalGeneral].forEach((valor) => {
    const td = document.createElement("td");
    td.appendChild(crearElementoTexto("strong", String(valor)));
    trTotales.appendChild(td);
  });
  tbodyPersona.appendChild(trTotales);
  tablaPersona.appendChild(tbodyPersona);
  wrapPersona.appendChild(tablaPersona);
  contenedor.appendChild(wrapPersona);

  // --- Tabla "por motivo" ---
  contenedor.appendChild(
    crearElementoTexto("div", "por motivo", { className: "titulo-bloque", style: "margin-top:24px;" })
  );
  const wrapMotivo = crearElementoTexto("div", null, { style: "overflow-x:auto;" });
  const tablaMotivo = document.createElement("table");
  tablaMotivo.className = "tabla";

  const theadMotivo = document.createElement("thead");
  const filaEncabezadoMotivo = document.createElement("tr");
  ["Motivo", "Cantidad"].forEach((titulo) => {
    filaEncabezadoMotivo.appendChild(crearElementoTexto("th", titulo));
  });
  theadMotivo.appendChild(filaEncabezadoMotivo);
  tablaMotivo.appendChild(theadMotivo);

  const tbodyMotivo = document.createElement("tbody");
  filasMotivo.forEach(([motivo, cant]) => {
    const tr = document.createElement("tr");
    tr.appendChild(crearElementoTexto("td", motivo));
    tr.appendChild(crearElementoTexto("td", String(cant)));
    tbodyMotivo.appendChild(tr);
  });
  tablaMotivo.appendChild(tbodyMotivo);
  wrapMotivo.appendChild(tablaMotivo);
  contenedor.appendChild(wrapMotivo);
}

function exportarReporteCambiosHistorialTurnosAExcel() {
  if (ultimosDocsReporteCambiosHistorialTurnos.length === 0) {
    alert("No hay datos para exportar. Generá el reporte primero.");
    return;
  }

  // Listado crudo, un cambio por fila — mismo criterio que exportarHistorialTurnosAExcel()
  // más abajo, pero con "Cuándo" mostrando siempre la fecha/hora del cambio (acá los tres
  // tipos de fila SON cambios, a diferencia del historial general que también exporta
  // turnos "activo").
  const filas = ultimosDocsReporteCambiosHistorialTurnos.map((d) => {
    const paciente = d.paciente || {};
    return {
      "Cuándo": formatearFechaHoraHistorialTurnos(d.anuladoEn),
      "Tipo de acción": ETIQUETAS_TIPO_ACCION_HISTORIAL_TURNOS[d.estado] || d.estado,
      Motivo: d.motivoCambio || "",
      "Realizado por": (d.anuladoPor && d.anuladoPor.nombre) || "",
      "Fecha del turno": d.fecha || "",
      Paciente: `${paciente.apellido || ""}, ${paciente.nombre || ""}`,
      Médico: d.medicoNombre || ""
    };
  });

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Reporte de cambios");

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `reporte_cambios_turnos_${fecha}.xlsx`);
}

// Exporta la función pura para poder probarla en Node (mismo criterio que ya usa
// turnero-motor.js con validarModificacionTurno, etc.). No exporta nada más porque el
// resto del archivo depende del DOM y de Firestore.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ordenarCadenaDesdeMapa };
}
