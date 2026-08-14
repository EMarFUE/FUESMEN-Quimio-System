// Lógica de la pantalla de historial (etapa 8, ampliada en la etapa 9).
// No depende de entregas.js, egresos.js, pacientes.js ni medicamentos.js: misma
// independencia por página que ya usa el resto del sistema.
//
// Criterio de carga (ver Handoff_etapa_8.md): "entregas" y "egresos" crecen todos los
// días sin techo, así que acá NO se trae toda la colección de una vez. Se pagina con
// consultas a Firestore ordenadas por fecha (de a TAMANO_PAGINA registros, con "cargar
// más"), y los filtros disparan su propia consulta acotada en vez de filtrar sobre lo
// ya traído al navegador. Los cuatro modos de filtro son mutuamente excluyentes -uno a
// la vez- para no depender de índices compuestos innecesarios.
//
// Novedad de la etapa 9: además de filtrar, se puede solicitar la corrección o
// anulación de una fila. Esto NO aplica ningún cambio a "entregas"/"egresos"/"stock"
// desde acá — solo crea un documento en "correcciones" con estado "pendiente". El
// efecto real (revertir stock, marcar el original como anulado, crear el reemplazo
// corregido) lo aplica el administrador desde la pantalla de aprobación, que se agrega
// en una ronda aparte.
//
// Índices de Firestore que este archivo puede llegar a pedir la primera vez que se usa
// cada filtro (Firestore tira un enlace directo en la consola del navegador, F12, para
// crearlos con un clic): los mismos cuatro que ya se crearon para "entregas" en la
// etapa 8 (paciente.id+creadoEn, ciclo+creadoEn, sesion+creadoEn, ciclo+sesion+creadoEn)
// hacen falta OTRA VEZ, por separado, para "egresos" — los índices son por colección,
// no se comparten. La primera vez que se use cada filtro con la pestaña "Tratamientos"
// activa, va a hacer falta crear su propio índice igual que se hizo para "entregas".

const TAMANO_PAGINA = 25;

// Encabezados y cantidad de columnas de la tabla según la colección activa.
const CONFIG_COLECCION = {
  entregas: {
    columnas: ["Fecha", "Paciente", "Depósito", "Tipo", "Tratamiento vinculado", "N.° comprobante", ""],
    colspan: 7
  },
  egresos: {
    columnas: ["Fecha", "Paciente", "Depósito", "Ciclo / sesión", "Origen", ""],
    colspan: 6
  }
};

// Mismo listado fijo que usa entregas.js, para armar las líneas de medicamento del
// formulario de corrección de una entrega (no depende de stock existente, a diferencia
// de egresos).
const UNIDADES_MEDIDA_CORRECCION = [
  { value: "g", label: "gramo" },
  { value: "cc", label: "centímetro cúbico" },
  { value: "mg", label: "miligramo" }
];

let estadoFiltroHistorial = {
  coleccion: "entregas", // entregas | egresos (etapa 9)
  modo: "recientes", // recientes | paciente | ciclo-sesion | fecha
  pacienteId: null,
  ciclo: null,
  sesion: null,
  fechaDesde: null,
  fechaHasta: null
};

let cursorHistorial = null;
let hayMasHistorial = true;
let cargandoHistorial = false;

let pacientesCacheHistorial = null; // null = todavía no se cargó
let cargandoPacientesHistorial = false;

// --- Nuevo en la etapa 9 ---

let usuarioActualHistorial = null;
let datosUsuarioActualHistorial = null;
let rolActualHistorial = null;

let medicamentosCacheHistorial = null; // catálogo completo, para el formulario de corrección
let stockCacheHistorialCorreccion = null; // stock del depósito elegido en el formulario de corrección de un egreso
let depositoStockCacheHistorial = null; // qué depósito corresponde al cache anterior

let panelDatosOriginales = null; // datos del documento que se está corrigiendo, mientras el panel está abierto
let correccionPacienteSeleccionado = null;
let contadorFilasMedCorreccion = 0;
let enviandoCorreccion = false;
let temporizadorBusquedaDocumentoHistorial = null;

// --- Cache de pacientes en localStorage (etapa 10) ---
// Misma clave y mismo criterio que entregas.js/egresos.js: vence por día, no por
// minutos, y se comparte entre las pestañas abiertas en la misma computadora. Acá
// además alimenta la búsqueda interna del panel de corrección (buscarPacienteCorreccion),
// que ya usaba pacientesCacheHistorial sin ningún cambio adicional.
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

function soloDigitos(texto) {
  return (texto || "").toString().replace(/\D/g, "");
}

function capitalizarPalabras(texto) {
  return (texto || "")
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase())
    .join(" ");
}

function formatearFechaHora(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// Escapa texto libre antes de insertarlo con innerHTML (nombre/apellido de paciente y
// de quien entrega, droga/marca, motivo, comentario de resolución). Mismo patrón ya
// usado en medicamentos.js desde la etapa 3.
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function mostrarMensajeGeneralHistorial(texto, tipo) {
  const el = document.getElementById("mensaje-general-historial");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

// Exclusivo enfermería (ver Handoff/sección 3.10): el administrador no solicita
// correcciones, solo las aprueba o rechaza desde la pantalla de aprobación.
function puedeSolicitarCorreccion() {
  return rolActualHistorial === "enfermeria";
}

// Cierra el modal al hacer click en el fondo (fuera de .modal-panel) o al presionar
// Escape. Se configura una sola vez, al iniciar la pantalla.
function configurarCierreModalCorreccion() {
  const panel = document.getElementById("panel-solicitud-correccion");
  panel.addEventListener("click", (e) => {
    if (e.target === panel) cerrarSolicitudCorreccion();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.style.display !== "none") cerrarSolicitudCorreccion();
  });
}

function iniciarHistorial(user, datosUsuario) {
  usuarioActualHistorial = user;
  datosUsuarioActualHistorial = datosUsuario;
  rolActualHistorial = datosUsuario.rol;

  configurarSelectorColeccion();
  configurarTabsHistorial();
  renderizarEncabezadoHistorial();

  document.getElementById("campo-buscar-paciente-historial").addEventListener("input", (e) => buscarPacienteHistorial(e.target.value));
  document.getElementById("campo-filtro-ciclo").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });
  document.getElementById("campo-filtro-sesion").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });
  configurarCierreModalCorreccion();

  // No se espera esta carga: la página ya se reveló (o está por revelarse) sin
  // depender de ella.
  cargarPaginaHistorial(true);
}

function configurarSelectorColeccion() {
  document.querySelectorAll("#selector-coleccion .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => cambiarColeccionHistorial(btn.dataset.coleccion));
  });
}

function configurarTabsHistorial() {
  document.querySelectorAll("#filtro-tabs .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => cambiarModoFiltroHistorial(btn.dataset.modo));
  });
}

function cambiarColeccionHistorial(coleccion) {
  if (estadoFiltroHistorial.coleccion === coleccion) return;
  estadoFiltroHistorial.coleccion = coleccion;
  cerrarSolicitudCorreccion();

  document.querySelectorAll("#selector-coleccion .filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.coleccion === coleccion);
  });

  renderizarEncabezadoHistorial();
  // Al cambiar de colección se reinicia a la vista por defecto: los filtros de
  // paciente/ciclo-sesión/fecha ya elegidos se mantienen guardados en el estado, pero
  // conviene arrancar mostrando "recientes" de la colección nueva en vez de disparar
  // de entrada un filtro que quizás no tenga sentido para lo que se acaba de elegir.
  cambiarModoFiltroHistorial("recientes");
}

function renderizarEncabezadoHistorial() {
  const fila = document.getElementById("fila-encabezado-historial");
  fila.innerHTML = CONFIG_COLECCION[estadoFiltroHistorial.coleccion].columnas
    .map((c) => `<th>${c}</th>`)
    .join("");
}

