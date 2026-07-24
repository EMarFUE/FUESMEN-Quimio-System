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

function mostrarMensajeGeneralHistorial(texto, tipo) {
  const el = document.getElementById("mensaje-general-historial");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

function puedeSolicitarCorreccion() {
  return rolActualHistorial === "administrador" || rolActualHistorial === "enfermeria";
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
    <td>${paciente.apellido || ""}, ${paciente.nombre || ""}<br><span style="color:var(--color-muted);font-size:12px;">${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}</span></td>
    <td>${d.deposito || ""}</td>
    <td>${tipo}${estadoBadge}</td>
    <td>${tratamiento}</td>
    <td>${numero}</td>
    <td class="acciones-fila"></td>
  `;

  const celdaAcciones = tr.querySelector(".acciones-fila");

  const enlaceReimprimir = document.createElement("a");
  enlaceReimprimir.className = "enlace-accion";
  enlaceReimprimir.href = `comprobante.html?id=${id}`;
  enlaceReimprimir.target = "_blank";
  enlaceReimprimir.textContent = "Reimprimir";
  celdaAcciones.appendChild(enlaceReimprimir);

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
    <td>${paciente.apellido || ""}, ${paciente.nombre || ""}<br><span style="color:var(--color-muted);font-size:12px;">${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}</span></td>
    <td>${d.deposito || ""}</td>
    <td>ciclo ${d.ciclo ?? "—"} / sesión ${d.sesion ?? "—"}</td>
    <td>${origen}${estadoBadge}</td>
    <td class="acciones-fila"></td>
  `;

  const celdaAcciones = tr.querySelector(".acciones-fila");

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
    const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
    pacientesCacheHistorial = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${p.apellido}, ${p.nombre} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPacienteHistorial(p));
    cont.appendChild(div);
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
    `<strong>${p.apellido}, ${p.nombre}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;

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

  panel.style.display = "block";

  if (vinculadoId) {
    panel.dataset.modo = "vinculado";
    renderAvisoVinculado(coleccion, datos, vinculadoId);
  } else {
    panel.dataset.modo = "libre";
    await renderFormularioLibre(coleccion, datos);
  }

  panel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cerrarSolicitudCorreccion() {
  const panel = document.getElementById("panel-solicitud-correccion");
  panel.style.display = "none";
  panel.innerHTML = "";
  panelDatosOriginales = null;
  correccionPacienteSeleccionado = null;
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
  const panel = document.getElementById("panel-solicitud-correccion");
  const esEntrega = coleccion === "entregas";
  const nombreDocumento = esEntrega ? "esta entrega" : "este tratamiento";
  const nombreVinculo = esEntrega ? "el tratamiento registrado en el mismo acto" : "la entrega registrada en el mismo acto";

  panel.innerHTML = `
    <div class="tarjeta-confirmacion-stock">
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
  const panel = document.getElementById("panel-solicitud-correccion");
  const esEntrega = coleccion === "entregas";

  panel.innerHTML = `
    <div class="tarjeta-formulario">
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
    </div>
  `;

  panel.querySelectorAll("#selector-tipo-solicitud .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      panel.querySelectorAll("#selector-tipo-solicitud .filtro-tab").forEach((b) => b.classList.toggle("activo", b === btn));
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
      <span id="corr-texto-paciente"><strong>${paciente.apellido || ""}, ${paciente.nombre || ""}</strong> · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""} <span style="color:var(--color-muted);">(sin cambios, salvo que busques otro arriba)</span></span>
    </div>

    <div class="titulo-bloque" style="margin-top:14px;">quién entrega</div>
    <div class="fila-3">
      <div class="campo" style="margin-bottom:0;"><label>Nombre</label><input type="text" id="corr-entrega-nombre" value="${quienEntrega.nombre || ""}" /></div>
      <div class="campo" style="margin-bottom:0;"><label>Apellido</label><input type="text" id="corr-entrega-apellido" value="${quienEntrega.apellido || ""}" /></div>
      <div class="campo" style="margin-bottom:0;"><label>Documento</label><input type="text" id="corr-entrega-documento" inputmode="numeric" value="${quienEntrega.documento || ""}" /></div>
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
    div.innerHTML = `<span>${p.apellido}, ${p.nombre} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => {
      correccionPacienteSeleccionado = { ...p };
      document.getElementById("corr-buscar-paciente").value = "";
      cont.innerHTML = "";
      document.getElementById("corr-texto-paciente").innerHTML =
        `<strong>${p.apellido}, ${p.nombre}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;
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
    .map((m) => `<option value="${m.id}" ${datosLinea && datosLinea.medicamentoId === m.id ? "selected" : ""}>${m.droga}${m.marca ? " — " + m.marca : ""}</option>`)
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
      <span id="corr-texto-paciente"><strong>${paciente.apellido || ""}, ${paciente.nombre || ""}</strong> · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""} <span style="color:var(--color-muted);">(sin cambios, salvo que busques otro arriba)</span></span>
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
      .map((m) => `<option value="${m.id}" ${datosLinea && datosLinea.medicamentoId === m.id ? "selected" : ""}>${m.droga}${m.marca ? " — " + m.marca : ""}</option>`)
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