function cambiarModoFiltroHistorial(modo) {
  estadoFiltroHistorial.modo = modo;

  document.querySelectorAll("#filtro-tabs .filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  document.getElementById("bloque-filtro-paciente").style.display = modo === "paciente" ? "block" : "none";
  document.getElementById("bloque-filtro-ciclo-sesion").style.display = modo === "ciclo-sesion" ? "block" : "none";
  document.getElementById("bloque-filtro-fecha").style.display = modo === "fecha" ? "block" : "none";

  if (modo === "recientes") {
    cargarPaginaHistorial(true);
    return;
  }

  if (modo === "paciente") {
    cargarPacientesHistorialSiHaceFalta();
    if (estadoFiltroHistorial.pacienteId) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Elegí un paciente para ver su historial.");
    }
    return;
  }

  if (modo === "ciclo-sesion") {
    if (estadoFiltroHistorial.ciclo || estadoFiltroHistorial.sesion) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Completá ciclo, sesión, o los dos, y presioná «Buscar».");
    }
    return;
  }

  if (modo === "fecha") {
    if (estadoFiltroHistorial.fechaDesde && estadoFiltroHistorial.fechaHasta) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Completá el rango de fechas y presioná «Buscar».");
    }
  }
}

function mostrarPlaceholderHistorial(texto) {
  const colspan = CONFIG_COLECCION[estadoFiltroHistorial.coleccion].colspan;
  document.getElementById("cuerpo-tabla-historial").innerHTML =
    `<tr><td colspan="${colspan}" style="color:var(--color-muted);padding:16px 6px;">${texto}</td></tr>`;
  document.getElementById("zona-cargar-mas").style.display = "none";
}

// --- Construcción y ejecución de la consulta paginada ---

function construirConsultaHistorial() {
  let consulta = db.collection(estadoFiltroHistorial.coleccion);

  if (estadoFiltroHistorial.modo === "paciente") {
    consulta = consulta.where("paciente.id", "==", estadoFiltroHistorial.pacienteId);
  } else if (estadoFiltroHistorial.modo === "ciclo-sesion") {
    if (estadoFiltroHistorial.ciclo) {
      consulta = consulta.where("ciclo", "==", estadoFiltroHistorial.ciclo);
    }
    if (estadoFiltroHistorial.sesion) {
      consulta = consulta.where("sesion", "==", estadoFiltroHistorial.sesion);
    }
  } else if (estadoFiltroHistorial.modo === "fecha") {
    consulta = consulta
      .where("creadoEn", ">=", estadoFiltroHistorial.fechaDesde)
      .where("creadoEn", "<=", estadoFiltroHistorial.fechaHasta);
  }

  consulta = consulta.orderBy("creadoEn", "desc").limit(TAMANO_PAGINA);
  if (cursorHistorial) consulta = consulta.startAfter(cursorHistorial);
  return consulta;
}

async function cargarPaginaHistorial(reset) {
  if (cargandoHistorial) return;
  cargandoHistorial = true;

  const tbody = document.getElementById("cuerpo-tabla-historial");
  const botonMas = document.getElementById("boton-cargar-mas");
  const colspan = CONFIG_COLECCION[estadoFiltroHistorial.coleccion].colspan;

  if (reset) {
    cursorHistorial = null;
    hayMasHistorial = true;
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="color:var(--color-muted);">Cargando...</td></tr>`;
  }
  botonMas.disabled = true;
  botonMas.textContent = "Cargando...";

  try {
    const snapshot = await construirConsultaHistorial().get();

    if (reset) tbody.innerHTML = "";

    if (snapshot.empty && reset) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" style="color:var(--color-muted);padding:16px 6px;">No hay registros con ese filtro.</td></tr>`;
    } else {
      snapshot.docs.forEach((doc) => {
        const fila = estadoFiltroHistorial.coleccion === "egresos"
          ? filaEgresoHistorial(doc.id, doc.data())
          : filaEntregaHistorial(doc.id, doc.data());
        tbody.appendChild(fila);
      });
    }

    hayMasHistorial = snapshot.docs.length === TAMANO_PAGINA;
    if (snapshot.docs.length > 0) cursorHistorial = snapshot.docs[snapshot.docs.length - 1];
    actualizarBotonCargarMasHistorial();
  } catch (error) {
    console.error("Error al cargar el historial:", error);
    if (reset) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" style="color:var(--color-danger);padding:16px 6px;">
        No se pudo cargar el historial. Si es la primera vez que se usa este filtro (sobre todo
        en «Tratamientos»), puede faltar crear un índice en Firestore — abrí la consola del
        navegador (F12): el error trae un enlace directo para crearlo con un clic.
      </td></tr>`;
    }
    hayMasHistorial = false;
    actualizarBotonCargarMasHistorial();
  } finally {
    cargandoHistorial = false;
    botonMas.disabled = false;
    botonMas.textContent = "Cargar más";
  }
}

function cargarMasHistorial() {
  cargarPaginaHistorial(false);
}

function actualizarBotonCargarMasHistorial() {
  document.getElementById("zona-cargar-mas").style.display = hayMasHistorial ? "block" : "none";
}

// --- Filas de la tabla ---

function filaEntregaHistorial(id, d) {
  const tr = document.createElement("tr");
  const fecha = formatearFechaHora(d.creadoEn);
  const tipo = d.esDonacion
    ? '<span class="badge-donacion">donación</span>'
    : '<span class="badge-ingreso">ingreso</span>';
  const tratamiento = (d.egresoVinculadoId && d.ciclo && d.sesion)
    ? `ciclo ${d.ciclo} / sesión ${d.sesion}`
    : '<span style="color:var(--color-muted);">—</span>';
  const numero = d.numeroComprobante ? `N.° ${d.numeroComprobante}` : `ID ${id.slice(0, 8)}`;
  const paciente = d.paciente || {};
  // "estado" todavía no existe en ningún documento real (recién lo va a escribir la
  // pantalla de aprobación, en la ronda siguiente) — este chequeo queda inerte por ahora
  // y empieza a funcionar solo cuando exista una entrega marcada "anulada".
  const estadoBadge = d.estado === "anulada" ? ' <span class="badge">anulada</span>' : "";

  tr.innerHTML = `
    <td>${fecha}</td>
    <td>${escaparHtml(paciente.apellido)}, ${escaparHtml(paciente.nombre)}<br><span style="color:var(--color-muted);font-size:12px;">${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}</span></td>
    <td>${d.deposito || ""}</td>
    <td>${tipo}${estadoBadge}</td>
    <td>${tratamiento}</td>
    <td>${numero}</td>
    <td class="acciones-fila"><div class="grupo-acciones"></div></td>
  `;

  const celdaAcciones = tr.querySelector(".grupo-acciones");

  const enlaceReimprimir = document.createElement("a");
  enlaceReimprimir.className = "enlace-accion";
  enlaceReimprimir.href = `comprobante.html?id=${id}`;
  enlaceReimprimir.target = "_blank";
  enlaceReimprimir.textContent = "Reimprimir";
  celdaAcciones.appendChild(enlaceReimprimir);

  // "Ver detalle" (etapa 10, punto 4): disponible en cualquier fila, activa o
  // anulada, a diferencia del criterio de la etapa 9 que solo lo ofrecía para
  // tratamientos anulados. Misma función que usa filaEgresoHistorial.
  const botonDetalle = document.createElement("button");
  botonDetalle.type = "button";
  botonDetalle.className = "enlace-accion";
  botonDetalle.textContent = "Ver detalle";
  botonDetalle.addEventListener("click", () => abrirDetalleFila("entregas", id, d));
  celdaAcciones.appendChild(botonDetalle);

  if (puedeSolicitarCorreccion() && d.estado !== "anulada") {
    const botonCorregir = document.createElement("button");
    botonCorregir.type = "button";
    botonCorregir.className = "enlace-accion";
    botonCorregir.textContent = "Solicitar corrección";
    botonCorregir.addEventListener("click", () => abrirSolicitudCorreccion("entregas", id, d));
    celdaAcciones.appendChild(botonCorregir);
  }

  return tr;
}

function filaEgresoHistorial(id, d) {
  const tr = document.createElement("tr");
  const fecha = formatearFechaHora(d.creadoEn);
  const paciente = d.paciente || {};
  const origen = d.origen === "carga-combinada"
    ? '<span class="badge">carga combinada</span>'
    : '<span style="color:var(--color-muted);">tratamiento directo</span>';
  const estadoBadge = d.estado === "anulada" ? ' <span class="badge">anulada</span>' : "";

  tr.innerHTML = `
    <td>${fecha}</td>
    <td>${escaparHtml(paciente.apellido)}, ${escaparHtml(paciente.nombre)}<br><span style="color:var(--color-muted);font-size:12px;">${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}</span></td>
    <td>${d.deposito || ""}</td>
    <td>ciclo ${d.ciclo ?? "—"} / sesión ${d.sesion ?? "—"}</td>
    <td>${origen}${estadoBadge}</td>
    <td class="acciones-fila"><div class="grupo-acciones"></div></td>
  `;

  const celdaAcciones = tr.querySelector(".grupo-acciones");

  // "Ver detalle" (etapa 10, punto 4): antes solo aparecía en tratamientos anulados,
  // como único sustituto de un comprobante (que los egresos no tienen). Ahora está
  // disponible en cualquier fila: en una activa arma el detalle con los datos ya
  // denormalizados del propio documento; en una anulada, igual que antes, busca la
  // corrección que lo anuló.
  const botonDetalle = document.createElement("button");
  botonDetalle.type = "button";
  botonDetalle.className = "enlace-accion";
  botonDetalle.textContent = "Ver detalle";
  botonDetalle.addEventListener("click", () => abrirDetalleFila("egresos", id, d));
  celdaAcciones.appendChild(botonDetalle);

  if (puedeSolicitarCorreccion() && d.estado !== "anulada") {
    const botonCorregir = document.createElement("button");
    botonCorregir.type = "button";
    botonCorregir.className = "enlace-accion";
    botonCorregir.textContent = "Solicitar corrección";
    botonCorregir.addEventListener("click", () => abrirSolicitudCorreccion("egresos", id, d));
    celdaAcciones.appendChild(botonCorregir);
  }

  return tr;
}

// --- Filtro por paciente: carga perezosa del listado (solo si se usa este filtro,
// o si se abre un formulario de corrección que necesita buscar un paciente) ---

async function cargarPacientesHistorialSiHaceFalta() {
  if (pacientesCacheHistorial || cargandoPacientesHistorial) return;
  cargandoPacientesHistorial = true;

  const campo = document.getElementById("campo-buscar-paciente-historial");
  campo.disabled = true;
  campo.placeholder = "Cargando listado de pacientes…";

  try {
    const enCache = leerCachePacientes();
    if (enCache) {
      pacientesCacheHistorial = enCache;
    } else {
      const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
      pacientesCacheHistorial = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      guardarCachePacientes(pacientesCacheHistorial);
    }
  } catch (error) {
    console.error("Error al cargar pacientes:", error);
    pacientesCacheHistorial = [];
  } finally {
    cargandoPacientesHistorial = false;
    campo.disabled = false;
    campo.placeholder = "Buscar por apellido, nombre o documento";
  }
}

function buscarPacienteHistorial(texto) {
  const cont = document.getElementById("resultados-busqueda-paciente-historial");
  const sinResultados = document.getElementById("sin-resultados-historial");
  cont.innerHTML = "";

  if (!texto.trim() || !pacientesCacheHistorial) {
    sinResultados.style.display = "none";
    return;
  }

  const norm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const encontrados = pacientesCacheHistorial.filter((p) => {
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  if (encontrados.length === 0) {
    sinResultados.style.display = "block";
    buscarPacientePorDocumentoEnSegundoPlanoHistorial(digitos);
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPacienteHistorial(p));
    cont.appendChild(div);
  });
}

// Mismo criterio que entregas.js/egresos.js: si lo tipeado es un documento
// completo, se busca puntual en Firestore por si no está en el cache de hoy.
function buscarPacientePorDocumentoEnSegundoPlanoHistorial(digitos) {
  clearTimeout(temporizadorBusquedaDocumentoHistorial);
  if (digitos.length < 7 || digitos.length > 9) return;

  temporizadorBusquedaDocumentoHistorial = setTimeout(async () => {
    const digitosActuales = soloDigitos(document.getElementById("campo-buscar-paciente-historial").value);
    if (digitosActuales !== digitos) return;

    try {
      const snapshot = await db.collection("pacientes")
        .where("numeroDocumento", "==", digitos)
        .where("activo", "==", true)
        .get();
      if (snapshot.empty) return;

      snapshot.docs.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        if (pacientesCacheHistorial && !pacientesCacheHistorial.some((existente) => existente.id === p.id)) {
          pacientesCacheHistorial.push(p);
          agregarPacienteACache(p);
        }
      });

      buscarPacienteHistorial(document.getElementById("campo-buscar-paciente-historial").value);
    } catch (error) {
      console.error("Error al buscar paciente por documento:", error);
    }
  }, 500);
}

// Enlace manual "actualizar listado", para la búsqueda por apellido/nombre.
function actualizarListadoPacientesHistorial() {
  const boton = document.getElementById("boton-actualizar-pacientes-historial");
  if (boton) { boton.disabled = true; boton.textContent = "actualizando..."; }

  db.collection("pacientes").where("activo", "==", true).get()
    .then((snapshot) => {
      pacientesCacheHistorial = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      guardarCachePacientes(pacientesCacheHistorial);
      buscarPacienteHistorial(document.getElementById("campo-buscar-paciente-historial").value);
    })
    .catch((error) => console.error("Error al actualizar el listado de pacientes:", error))
    .finally(() => {
      if (boton) { boton.disabled = false; boton.textContent = "actualizar listado"; }
    });
}

function seleccionarPacienteHistorial(p) {
  estadoFiltroHistorial.pacienteId = p.id;

  document.getElementById("campo-buscar-paciente-historial").value = "";
  document.getElementById("resultados-busqueda-paciente-historial").innerHTML = "";
  document.getElementById("sin-resultados-historial").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial").style.display = "none";

  const cont = document.getElementById("paciente-seleccionado-historial");
  cont.style.display = "flex";
  document.getElementById("texto-paciente-seleccionado-historial").innerHTML =
    `<strong>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;

  cargarPaginaHistorial(true);
}

function quitarPacienteSeleccionadoHistorial() {
  estadoFiltroHistorial.pacienteId = null;

  document.getElementById("paciente-seleccionado-historial").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial").style.display = "block";

  mostrarPlaceholderHistorial("Elegí un paciente para ver su historial.");
}

// --- Filtro por ciclo y sesión ---

function aplicarFiltroCicloSesion() {
  const cicloTexto = document.getElementById("campo-filtro-ciclo").value;
  const sesionTexto = document.getElementById("campo-filtro-sesion").value;
  const ciclo = cicloTexto ? parseInt(cicloTexto, 10) : null;
  const sesion = sesionTexto ? parseInt(sesionTexto, 10) : null;

  if (!ciclo && !sesion) {
    alert("Completá ciclo, sesión, o los dos.");
    return;
  }
  if (cicloTexto && (!ciclo || ciclo < 1)) {
    alert("El ciclo tiene que ser un número mayor o igual a 1.");
    return;
  }
  if (sesionTexto && (!sesion || sesion < 1)) {
    alert("La sesión tiene que ser un número mayor o igual a 1.");
    return;
  }

  estadoFiltroHistorial.ciclo = ciclo;
  estadoFiltroHistorial.sesion = sesion;
  cargarPaginaHistorial(true);
}

// --- Filtro por rango de fechas ---

function aplicarFiltroFecha() {
  const desdeStr = document.getElementById("campo-filtro-fecha-desde").value;
  const hastaStr = document.getElementById("campo-filtro-fecha-hasta").value;

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

  estadoFiltroHistorial.fechaDesde = desde;
  estadoFiltroHistorial.fechaHasta = hasta;
  cargarPaginaHistorial(true);
}

// ============================================================================
// Solicitud de corrección (etapa 9)
// ============================================================================
//
// Dos caminos según si el documento tiene vínculo (carga combinada, uso inmediato):
//
//  - CON vínculo (egresoVinculadoId en una entrega, o entregaOrigenId en un egreso):
//    no se puede corregir ni anular un solo lado, porque el balance de stock de una
//    carga combinada depende de que los dos documentos tengan exactamente la misma
//    cantidad del mismo medicamento (por eso nunca tocó stock al crearse). Acá solo
//    se ofrece anular el PAR completo, sin ningún dato editable más que el motivo.
//
//  - SIN vínculo: se puede pedir una anulación simple, o una corrección con datos
//    nuevos (se recrea desde cero la información del documento). En los dos casos el
//    efecto real sobre stock se calcula y aplica recién al aprobar, no acá.

function cargarMedicamentosHistorialSiHaceFalta() {
  if (medicamentosCacheHistorial) return Promise.resolve();
  return db.collection("medicamentos").get().then((snapshot) => {
    medicamentosCacheHistorial = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((m) => m.activo !== false)
      .sort((a, b) => (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" }));
  }).catch((error) => {
    console.error("Error al cargar medicamentos:", error);
    medicamentosCacheHistorial = [];
  });
}

async function cargarStockHistorialCorreccion(deposito) {
  try {
    const snapshot = await db.collection("stock").where("deposito", "==", deposito).get();
    stockCacheHistorialCorreccion = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error al cargar el stock para la corrección:", error);
    stockCacheHistorialCorreccion = [];
  }
  depositoStockCacheHistorial = deposito;
}

async function abrirSolicitudCorreccion(coleccion, id, datos) {
  const panel = document.getElementById("panel-solicitud-correccion");
  panel.dataset.coleccion = coleccion;
  panel.dataset.id = id;
  panelDatosOriginales = datos;
  correccionPacienteSeleccionado = null;

  const vinculadoId = coleccion === "entregas" ? datos.egresoVinculadoId : datos.entregaOrigenId;

  panel.style.display = "flex";

  if (vinculadoId) {
    panel.dataset.modo = "vinculado";
    renderAvisoVinculado(coleccion, datos, vinculadoId);
  } else {
    panel.dataset.modo = "libre";
    await renderFormularioLibre(coleccion, datos);
  }
}

function cerrarSolicitudCorreccion() {
  const panel = document.getElementById("panel-solicitud-correccion");
  panel.style.display = "none";
  document.getElementById("modal-panel-correccion").innerHTML = "";
  panelDatosOriginales = null;
  correccionPacienteSeleccionado = null;
}

// --- Ver detalle de cualquier fila (etapa 10, punto 4) ---
// Hasta la etapa 9 esto solo existía para tratamientos anulados (sin comprobante para
// reimprimir, era el único lugar de consulta). Ahora es una acción disponible en
// cualquier fila, activa o anulada, de las dos colecciones:
//
//  - Fila ACTIVA: se arma con los datos que ya trae la propia fila (denormalizados en
//    "entregas"/"egresos"), sin ninguna lectura extra a Firestore — salvo un caso
//    puntual: un tratamiento cargado como "carga combinada" no guarda el número de
//    comprobante de la entrega vinculada, así que ahí sí hace falta una lectura puntual
//    a "entregas" para poder mostrarlo (mismo criterio ya usado en correcciones.js para
//    resolver "reemplazadoPorNumero").
//  - Fila ANULADA: mismo comportamiento que ya tenía esta pantalla para tratamientos
//    desde la etapa 9 — busca en "correcciones" el documento que la anuló, vía
//    anuladaPorCorreccionId. Ahora también corre para entregas, y el render ya no
//    asume que la colección de origen es siempre "egresos" (agrega quién entrega y
//    número de comprobante cuando corresponde).

function formatearCantidadDetalle(n) {
  return (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

function resumenMedicamentosDetalle(medicamentos) {
  return (medicamentos || [])
    .map((m) => `${escaparHtml(m.droga)}${m.marca ? " — " + escaparHtml(m.marca) : ""}: ${formatearCantidadDetalle(m.cantidad)} ${m.unidadMedidaLabel || m.unidadMedida}`)
    .join("<br>") || "—";
}

async function abrirDetalleFila(coleccion, id, d) {
  const panel = document.getElementById("panel-solicitud-correccion");
  panel.dataset.modo = "detalle";
  panel.style.display = "flex";
  const contenedor = document.getElementById("modal-panel-correccion");
  contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">Cargando…</div>`;

  if (d.estado === "anulada") {
    if (!d.anuladaPorCorreccionId) {
      contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">No se encontró la solicitud que originó esta anulación.</div>`;
      return;
    }
    try {
      const snap = await db.collection("correcciones").doc(d.anuladaPorCorreccionId).get();
      if (!snap.exists) {
        contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">La solicitud original ya no está disponible.</div>`;
        return;
      }
      renderizarDetalleCorreccion(coleccion, snap.data(), d);
    } catch (error) {
      console.error("Error al cargar el detalle de la corrección:", error);
      contenedor.innerHTML = `<div style="padding:20px;color:var(--color-danger);">No se pudo cargar el detalle. Reintentá en unos segundos.</div>`;
    }
    return;
  }

  let numeroComprobanteVinculado = null;
  if (coleccion === "egresos" && d.origen === "carga-combinada" && d.entregaOrigenId) {
    try {
      const snapEntrega = await db.collection("entregas").doc(d.entregaOrigenId).get();
      numeroComprobanteVinculado = snapEntrega.exists ? (snapEntrega.data().numeroComprobante || null) : null;
    } catch (error) {
      console.error("Error al buscar el comprobante vinculado:", error);
    }
  }

  renderizarDetalleActiva(coleccion, d, numeroComprobanteVinculado);
}

function renderizarDetalleActiva(coleccion, d, numeroComprobanteVinculado) {
  const contenedor = document.getElementById("modal-panel-correccion");
  const esEntrega = coleccion === "entregas";
  const paciente = d.paciente || {};
  const quienEntrega = d.quienEntrega || {};
  const tieneVinculo = esEntrega ? !!d.egresoVinculadoId : (d.origen === "carga-combinada" && !!d.entregaOrigenId);

  let bloqueVinculo = "";
  if (tieneVinculo) {
    const texto = esEntrega
      ? `Cargada junto con un tratamiento en el mismo acto (uso inmediato) — ciclo ${d.ciclo ?? "—"} / sesión ${d.sesion ?? "—"}.`
      : `Cargado junto con el comprobante ${numeroComprobanteVinculado ? "N.° " + numeroComprobanteVinculado : "(sin número disponible)"} en el mismo acto (uso inmediato).`;
    bloqueVinculo = `
      <div style="font-size:12.5px;color:var(--color-muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border);">
        ${texto} No movió stock por separado, porque la misma cantidad entró y salió en el mismo acto.
      </div>
    `;
  }

  const etiquetaTipo = esEntrega
    ? (d.esDonacion ? '<span class="badge-donacion">donación</span>' : '<span class="badge-ingreso">ingreso</span>')
    : '<span class="badge-tratamiento">tratamiento</span>';

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarSolicitudCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">${etiquetaTipo}</div>
    <div style="font-size:13px;line-height:1.7;margin-bottom:10px;">
      <strong>Depósito:</strong> ${d.deposito || "—"}<br>
      <strong>${esEntrega ? (d.esDonacion ? "A quién pertenecía" : "A quién pertenece") : "Paciente"}:</strong>
      ${escaparHtml(paciente.apellido)}, ${escaparHtml(paciente.nombre)} · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}<br>
      ${esEntrega ? `<strong>Quién entrega:</strong> ${escaparHtml(quienEntrega.apellido)}, ${escaparHtml(quienEntrega.nombre)} · ${quienEntrega.documento || ""}<br>` : ""}
      ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${d.ciclo ?? "—"} / ${d.sesion ?? "—"}<br>` : ""}
      ${esEntrega ? `<strong>N.° de comprobante:</strong> ${d.numeroComprobante || "—"}<br>` : ""}
      <strong>Medicamentos:</strong><br>${resumenMedicamentosDetalle(d.medicamentos)}
    </div>
    <div style="font-size:12.5px;color:var(--color-muted);">
      Cargado por <strong>${escaparHtml((d.creadoPor && d.creadoPor.nombre) || "—")}</strong> el ${formatearFechaHora(d.creadoEn)}
    </div>
    ${bloqueVinculo}
    <div style="display:flex;justify-content:flex-end;margin-top:16px;">
      <button type="button" class="boton-secundario" style="width:auto;" onclick="cerrarSolicitudCorreccion()">Cerrar</button>
    </div>
  `;
}

function renderizarDetalleCorreccion(coleccion, correccion, d) {
  const contenedor = document.getElementById("modal-panel-correccion");
  const esEntrega = coleccion === "entregas";
  const vinculado = !!correccion.documentoVinculadoId;
  const o = correccion.datosOriginales || {};
  const n = correccion.datosCorregidos || {};
  const pO = o.paciente || {};
  const qO = o.quienEntrega || {};

  let bloqueComparacion;
  if (correccion.tipo === "correccion" && !vinculado) {
    const pN = n.paciente || {};
    const qN = n.quienEntrega || {};
    bloqueComparacion = `
      <div class="titulo-bloque">comparación</div>
      <div class="fila-2" style="font-size:13px;line-height:1.7;margin-bottom:10px;">
        <div>
          <div style="color:var(--color-muted);font-weight:600;margin-bottom:4px;">Original</div>
          <strong>Depósito:</strong> ${o.deposito || "—"}<br>
          <strong>Paciente:</strong> ${escaparHtml(pO.apellido)}, ${escaparHtml(pO.nombre)}<br>
          ${esEntrega ? `<strong>Quién entrega:</strong> ${escaparHtml(qO.apellido)}, ${escaparHtml(qO.nombre)} · ${qO.documento || ""}<br>` : ""}
          ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${o.ciclo ?? "—"} / ${o.sesion ?? "—"}<br>` : ""}
          ${esEntrega ? `<strong>N.° de comprobante:</strong> ${o.numeroComprobante || "—"}<br>` : ""}
          <strong>Medicamentos:</strong><br>${resumenMedicamentosDetalle(o.medicamentos)}
        </div>
        <div>
          <div style="color:var(--color-accent);font-weight:600;margin-bottom:4px;">Corregido</div>
          <strong>Depósito:</strong> ${n.deposito || "—"}<br>
          <strong>Paciente:</strong> ${escaparHtml(pN.apellido)}, ${escaparHtml(pN.nombre)}<br>
          ${esEntrega ? `<strong>Quién entrega:</strong> ${escaparHtml(qN.apellido)}, ${escaparHtml(qN.nombre)} · ${qN.documento || ""}<br>` : ""}
          ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${n.ciclo ?? "—"} / ${n.sesion ?? "—"}<br>` : ""}
          <strong>Medicamentos:</strong><br>${resumenMedicamentosDetalle(n.medicamentos)}
        </div>
      </div>
    `;
  } else {
    bloqueComparacion = `
      <div class="titulo-bloque">datos ${esEntrega ? "de la entrega" : "del tratamiento"}</div>
      <div style="font-size:13px;line-height:1.7;margin-bottom:6px;">
        <strong>Depósito:</strong> ${o.deposito || "—"}<br>
        <strong>Paciente:</strong> ${escaparHtml(pO.apellido)}, ${escaparHtml(pO.nombre)}<br>
        ${esEntrega ? `<strong>Quién entrega:</strong> ${escaparHtml(qO.apellido)}, ${escaparHtml(qO.nombre)} · ${qO.documento || ""}<br>` : ""}
        ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${o.ciclo ?? "—"} / ${o.sesion ?? "—"}<br>` : ""}
        ${esEntrega ? `<strong>N.° de comprobante:</strong> ${o.numeroComprobante || "—"}<br>` : ""}
        <strong>Medicamentos:</strong><br>${resumenMedicamentosDetalle(o.medicamentos)}
      </div>
      ${vinculado ? `<div style="font-size:12.5px;color:var(--color-muted);margin-bottom:10px;">Anulado junto con el ${esEntrega ? "tratamiento" : "comprobante"} vinculado (uso inmediato). No se modificó stock.</div>` : ""}
    `;
  }

  // El número de reemplazo vive en el documento original ("entregas"/"egresos"), no en
  // el documento de "correcciones" — por eso se lee de "d" (la fila) y no de "correccion".
  const bloqueReemplazo = esEntrega && d && d.reemplazadoPorNumero
    ? `<div style="font-size:13px;margin-top:10px;"><strong>Fue reemplazado por el comprobante N.° ${d.reemplazadoPorNumero}.</strong></div>`
    : "";

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarSolicitudCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">
      ${correccion.tipo === "correccion" ? '<span class="badge">corrección</span>' : '<span class="badge">anulación</span>'}
      ${vinculado ? ' <span class="badge">en pareja</span>' : ""}
      <span class="badge">anulada</span>
    </div>
    <div style="font-size:13px;color:var(--color-muted);margin-bottom:10px;">
      Solicitado por <strong>${escaparHtml((correccion.solicitadoPor && correccion.solicitadoPor.nombre) || "—")}</strong>
      el ${formatearFechaHora(correccion.solicitadoEn)}
    </div>
    <div style="font-size:13px;margin-bottom:14px;"><strong>Motivo:</strong> ${escaparHtml(correccion.motivo || "—")}</div>
    ${bloqueComparacion}
    ${bloqueReemplazo}
    <div style="font-size:13px;color:var(--color-muted);margin-top:14px;border-top:1px solid var(--color-border);padding-top:12px;">
      Resuelto por <strong>${escaparHtml((correccion.resueltoPor && correccion.resueltoPor.nombre) || "—")}</strong>
      el ${formatearFechaHora(correccion.resueltoEn)}
      ${correccion.comentarioResolucion ? `<br><strong>Comentario:</strong> ${escaparHtml(correccion.comentarioResolucion)}` : ""}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;">
      <button type="button" class="boton-secundario" style="width:auto;" onclick="cerrarSolicitudCorreccion()">Cerrar</button>
    </div>
  `;
}

function recortarDatosParaCorreccion(coleccion, datos) {
  if (coleccion === "entregas") {
    return {
      deposito: datos.deposito || "",
      esDonacion: !!datos.esDonacion,
      paciente: datos.paciente || null,
      quienEntrega: datos.quienEntrega || null,
      medicamentos: datos.medicamentos || [],
      ciclo: datos.ciclo || null,
      sesion: datos.sesion || null,
      numeroComprobante: datos.numeroComprobante || null,
      creadoEn: datos.creadoEn || null
    };
  }
  return {
    deposito: datos.deposito || "",
    paciente: datos.paciente || null,
    ciclo: datos.ciclo || null,
    sesion: datos.sesion || null,
    medicamentos: datos.medicamentos || [],
    origen: datos.origen || null,
    creadoEn: datos.creadoEn || null
  };
}

// --- Caso con vínculo: solo anular el par completo ---

function textoEfectoStockAnulacion(coleccion, datos) {
  if (coleccion === "entregas") {
    return `El stock que esta entrega había sumado en «${datos.deposito}» se revierte.`;
  }
  return `El stock que este tratamiento había descontado en «${datos.deposito}» se repone.`;
}

function renderAvisoVinculado(coleccion, datos, vinculadoId) {
  const contenedor = document.getElementById("modal-panel-correccion");
  const panel = document.getElementById("panel-solicitud-correccion");
  const esEntrega = coleccion === "entregas";
  const nombreDocumento = esEntrega ? "esta entrega" : "este tratamiento";
  const nombreVinculo = esEntrega ? "el tratamiento registrado en el mismo acto" : "la entrega registrada en el mismo acto";

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarSolicitudCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="tarjeta-confirmacion-stock" style="margin-top:0;">
      <div class="titulo-confirmacion-stock">Esta carga está vinculada</div>
      <div class="texto-confirmacion-stock">
        ${nombreDocumento.charAt(0).toUpperCase() + nombreDocumento.slice(1)} se cargó junto con ${nombreVinculo}
        (uso inmediato), y las cantidades de los dos documentos tienen que coincidir para que el stock quede
        bien. Por eso acá no se puede corregir un dato suelto: la solicitud va a anular los dos documentos
        juntos, sin tocar stock (porque el par nunca lo tocó al crearse). Después se puede cargar de nuevo la
        entrega y/o el tratamiento correctos desde cero, en entregas.html o egresos.html.
      </div>
      <div class="campo" style="margin-bottom:12px;">
        <label>Motivo de la anulación</label>
        <input type="text" id="motivo-correccion-vinculada" placeholder="Ej: se cargó dos veces por error" />
      </div>
      <div id="mensaje-panel-correccion" class="mensaje-info error" style="display:none;"></div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="boton-secundario" style="flex:1;" onclick="cerrarSolicitudCorreccion()">Cancelar</button>
        <button type="button" class="boton-confirmar-stock" style="flex:1;" onclick="enviarSolicitudVinculada('${coleccion}', '${panel.dataset.id}', '${vinculadoId}')">Enviar solicitud de anulación</button>
      </div>
    </div>
  `;
}

async function enviarSolicitudVinculada(coleccion, id, vinculadoId) {
  if (enviandoCorreccion) return;
  const motivo = document.getElementById("motivo-correccion-vinculada").value.trim();
  const mensajeEl = document.getElementById("mensaje-panel-correccion");

  if (!motivo) {
    mensajeEl.textContent = "El motivo es obligatorio.";
    mensajeEl.style.display = "block";
    return;
  }

  enviandoCorreccion = true;
  try {
    await db.collection("correcciones").add({
      coleccionOrigen: coleccion,
      documentoOrigenId: id,
      documentoVinculadoId: vinculadoId,
      tipo: "anulacion",
      datosOriginales: recortarDatosParaCorreccion(coleccion, panelDatosOriginales),
      datosCorregidos: null,
      motivo,
      estado: "pendiente",
      solicitadoPor: { uid: usuarioActualHistorial.uid, nombre: datosUsuarioActualHistorial.nombre || usuarioActualHistorial.email },
      solicitadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      resueltoPor: null,
      resueltoEn: null,
      comentarioResolucion: null
    });

    cerrarSolicitudCorreccion();
    mostrarMensajeGeneralHistorial("Solicitud de anulación enviada. Queda pendiente de aprobación del administrador.", "exito");
  } catch (error) {
    console.error("Error al crear la solicitud de corrección:", error);
    mensajeEl.textContent = "No se pudo enviar la solicitud. Reintentá en unos segundos.";
    mensajeEl.style.display = "block";
  } finally {
    enviandoCorreccion = false;
  }
}

// --- Caso sin vínculo: anulación simple, o corrección con datos nuevos ---

async function renderFormularioLibre(coleccion, datos) {
  const contenedor = document.getElementById("modal-panel-correccion");
  const panel = document.getElementById("panel-solicitud-correccion");
  const esEntrega = coleccion === "entregas";

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarSolicitudCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque">solicitar corrección — ${esEntrega ? "entrega" : "tratamiento"}</div>
    <div class="filtro-tabs" id="selector-tipo-solicitud">
      <button type="button" class="filtro-tab activo" data-tipo="anulacion">Anular sin reemplazo</button>
      <button type="button" class="filtro-tab" data-tipo="correccion">Corregir datos</button>
    </div>
    <div id="cuerpo-tipo-solicitud"></div>
    <div class="campo" style="margin-top:4px;">
      <label>Motivo</label>
      <input type="text" id="motivo-correccion-libre" placeholder="Ej: la unidad de medida se cargó mal, correspondía cc y no mg" />
    </div>
    <div id="mensaje-panel-correccion" class="mensaje-info error" style="display:none;"></div>
    <div style="display:flex;gap:8px;">
      <button type="button" class="boton-secundario" style="flex:1;" onclick="cerrarSolicitudCorreccion()">Cancelar</button>
      <button type="button" class="boton-principal" style="flex:1;" onclick="enviarSolicitudLibre('${coleccion}', '${panel.dataset.id}')">Enviar solicitud</button>
    </div>
  `;

  contenedor.querySelectorAll("#selector-tipo-solicitud .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      contenedor.querySelectorAll("#selector-tipo-solicitud .filtro-tab").forEach((b) => b.classList.toggle("activo", b === btn));
      panel.dataset.tipoSolicitud = btn.dataset.tipo;
      await renderCuerpoTipoSolicitud(coleccion, datos, btn.dataset.tipo);
    });
  });

  panel.dataset.tipoSolicitud = "anulacion";
  await renderCuerpoTipoSolicitud(coleccion, datos, "anulacion");
}

async function renderCuerpoTipoSolicitud(coleccion, datos, tipo) {
  const cuerpo = document.getElementById("cuerpo-tipo-solicitud");

  if (tipo === "anulacion") {
    cuerpo.innerHTML = `<div style="font-size:13px;color:var(--color-muted);margin:10px 0 16px;">
      Se va a anular ${coleccion === "entregas" ? "esta entrega" : "este tratamiento"}, sin cargar ningún
      reemplazo. ${textoEfectoStockAnulacion(coleccion, datos)}
    </div>`;
    return;
  }

  // tipo === "correccion": hace falta el catálogo de medicamentos y el listado de
  // pacientes para armar el formulario editable.
  cuerpo.innerHTML = `<div style="color:var(--color-muted);font-size:13px;margin:10px 0;">Cargando datos…</div>`;
  await Promise.all([cargarMedicamentosHistorialSiHaceFalta(), cargarPacientesHistorialSiHaceFalta()]);

  if (coleccion === "entregas") {
    renderFormularioCorreccionEntrega(datos);
  } else {
    await renderFormularioCorreccionEgreso(datos);
  }
}

// --- Corrección de datos: entrega ---

function renderFormularioCorreccionEntrega(datos) {
  const cuerpo = document.getElementById("cuerpo-tipo-solicitud");
  const paciente = datos.paciente || {};
  const quienEntrega = datos.quienEntrega || {};

  cuerpo.innerHTML = `
    <div class="campo" style="margin-top:10px;">
      <label>Depósito</label>
      <select id="corr-deposito">
        <option value="FUESMEN" ${datos.deposito === "FUESMEN" ? "selected" : ""}>FUESMEN</option>
        <option value="Programa Oncológico" ${datos.deposito === "Programa Oncológico" ? "selected" : ""}>Programa Oncológico</option>
        <option value="Donaciones" ${datos.deposito === "Donaciones" ? "selected" : ""}>Donaciones</option>
      </select>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">a quién pertenece</div>
    <input type="text" id="corr-buscar-paciente" class="campo-busqueda-pacientes" placeholder="Buscar por apellido, nombre o documento" autocomplete="off" />
    <div id="corr-resultados-paciente"></div>
    <div class="paciente-seleccionado">
      <span id="corr-texto-paciente"><strong>${escaparHtml(paciente.apellido)}, ${escaparHtml(paciente.nombre)}</strong> · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""} <span style="color:var(--color-muted);">(sin cambios, salvo que busques otro arriba)</span></span>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">quién entrega</div>
    <div class="fila-3">
      <div class="campo" style="margin-bottom:0;"><label>Nombre</label><input type="text" id="corr-entrega-nombre" value="${escaparHtml(quienEntrega.nombre)}" /></div>
      <div class="campo" style="margin-bottom:0;"><label>Apellido</label><input type="text" id="corr-entrega-apellido" value="${escaparHtml(quienEntrega.apellido)}" /></div>
      <div class="campo" style="margin-bottom:0;"><label>Documento</label><input type="text" id="corr-entrega-documento" inputmode="numeric" value="${escaparHtml(quienEntrega.documento)}" /></div>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">medicamentos corregidos</div>
    <div id="corr-lista-medicamentos"></div>
    <button type="button" class="enlace-accion" onclick="agregarFilaMedicamentoCorreccion()" style="margin-bottom:20px;">+ agregar medicamento</button>
  `;

  correccionPacienteSeleccionado = paciente.id ? { ...paciente } : null;

  document.getElementById("corr-buscar-paciente").addEventListener("input", (e) => buscarPacienteCorreccion(e.target.value));
  document.getElementById("corr-entrega-documento").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value).slice(0, 9); });

  document.getElementById("corr-lista-medicamentos").innerHTML = "";
  contadorFilasMedCorreccion = 0;
  const lineas = datos.medicamentos && datos.medicamentos.length > 0 ? datos.medicamentos : [null];
  lineas.forEach((m) => agregarFilaMedicamentoCorreccion(m));
}

function buscarPacienteCorreccion(texto) {
  const cont = document.getElementById("corr-resultados-paciente");
  cont.innerHTML = "";
  if (!texto.trim() || !pacientesCacheHistorial) return;

  const norm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const encontrados = pacientesCacheHistorial.filter((p) => {
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => {
      correccionPacienteSeleccionado = { ...p };
      document.getElementById("corr-buscar-paciente").value = "";
      cont.innerHTML = "";
      document.getElementById("corr-texto-paciente").innerHTML =
        `<strong>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;
    });
    cont.appendChild(div);
  });
}

function agregarFilaMedicamentoCorreccion(datosLinea) {
  contadorFilasMedCorreccion++;
  const id = `corr-fila-med-${contadorFilasMedCorreccion}`;
  const div = document.createElement("div");
  div.className = "fila-medicamento";
  div.id = id;

  const opcionesMedicamento = medicamentosCacheHistorial
    .map((m) => `<option value="${m.id}" ${datosLinea && datosLinea.medicamentoId === m.id ? "selected" : ""}>${escaparHtml(m.droga)}${m.marca ? " — " + escaparHtml(m.marca) : ""}</option>`)
    .join("");
  const opcionesUnidad = UNIDADES_MEDIDA_CORRECCION
    .map((u) => `<option value="${u.value}" ${datosLinea && datosLinea.unidadMedida === u.value ? "selected" : ""}>${u.label}</option>`)
    .join("");

  div.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>medicamento ${contadorFilasMedCorreccion}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="fila-3">
      <div class="campo" style="margin-bottom:0;">
        <label>Droga / marca</label>
        <select class="corr-sel-medicamento">${opcionesMedicamento}</select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Unidad de medida</label>
        <select class="corr-sel-unidad">${opcionesUnidad}</select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Cantidad</label>
        <input type="number" class="corr-inp-cantidad" min="0" step="any" value="${datosLinea ? datosLinea.cantidad : ""}" />
      </div>
    </div>
  `;
  div.querySelector("[data-quitar]").addEventListener("click", () => {
    const filas = document.querySelectorAll("#corr-lista-medicamentos .fila-medicamento");
    if (filas.length <= 1) {
      alert("Tiene que quedar al menos un medicamento cargado.");
      return;
    }
    div.remove();
  });
  document.getElementById("corr-lista-medicamentos").appendChild(div);
}

function recolectarDatosCorreccionEntrega() {
  const mensajeEl = document.getElementById("mensaje-panel-correccion");
  const mostrarError = (texto) => {
    mensajeEl.textContent = texto;
    mensajeEl.style.display = "block";
  };
  mensajeEl.style.display = "none";

  const deposito = document.getElementById("corr-deposito").value;
  const esDonacion = deposito === "Donaciones";
  const nombre = capitalizarPalabras(document.getElementById("corr-entrega-nombre").value);
  const apellido = capitalizarPalabras(document.getElementById("corr-entrega-apellido").value);
  const documento = soloDigitos(document.getElementById("corr-entrega-documento").value);

  if (!correccionPacienteSeleccionado) {
    mostrarError(esDonacion ? "Falta indicar a quién pertenecía la medicación." : "Falta indicar a quién pertenece la medicación.");
    return null;
  }
  if (!nombre || !apellido || !documento) {
    mostrarError("Faltan los datos de quién entrega.");
    return null;
  }
  if (documento.length < 7 || documento.length > 9) {
    mostrarError("El documento de quién entrega debe tener entre 7 y 9 dígitos.");
    return null;
  }

  const filas = [...document.querySelectorAll("#corr-lista-medicamentos .fila-medicamento")];
  const medicamentos = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const medId = fila.querySelector(".corr-sel-medicamento").value;
    const med = medicamentosCacheHistorial.find((m) => m.id === medId);
    const unidadValue = fila.querySelector(".corr-sel-unidad").value;
    const unidad = UNIDADES_MEDIDA_CORRECCION.find((u) => u.value === unidadValue);
    const cantidad = parseFloat(fila.querySelector(".corr-inp-cantidad").value);

    if (!med) {
      mostrarError(`No hay medicamentos cargados en el catálogo para elegir en la línea ${i + 1}.`);
      return null;
    }
    if (!cantidad || cantidad <= 0) {
      mostrarError(`La cantidad del medicamento ${i + 1} (${med.droga}) tiene que ser mayor a cero.`);
      return null;
    }
    medicamentos.push({
      medicamentoId: med.id,
      droga: med.droga,
      marca: med.marca || "",
      unidadMedida: unidad.value,
      unidadMedidaLabel: unidad.label,
      cantidad
    });
  }

  return {
    deposito,
    esDonacion,
    paciente: {
      id: correccionPacienteSeleccionado.id,
      tipoDocumento: correccionPacienteSeleccionado.tipoDocumento,
      numeroDocumento: correccionPacienteSeleccionado.numeroDocumento,
      nombre: correccionPacienteSeleccionado.nombre,
      apellido: correccionPacienteSeleccionado.apellido
    },
    quienEntrega: { nombre, apellido, documento },
    medicamentos
  };
}

// --- Corrección de datos: egreso ---
// A diferencia de la entrega, la unidad de medida de cada línea no es una lista fija:
// se arma según las unidades para las que ya existe stock cargado en el depósito
// elegido (mismo criterio que egresos.js desde la etapa 6), para no descontar en una
// unidad distinta a la que se usó al cargar el ingreso real.

async function renderFormularioCorreccionEgreso(datos) {
  const cuerpo = document.getElementById("cuerpo-tipo-solicitud");
  const paciente = datos.paciente || {};

  cuerpo.innerHTML = `
    <div class="fila-3" style="margin-top:10px;">
      <div class="campo" style="margin-bottom:0;">
        <label>Depósito</label>
        <select id="corr-deposito">
          <option value="FUESMEN" ${datos.deposito === "FUESMEN" ? "selected" : ""}>FUESMEN</option>
          <option value="Programa Oncológico" ${datos.deposito === "Programa Oncológico" ? "selected" : ""}>Programa Oncológico</option>
          <option value="Donaciones" ${datos.deposito === "Donaciones" ? "selected" : ""}>Donaciones</option>
        </select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Ciclo</label>
        <input type="text" id="corr-ciclo" inputmode="numeric" value="${datos.ciclo || ""}" />
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Sesión</label>
        <input type="text" id="corr-sesion" inputmode="numeric" value="${datos.sesion || ""}" />
      </div>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">paciente</div>
    <input type="text" id="corr-buscar-paciente" class="campo-busqueda-pacientes" placeholder="Buscar por apellido, nombre o documento" autocomplete="off" />
    <div id="corr-resultados-paciente"></div>
    <div class="paciente-seleccionado">
      <span id="corr-texto-paciente"><strong>${escaparHtml(paciente.apellido)}, ${escaparHtml(paciente.nombre)}</strong> · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""} <span style="color:var(--color-muted);">(sin cambios, salvo que busques otro arriba)</span></span>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">medicamentos corregidos</div>
    <div id="corr-lista-medicamentos"></div>
    <button type="button" class="enlace-accion" onclick="agregarFilaMedicamentoCorreccionEgreso()" style="margin-bottom:20px;">+ agregar medicamento</button>
  `;

  correccionPacienteSeleccionado = paciente.id ? { ...paciente } : null;

  document.getElementById("corr-buscar-paciente").addEventListener("input", (e) => buscarPacienteCorreccion(e.target.value));
  document.getElementById("corr-ciclo").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });
  document.getElementById("corr-sesion").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });
  document.getElementById("corr-deposito").addEventListener("change", recalcularUnidadesCorreccionEgreso);

  await cargarStockHistorialCorreccion(datos.deposito);

  document.getElementById("corr-lista-medicamentos").innerHTML = "";
  contadorFilasMedCorreccion = 0;
  const lineas = datos.medicamentos && datos.medicamentos.length > 0 ? datos.medicamentos : [null];
  lineas.forEach((m) => agregarFilaMedicamentoCorreccionEgreso(m));
}

async function recalcularUnidadesCorreccionEgreso() {
  const deposito = document.getElementById("corr-deposito").value;
  if (deposito !== depositoStockCacheHistorial) {
    await cargarStockHistorialCorreccion(deposito);
  }
  document.querySelectorAll("#corr-lista-medicamentos .fila-medicamento").forEach((fila) => actualizarUnidadesFilaCorreccion(fila.id));
}

function agregarFilaMedicamentoCorreccionEgreso(datosLinea) {
  contadorFilasMedCorreccion++;
  const id = `corr-fila-med-${contadorFilasMedCorreccion}`;
  const div = document.createElement("div");
  div.className = "fila-medicamento";
  div.id = id;

  const opcionesMedicamento =
    `<option value="">Elegir...</option>` +
    medicamentosCacheHistorial
      .map((m) => `<option value="${m.id}" ${datosLinea && datosLinea.medicamentoId === m.id ? "selected" : ""}>${escaparHtml(m.droga)}${m.marca ? " — " + escaparHtml(m.marca) : ""}</option>`)
      .join("");

  div.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>medicamento ${contadorFilasMedCorreccion}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="fila-3">
      <div class="campo" style="margin-bottom:0;">
        <label>Droga / marca</label>
        <select class="corr-sel-medicamento">${opcionesMedicamento}</select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Unidad de medida</label>
        <select class="corr-sel-unidad" disabled><option value="">Elegí el medicamento primero</option></select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Cantidad</label>
        <input type="number" class="corr-inp-cantidad" min="0" step="any" value="${datosLinea ? datosLinea.cantidad : ""}" disabled />
      </div>
    </div>
    <div class="aviso-sin-stock" style="display:none;">No hay stock cargado de este medicamento en este depósito.</div>
  `;
  div.querySelector("[data-quitar]").addEventListener("click", () => {
    const filas = document.querySelectorAll("#corr-lista-medicamentos .fila-medicamento");
    if (filas.length <= 1) {
      alert("Tiene que quedar al menos un medicamento cargado.");
      return;
    }
    div.remove();
  });
  div.querySelector(".corr-sel-medicamento").addEventListener("change", () => actualizarUnidadesFilaCorreccion(id));
  document.getElementById("corr-lista-medicamentos").appendChild(div);

  if (datosLinea) {
    actualizarUnidadesFilaCorreccion(id, datosLinea.unidadMedida, datosLinea.cantidad);
  }
}

function actualizarUnidadesFilaCorreccion(filaId, unidadPreseleccionada, cantidadPreseleccionada) {
  const fila = document.getElementById(filaId);
  const medicamentoId = fila.querySelector(".corr-sel-medicamento").value;
  const selUnidad = fila.querySelector(".corr-sel-unidad");
  const inpCantidad = fila.querySelector(".corr-inp-cantidad");
  const aviso = fila.querySelector(".aviso-sin-stock");

  if (!medicamentoId) {
    selUnidad.innerHTML = `<option value="">Elegí el medicamento primero</option>`;
    selUnidad.disabled = true;
    inpCantidad.disabled = true;
    aviso.style.display = "none";
    return;
  }

  const unidadesConStock = (stockCacheHistorialCorreccion || []).filter((s) => s.medicamentoId === medicamentoId);

  if (unidadesConStock.length === 0) {
    selUnidad.innerHTML = `<option value="">Sin stock cargado</option>`;
    selUnidad.disabled = true;
    inpCantidad.disabled = true;
    aviso.style.display = "block";
    return;
  }

  aviso.style.display = "none";
  selUnidad.disabled = false;
  inpCantidad.disabled = false;
  selUnidad.innerHTML = unidadesConStock
    .map((s) => {
      const label = s.unidadMedidaLabel || (UNIDADES_MEDIDA_CORRECCION.find((u) => u.value === s.unidadMedida) || {}).label || s.unidadMedida;
      const seleccionado = unidadPreseleccionada && unidadPreseleccionada === s.unidadMedida ? "selected" : "";
      return `<option value="${s.unidadMedida}" ${seleccionado}>${label}</option>`;
    })
    .join("");

  if (cantidadPreseleccionada != null) inpCantidad.value = cantidadPreseleccionada;
}

function recolectarDatosCorreccionEgreso() {
  const mensajeEl = document.getElementById("mensaje-panel-correccion");
  const mostrarError = (texto) => {
    mensajeEl.textContent = texto;
    mensajeEl.style.display = "block";
  };
  mensajeEl.style.display = "none";

  const deposito = document.getElementById("corr-deposito").value;
  const ciclo = parseInt(document.getElementById("corr-ciclo").value, 10);
  const sesion = parseInt(document.getElementById("corr-sesion").value, 10);

  if (!correccionPacienteSeleccionado) {
    mostrarError("Falta indicar a quién pertenece el tratamiento.");
    return null;
  }
  if (!ciclo || ciclo < 1) {
    mostrarError("El ciclo tiene que ser un número mayor o igual a 1.");
    return null;
  }
  if (!sesion || sesion < 1) {
    mostrarError("La sesión tiene que ser un número mayor o igual a 1.");
    return null;
  }

  const filas = [...document.querySelectorAll("#corr-lista-medicamentos .fila-medicamento")];
  const medicamentos = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const medId = fila.querySelector(".corr-sel-medicamento").value;
    const med = medicamentosCacheHistorial.find((m) => m.id === medId);
    const unidadValue = fila.querySelector(".corr-sel-unidad").value;
    const cantidad = parseFloat(fila.querySelector(".corr-inp-cantidad").value);

    if (!med) {
      mostrarError(`Falta elegir el medicamento en la línea ${i + 1}.`);
      return null;
    }
    if (!unidadValue) {
      mostrarError(`No hay stock cargado de ${med.droga} en este depósito, así que no se puede descontar (línea ${i + 1}).`);
      return null;
    }
    if (!cantidad || cantidad <= 0) {
      mostrarError(`La cantidad del medicamento ${i + 1} (${med.droga}) tiene que ser mayor a cero.`);
      return null;
    }

    const stockEntry = (stockCacheHistorialCorreccion || []).find((s) => s.medicamentoId === med.id && s.unidadMedida === unidadValue);
    const unidadLabel = (stockEntry && stockEntry.unidadMedidaLabel) || unidadValue;

    medicamentos.push({
      medicamentoId: med.id,
      droga: med.droga,
      marca: med.marca || "",
      unidadMedida: unidadValue,
      unidadMedidaLabel: unidadLabel,
      cantidad
    });
  }

  return {
    deposito,
    paciente: {
      id: correccionPacienteSeleccionado.id,
      tipoDocumento: correccionPacienteSeleccionado.tipoDocumento,
      numeroDocumento: correccionPacienteSeleccionado.numeroDocumento,
      nombre: correccionPacienteSeleccionado.nombre,
      apellido: correccionPacienteSeleccionado.apellido
    },
    ciclo,
    sesion,
    medicamentos
  };
}

// --- Envío común para el caso sin vínculo (anulación simple o corrección con datos) ---

async function enviarSolicitudLibre(coleccion, id) {
  if (enviandoCorreccion) return;
  const panel = document.getElementById("panel-solicitud-correccion");
  const tipo = panel.dataset.tipoSolicitud;
  const motivo = document.getElementById("motivo-correccion-libre").value.trim();
  const mensajeEl = document.getElementById("mensaje-panel-correccion");

  mensajeEl.style.display = "none";
  if (!motivo) {
    mensajeEl.textContent = "El motivo es obligatorio.";
    mensajeEl.style.display = "block";
    return;
  }

  let datosCorregidos = null;
  if (tipo === "correccion") {
    datosCorregidos = coleccion === "entregas"
      ? recolectarDatosCorreccionEntrega()
      : recolectarDatosCorreccionEgreso();
    if (!datosCorregidos) return; // la función ya mostró el error puntual
  }

  enviandoCorreccion = true;
  try {
    await db.collection("correcciones").add({
      coleccionOrigen: coleccion,
      documentoOrigenId: id,
      documentoVinculadoId: null,
      tipo: tipo === "correccion" ? "correccion" : "anulacion",
      datosOriginales: recortarDatosParaCorreccion(coleccion, panelDatosOriginales),
      datosCorregidos,
      motivo,
      estado: "pendiente",
      solicitadoPor: { uid: usuarioActualHistorial.uid, nombre: datosUsuarioActualHistorial.nombre || usuarioActualHistorial.email },
      solicitadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      resueltoPor: null,
      resueltoEn: null,
      comentarioResolucion: null
    });

    cerrarSolicitudCorreccion();
    mostrarMensajeGeneralHistorial("Solicitud enviada. Queda pendiente de aprobación del administrador.", "exito");
  } catch (error) {
    console.error("Error al crear la solicitud de corrección:", error);
    mensajeEl.textContent = "No se pudo enviar la solicitud. Reintentá en unos segundos.";
    mensajeEl.style.display = "block";
  } finally {
    enviandoCorreccion = false;
  }
}
