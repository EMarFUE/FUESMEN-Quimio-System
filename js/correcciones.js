// Lógica de la pantalla de aprobación de correcciones (etapa 9, ronda 2).
// Exclusiva administrador. No depende de entregas.js, egresos.js ni historial.js —
// misma independencia por página que ya usa el resto del sistema — aunque repite
// algunas funciones de normalización que ya existen en esos archivos.
//
// Acá es donde de verdad se toca el stock. El criterio de reversión y aplicación replica
// exactamente el que usan entregas.js y egresos.js al crear una carga:
//   - Una entrega (no vinculada) SUMÓ stock al crearse → revertirla RESTA.
//   - Un egreso (no vinculado) RESTÓ stock al crearse → revertirlo SUMA.
//   - Si la solicitud es una corrección con datos nuevos, además de revertir el efecto
//     original se aplica el efecto de los datos corregidos, con el mismo signo que
//     tendría una carga nueva de esa colección.
//   - Si la solicitud es una anulación en pareja (documentoVinculadoId presente), no se
//     toca stock en absoluto: el par nunca lo tocó al crearse.
// El detalle crítico (ver Handoff_etapa_9_ronda1.md): el documento de stock a REVERTIR
// se identifica con los datos ORIGINALES (medicamento + unidad + depósito de antes de la
// corrección); el documento a AJUSTAR por los datos nuevos se identifica con los datos
// CORREGIDOS. Cuando ambos coinciden (por ejemplo, una corrección que solo cambia la
// cantidad), calcularAjustesStock() los consolida en un único ajuste neto sobre el mismo
// documento, en vez de escribirlo dos veces.
//
// Listado (agregado tras la primera ronda de pruebas): dos pestañas, "Pendientes" —sin
// paginar, se espera bajo volumen— y "Todas" —paginada de a 25, igual criterio que
// historial.js—, ambas ordenadas de más reciente a más antigua. "Pendientes" ordena en
// el navegador en vez de pedírselo a Firestore, a propósito: así solo necesita el índice
// simple de "estado" que Firestore crea solo, sin sumar un índice compuesto más.

let usuarioActualCorrecciones = null;
let datosUsuarioActualCorrecciones = null;
let correccionesCache = [];
let filtroActivoCorrecciones = "pendientes"; // "pendientes" | "todas"
let ultimoDocCorrecciones = null;
let hayMasCorrecciones = false;
let procesando = false;

const TAMANO_PAGINA_CORRECCIONES = 25;

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugDeposito(deposito) {
  return normalizarTexto(deposito).replace(/\s+/g, "-");
}

function formatearFechaHora(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function milisegundos(timestamp) {
  if (!timestamp) return 0;
  return timestamp.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
}

// Mismo formato que usa entregas.js para el comprobante original (ej. "2026-0134").
function formatearNumeroComprobante(anio, numero) {
  return `${anio}-${String(numero).padStart(4, "0")}`;
}

function formatearCantidad(n) {
  return (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

function mostrarMensajeGeneral(texto, tipo) {
  const el = document.getElementById("mensaje-general-correcciones");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => { el.style.display = "none"; }, 6000);
}

function mostrarErrorEnModal(texto) {
  const el = document.getElementById("mensaje-modal-revision");
  if (!el) return;
  el.textContent = texto;
  el.style.display = "block";
}

async function iniciarCorrecciones(user, datosUsuario) {
  usuarioActualCorrecciones = user;
  datosUsuarioActualCorrecciones = datosUsuario;
  configurarCierreModalRevision();
  configurarTabsCorrecciones();
  await cargarPendientesTab();
}

// --- Pestañas ---

function configurarTabsCorrecciones() {
  document.querySelectorAll("#filtro-tabs-correcciones .filtro-tab").forEach((boton) => {
    boton.addEventListener("click", () => cambiarFiltroCorrecciones(boton.dataset.filtro));
  });
}

function cambiarFiltroCorrecciones(filtro) {
  if (filtro === filtroActivoCorrecciones) return;
  filtroActivoCorrecciones = filtro;
  document.querySelectorAll("#filtro-tabs-correcciones .filtro-tab").forEach((boton) => {
    boton.classList.toggle("activo", boton.dataset.filtro === filtro);
  });
  if (filtro === "pendientes") cargarPendientesTab();
  else cargarPrimeraPaginaTodas();
}

// --- Pestaña "Pendientes": sin paginar, ordenado en el navegador ---

async function cargarPendientesTab() {
  document.getElementById("zona-cargar-mas-correcciones").style.display = "none";
  const tbody = document.getElementById("cuerpo-tabla-correcciones");
  tbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-muted);">Cargando...</td></tr>`;
  try {
    const snap = await db.collection("correcciones").where("estado", "==", "pendiente").get();
    correccionesCache = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    correccionesCache.sort((a, b) => milisegundos(b.solicitadoEn) - milisegundos(a.solicitadoEn));
    renderizarListaCorrecciones();
  } catch (error) {
    console.error("Error al cargar correcciones pendientes:", error);
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-danger);padding:16px 6px;">
      No se pudo cargar el listado. Reintentá en unos segundos.
    </td></tr>`;
  }
}

// --- Pestaña "Todas": paginada de a 25, igual criterio que historial.js ---

async function cargarPrimeraPaginaTodas() {
  ultimoDocCorrecciones = null;
  correccionesCache = [];
  const tbody = document.getElementById("cuerpo-tabla-correcciones");
  tbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-muted);">Cargando...</td></tr>`;
  try {
    const snap = await db.collection("correcciones")
      .orderBy("solicitadoEn", "desc")
      .limit(TAMANO_PAGINA_CORRECCIONES)
      .get();
    await procesarPaginaTodas(snap);
  } catch (error) {
    console.error("Error al cargar el historial de correcciones:", error);
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-danger);padding:16px 6px;">
      No se pudo cargar el listado. Reintentá en unos segundos.
    </td></tr>`;
  }
}

async function cargarMasCorrecciones() {
  if (filtroActivoCorrecciones !== "todas" || !ultimoDocCorrecciones) return;
  try {
    const snap = await db.collection("correcciones")
      .orderBy("solicitadoEn", "desc")
      .startAfter(ultimoDocCorrecciones)
      .limit(TAMANO_PAGINA_CORRECCIONES)
      .get();
    await procesarPaginaTodas(snap);
  } catch (error) {
    console.error("Error al cargar más correcciones:", error);
  }
}

async function procesarPaginaTodas(snap) {
  const docs = snap.docs;
  const nuevos = docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  correccionesCache = correccionesCache.concat(nuevos);
  hayMasCorrecciones = docs.length === TAMANO_PAGINA_CORRECCIONES;
  if (docs.length > 0) ultimoDocCorrecciones = docs[docs.length - 1];
  await enriquecerConNumerosDeReemplazo(nuevos);
  renderizarListaCorrecciones();
  document.getElementById("zona-cargar-mas-correcciones").style.display = hayMasCorrecciones ? "block" : "none";
}

// --- Render del listado ---

function renderizarListaCorrecciones() {
  const tbody = document.getElementById("cuerpo-tabla-correcciones");
  tbody.innerHTML = "";

  if (correccionesCache.length === 0) {
    const texto = filtroActivoCorrecciones === "pendientes" ? "No hay solicitudes pendientes." : "Todavía no se registró ninguna solicitud.";
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--color-muted);padding:16px 6px;">${texto}</td></tr>`;
    return;
  }

  correccionesCache.forEach((c) => tbody.appendChild(filaCorreccion(c)));
}

function etiquetaOrigen(coleccion) {
  return coleccion === "entregas"
    ? '<span class="badge-ingreso">comprobante</span>'
    : '<span class="badge-tratamiento">tratamiento</span>';
}

function etiquetaTipo(correccion) {
  if (correccion.documentoVinculadoId) return '<span class="badge">anulación en pareja</span>';
  return correccion.tipo === "correccion"
    ? '<span class="badge">corrección</span>'
    : '<span class="badge">anulación</span>';
}

function etiquetaEstado(estado) {
  if (estado === "aprobada") return '<span class="badge badge-aprobada">aprobada</span>';
  if (estado === "rechazada") return '<span class="badge badge-rechazada">rechazada</span>';
  return '<span class="badge badge-pendiente">pendiente</span>';
}

// Completa, para las correcciones aprobadas sobre entregas, el número de comprobante
// que se generó al aplicar la corrección — dato que no viaja en el documento de la
// corrección (se conoce recién después del commit del batch, ver aprobarCorreccion),
// pero sí queda escrito en el documento de la entrega original (reemplazadoPorNumero).
// Una lectura puntual por fila, y solo para el subconjunto que puede tenerlo: no hace
// falta ningún cambio en firestore.rules, la lectura de "entregas" ya es abierta.
async function enriquecerConNumerosDeReemplazo(lista) {
  const candidatas = lista.filter((c) =>
    c.coleccionOrigen === "entregas" && c.tipo === "correccion" && c.estado === "aprobada" && c._numeroReemplazo === undefined
  );
  await Promise.all(candidatas.map(async (c) => {
    try {
      const snap = await db.collection("entregas").doc(c.documentoOrigenId).get();
      c._numeroReemplazo = snap.exists ? (snap.data().reemplazadoPorNumero || null) : null;
    } catch (error) {
      console.error("Error al leer el número de comprobante de reemplazo:", error);
      c._numeroReemplazo = null;
    }
  }));
}

function celdaComprobante(c) {
  if (c.coleccionOrigen !== "entregas") return '<span style="color:var(--color-muted);">no aplica</span>';
  const original = (c.datosOriginales && c.datosOriginales.numeroComprobante) || "—";
  if (c._numeroReemplazo) {
    return `${original}<br><span style="color:var(--color-muted);font-size:12px;">→ ${c._numeroReemplazo}</span>`;
  }
  return original;
}

function filaCorreccion(c) {
  const tr = document.createElement("tr");
  const d = c.datosOriginales || {};
  const paciente = d.paciente || {};
  tr.innerHTML = `
    <td>${formatearFechaHora(c.solicitadoEn)}<br><span style="color:var(--color-muted);font-size:12px;">${(c.solicitadoPor && c.solicitadoPor.nombre) || "—"}</span></td>
    <td>${etiquetaOrigen(c.coleccionOrigen)}</td>
    <td>${etiquetaTipo(c)}</td>
    <td>${paciente.apellido || ""}, ${paciente.nombre || ""}<br><span style="color:var(--color-muted);font-size:12px;">${d.deposito || ""}</span></td>
    <td>${celdaComprobante(c)}</td>
    <td>${etiquetaEstado(c.estado)}</td>
    <td style="max-width:200px;">${c.motivo || ""}</td>
    <td style="max-width:200px;">${c.comentarioResolucion || "—"}</td>
    <td class="acciones-fila"></td>
  `;
  const celda = tr.querySelector(".acciones-fila");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "enlace-accion";
  boton.textContent = c.estado === "pendiente" ? "Revisar" : "Ver detalle";
  boton.addEventListener("click", () => abrirRevisionCorreccion(c.id));
  celda.appendChild(boton);
  return tr;
}

// --- Cálculo del efecto sobre stock (usado tanto para la previsualización como para el batch real) ---

function calcularAjustesStock(correccion) {
  const ajustes = new Map();
  if (correccion.documentoVinculadoId) return ajustes; // anulación en pareja: nunca tocó stock

  const agregar = (deposito, linea, signo) => {
    const stockId = `${linea.medicamentoId}_${linea.unidadMedida}_${slugDeposito(deposito)}`;
    if (!ajustes.has(stockId)) {
      ajustes.set(stockId, {
        stockId,
        medicamentoId: linea.medicamentoId,
        droga: linea.droga,
        marca: linea.marca,
        unidadMedida: linea.unidadMedida,
        unidadMedidaLabel: linea.unidadMedidaLabel,
        deposito,
        delta: 0
      });
    }
    ajustes.get(stockId).delta += signo * linea.cantidad;
  };

  // Reversión del documento original: una entrega sumó, se revierte restando; un egreso
  // restó, se revierte sumando.
  const signoReversion = correccion.coleccionOrigen === "entregas" ? -1 : 1;
  (correccion.datosOriginales.medicamentos || []).forEach((l) =>
    agregar(correccion.datosOriginales.deposito, l, signoReversion)
  );

  // Aplicación del reemplazo, solo si es una corrección con datos nuevos.
  if (correccion.tipo === "correccion" && correccion.datosCorregidos) {
    const signoAplicacion = correccion.coleccionOrigen === "entregas" ? 1 : -1;
    (correccion.datosCorregidos.medicamentos || []).forEach((l) =>
      agregar(correccion.datosCorregidos.deposito, l, signoAplicacion)
    );
  }

  return ajustes;
}

async function cargarPreviewsStock(ajustes) {
  const previews = new Map();
  await Promise.all([...ajustes.keys()].map(async (stockId) => {
    try {
      const snap = await db.collection("stock").doc(stockId).get();
      previews.set(stockId, snap.exists ? (Number(snap.data().cantidad) || 0) : 0);
    } catch (error) {
      console.error("Error al leer stock para la previsualización:", stockId, error);
      previews.set(stockId, null); // no se pudo leer; se avisa en el modal
    }
  }));
  return previews;
}

// --- Modal de revisión ---

function configurarCierreModalRevision() {
  const panel = document.getElementById("panel-revision-correccion");
  panel.addEventListener("click", (e) => {
    if (e.target === panel) cerrarRevisionCorreccion();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.style.display !== "none") cerrarRevisionCorreccion();
  });
}

function cerrarRevisionCorreccion() {
  document.getElementById("panel-revision-correccion").style.display = "none";
  document.getElementById("modal-panel-revision").innerHTML = "";
}

async function abrirRevisionCorreccion(id) {
  const correccion = correccionesCache.find((c) => c.id === id);
  if (!correccion) return;

  const panel = document.getElementById("panel-revision-correccion");
  const contenedor = document.getElementById("modal-panel-revision");
  panel.style.display = "flex";

  // Ya resuelta: detalle de solo lectura, sin recalcular stock (ese cálculo ya no
  // representa nada real una vez aplicado) ni botones de acción.
  if (correccion.estado !== "pendiente") {
    renderizarModalSoloLectura(correccion);
    return;
  }

  contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">Calculando el efecto sobre el stock…</div>`;
  const ajustes = calcularAjustesStock(correccion);
  const previews = await cargarPreviewsStock(ajustes);
  renderizarModalRevision(correccion, ajustes, previews);
}

function resumenMedicamentos(medicamentos) {
  return (medicamentos || [])
    .map((m) => `${m.droga}${m.marca ? " — " + m.marca : ""}: ${formatearCantidad(m.cantidad)} ${m.unidadMedidaLabel || m.unidadMedida}`)
    .join("<br>") || "—";
}

function renderResumenOriginal(correccion) {
  const d = correccion.datosOriginales || {};
  const paciente = d.paciente || {};
  const esEntrega = correccion.coleccionOrigen === "entregas";
  const quienEntrega = d.quienEntrega || {};
  return `
    <div class="titulo-bloque">datos de ${esEntrega ? "la entrega" : "el tratamiento"}</div>
    <div style="font-size:13px;line-height:1.7;margin-bottom:6px;">
      <strong>Depósito:</strong> ${d.deposito || "—"}<br>
      <strong>${esEntrega ? (d.esDonacion ? "A quién pertenecía" : "A quién pertenece") : "Paciente"}:</strong>
      ${paciente.apellido || ""}, ${paciente.nombre || ""} · ${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}<br>
      ${esEntrega ? `<strong>Quién entrega:</strong> ${quienEntrega.apellido || ""}, ${quienEntrega.nombre || ""} · ${quienEntrega.documento || ""}<br>` : ""}
      ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${d.ciclo ?? "—"} / ${d.sesion ?? "—"}<br>` : ""}
      <strong>Medicamentos:</strong><br>${resumenMedicamentos(d.medicamentos)}
    </div>
  `;
}

function renderComparacionDatos(correccion) {
  const o = correccion.datosOriginales || {};
  const n = correccion.datosCorregidos || {};
  const esEntrega = correccion.coleccionOrigen === "entregas";
  const pO = o.paciente || {}, pN = n.paciente || {};
  const qO = o.quienEntrega || {}, qN = n.quienEntrega || {};

  return `
    <div class="titulo-bloque">comparación</div>
    <div class="fila-2" style="font-size:13px;line-height:1.7;margin-bottom:10px;">
      <div>
        <div style="color:var(--color-muted);font-weight:600;margin-bottom:4px;">Original</div>
        <strong>Depósito:</strong> ${o.deposito || "—"}<br>
        <strong>Paciente:</strong> ${pO.apellido || ""}, ${pO.nombre || ""}<br>
        ${esEntrega ? `<strong>Quién entrega:</strong> ${qO.apellido || ""}, ${qO.nombre || ""} · ${qO.documento || ""}<br>` : ""}
        ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${o.ciclo ?? "—"} / ${o.sesion ?? "—"}<br>` : ""}
        <strong>Medicamentos:</strong><br>${resumenMedicamentos(o.medicamentos)}
      </div>
      <div>
        <div style="color:var(--color-accent);font-weight:600;margin-bottom:4px;">Corregido</div>
        <strong>Depósito:</strong> ${n.deposito || "—"}<br>
        <strong>Paciente:</strong> ${pN.apellido || ""}, ${pN.nombre || ""}<br>
        ${esEntrega ? `<strong>Quién entrega:</strong> ${qN.apellido || ""}, ${qN.nombre || ""} · ${qN.documento || ""}<br>` : ""}
        ${!esEntrega ? `<strong>Ciclo / sesión:</strong> ${n.ciclo ?? "—"} / ${n.sesion ?? "—"}<br>` : ""}
        <strong>Medicamentos:</strong><br>${resumenMedicamentos(n.medicamentos)}
      </div>
    </div>
  `;
}

function renderizarModalRevision(correccion, ajustes, previews) {
  const contenedor = document.getElementById("modal-panel-revision");
  const vinculado = !!correccion.documentoVinculadoId;
  const esEntrega = correccion.coleccionOrigen === "entregas";
  const nombreDoc = esEntrega ? "esta entrega" : "este tratamiento";

  let bloqueEfecto = "";
  if (vinculado) {
    bloqueEfecto = `
      <div class="tarjeta-confirmacion-stock" style="margin-top:14px;">
        <div class="titulo-confirmacion-stock">Anulación en pareja</div>
        <div class="texto-confirmacion-stock" style="margin-bottom:0;">
          Se van a anular ${nombreDoc} y el documento vinculado (uso inmediato) juntos.
          No se modifica ningún stock, porque el par nunca lo tocó al crearse.
        </div>
      </div>
    `;
  } else {
    const filasAjuste = [...ajustes.values()].map((a) => {
      const actual = previews.get(a.stockId);
      const despues = actual == null ? null : actual + a.delta;
      const textoActual = actual == null ? "no se pudo leer" : formatearCantidad(actual);
      const textoDespues = despues == null ? "—" : formatearCantidad(despues);
      const negativo = despues != null && despues < 0;
      return `<tr>
        <td>${a.droga}${a.marca ? " — " + a.marca : ""}</td>
        <td>${a.deposito}</td>
        <td>${a.unidadMedidaLabel || a.unidadMedida}</td>
        <td>${textoActual}</td>
        <td style="${negativo ? "color:var(--color-danger);font-weight:600;" : ""}">${textoDespues}</td>
      </tr>`;
    }).join("");

    bloqueEfecto = `
      <div class="titulo-bloque" style="margin-top:14px;">efecto sobre el stock</div>
      <table class="tabla">
        <thead><tr><th>Medicamento</th><th>Depósito</th><th>Unidad</th><th>Stock actual</th><th>Después de aprobar</th></tr></thead>
        <tbody>${filasAjuste || '<tr><td colspan="5" style="color:var(--color-muted);">Sin líneas.</td></tr>'}</tbody>
      </table>
    `;
  }

  const bloqueComparacion = correccion.tipo === "correccion" && !vinculado
    ? renderComparacionDatos(correccion)
    : renderResumenOriginal(correccion);

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarRevisionCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">${etiquetaOrigen(correccion.coleccionOrigen)} ${etiquetaTipo(correccion)}</div>
    <div style="font-size:13px;color:var(--color-muted);margin-bottom:10px;">
      Solicitado por <strong>${(correccion.solicitadoPor && correccion.solicitadoPor.nombre) || "—"}</strong>
      el ${formatearFechaHora(correccion.solicitadoEn)}
    </div>
    <div style="font-size:13px;margin-bottom:14px;"><strong>Motivo:</strong> ${correccion.motivo || "—"}</div>

    ${bloqueComparacion}
    ${bloqueEfecto}

    <div class="campo" style="margin-top:16px;margin-bottom:12px;">
      <label>Comentario de resolución (opcional)</label>
      <input type="text" id="comentario-resolucion" placeholder="Notas internas sobre esta decisión" />
    </div>
    <div id="mensaje-modal-revision" class="mensaje-info error" style="display:none;"></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button type="button" class="enlace-accion peligro" style="margin-left:0;" onclick="rechazarCorreccion('${correccion.id}')">Rechazar</button>
      <div style="flex:1;"></div>
      <button type="button" class="boton-secundario" style="width:auto;" onclick="cerrarRevisionCorreccion()">Cancelar</button>
      <button type="button" class="boton-principal" style="width:auto;padding-left:20px;padding-right:20px;" onclick="aprobarCorreccion('${correccion.id}')">Aprobar</button>
    </div>
  `;
}

function renderizarModalSoloLectura(correccion) {
  const contenedor = document.getElementById("modal-panel-revision");
  const vinculado = !!correccion.documentoVinculadoId;
  const bloqueComparacion = correccion.tipo === "correccion" && !vinculado
    ? renderComparacionDatos(correccion)
    : renderResumenOriginal(correccion);

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarRevisionCorreccion()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">${etiquetaOrigen(correccion.coleccionOrigen)} ${etiquetaTipo(correccion)} ${etiquetaEstado(correccion.estado)}</div>
    <div style="font-size:13px;color:var(--color-muted);margin-bottom:10px;">
      Solicitado por <strong>${(correccion.solicitadoPor && correccion.solicitadoPor.nombre) || "—"}</strong>
      el ${formatearFechaHora(correccion.solicitadoEn)}
    </div>
    <div style="font-size:13px;margin-bottom:14px;"><strong>Motivo:</strong> ${correccion.motivo || "—"}</div>

    ${bloqueComparacion}

    <div style="font-size:13px;color:var(--color-muted);margin-top:14px;border-top:1px solid var(--color-border);padding-top:12px;">
      Resuelto por <strong>${(correccion.resueltoPor && correccion.resueltoPor.nombre) || "—"}</strong>
      el ${formatearFechaHora(correccion.resueltoEn)}
      ${correccion.comentarioResolucion ? `<br><strong>Comentario:</strong> ${correccion.comentarioResolucion}` : ""}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;">
      <button type="button" class="boton-secundario" style="width:auto;" onclick="cerrarRevisionCorreccion()">Cerrar</button>
    </div>
  `;
}

// --- Rechazo: solo cambia el estado de la solicitud ---

async function rechazarCorreccion(id) {
  if (procesando) return;
  procesando = true;
  try {
    const comentario = (document.getElementById("comentario-resolucion").value || "").trim();
    await db.collection("correcciones").doc(id).update({
      estado: "rechazada",
      resueltoPor: { uid: usuarioActualCorrecciones.uid, nombre: datosUsuarioActualCorrecciones.nombre || usuarioActualCorrecciones.email },
      resueltoEn: firebase.firestore.FieldValue.serverTimestamp(),
      comentarioResolucion: comentario || null
    });

    cerrarRevisionCorreccion();
    await recargarTabActual();
    mostrarMensajeGeneral("Solicitud rechazada. No se modificó ningún dato ni stock.", "exito");
  } catch (error) {
    console.error("Error al rechazar la corrección:", error);
    mostrarErrorEnModal("No se pudo rechazar. Reintentá en unos segundos.");
  } finally {
    procesando = false;
  }
}

// --- Aprobación: acá es donde se toca el stock de verdad ---

function armarDatosReemplazo(coleccion, datosCorregidos, adminInfo, correccionId, documentoOrigenId, numeroComprobanteReemplazado) {
  const base = {
    deposito: datosCorregidos.deposito,
    paciente: datosCorregidos.paciente,
    medicamentos: datosCorregidos.medicamentos,
    creadoPor: adminInfo,
    creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    origenCorreccionId: correccionId,
    documentoReemplazadoId: documentoOrigenId
  };
  if (coleccion === "entregas") {
    base.esDonacion = !!datosCorregidos.esDonacion;
    base.quienEntrega = datosCorregidos.quienEntrega;
    // Referencia cruzada para el comprobante impreso (ver comprobante.html): permite
    // mostrar "este comprobante corrige al N.° X" sin tener que leer el documento
    // original al imprimir. No afecta stock ni ninguna otra lógica.
    base.numeroComprobanteReemplazado = numeroComprobanteReemplazado || null;
  } else {
    base.ciclo = datosCorregidos.ciclo;
    base.sesion = datosCorregidos.sesion;
  }
  return base;
}

async function aprobarCorreccion(id) {
  if (procesando) return;
  procesando = true;

  const correccion = correccionesCache.find((c) => c.id === id);
  if (!correccion) { procesando = false; return; }

  try {
    // Salvaguarda: releer el estado actual justo antes de aplicar, para no revertir el
    // mismo stock dos veces si había dos solicitudes pendientes sobre el mismo documento
    // (ver "simplificaciones deliberadas" en Handoff_etapa_9_ronda1.md).
    const refOrigen = db.collection(correccion.coleccionOrigen).doc(correccion.documentoOrigenId);
    const snapOrigen = await refOrigen.get();
    if (!snapOrigen.exists || snapOrigen.data().estado === "anulada") {
      mostrarErrorEnModal("Este documento ya fue anulado por otra corrección aprobada antes. Rechazá esta solicitud en vez de aprobarla.");
      procesando = false;
      return;
    }

    let refVinculado = null;
    if (correccion.documentoVinculadoId) {
      const otraColeccion = correccion.coleccionOrigen === "entregas" ? "egresos" : "entregas";
      refVinculado = db.collection(otraColeccion).doc(correccion.documentoVinculadoId);
      const snapVinculado = await refVinculado.get();
      if (!snapVinculado.exists || snapVinculado.data().estado === "anulada") {
        mostrarErrorEnModal("El documento vinculado ya fue anulado por otra corrección aprobada antes. Rechazá esta solicitud en vez de aprobarla.");
        procesando = false;
        return;
      }
    }

    const comentario = (document.getElementById("comentario-resolucion").value || "").trim();
    const adminInfo = {
      uid: usuarioActualCorrecciones.uid,
      nombre: datosUsuarioActualCorrecciones.nombre || usuarioActualCorrecciones.email
    };

    const batch = db.batch();

    // 1) Marcar el/los documento(s) original(es) como anulados, sin tocar ningún otro
    //    campo (el documento se conserva íntegro, mismo criterio que el resto del sistema).
    const datosAnulacion = {
      estado: "anulada",
      anuladaPorCorreccionId: id,
      anuladaEn: firebase.firestore.FieldValue.serverTimestamp(),
      anuladaPor: adminInfo
    };
    batch.update(refOrigen, datosAnulacion);
    if (refVinculado) batch.update(refVinculado, datosAnulacion);

    // 2) Efecto sobre stock (el Map queda vacío si es una anulación en pareja).
    const ajustes = calcularAjustesStock(correccion);
    ajustes.forEach((a) => {
      const stockRef = db.collection("stock").doc(a.stockId);
      batch.set(stockRef, {
        medicamentoId: a.medicamentoId,
        droga: a.droga,
        marca: a.marca,
        unidadMedida: a.unidadMedida,
        unidadMedidaLabel: a.unidadMedidaLabel,
        deposito: a.deposito,
        cantidad: firebase.firestore.FieldValue.increment(a.delta),
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // 3) Si es una corrección con datos nuevos (no una simple anulación), crear el
    //    documento de reemplazo.
    let nuevoRef = null;
    let contadorRef = null;
    let anioComprobante = null;
    if (correccion.tipo === "correccion" && correccion.datosCorregidos) {
      nuevoRef = db.collection(correccion.coleccionOrigen).doc();
      const datosReemplazo = armarDatosReemplazo(
        correccion.coleccionOrigen, correccion.datosCorregidos, adminInfo, id, correccion.documentoOrigenId,
        snapOrigen.data().numeroComprobante
      );
      batch.set(nuevoRef, datosReemplazo);

      // La entrega de reemplazo genera su propio número de comprobante, mismo mecanismo
      // que entregas.js: se incrementa el contador en este mismo batch, y el valor real
      // se lee y se guarda recién después del commit.
      if (correccion.coleccionOrigen === "entregas") {
        anioComprobante = new Date().getFullYear().toString();
        contadorRef = db.collection("contadores").doc("comprobantes");
        batch.set(contadorRef, { [anioComprobante]: firebase.firestore.FieldValue.increment(1) }, { merge: true });
      }
    }

    // 4) Marcar la solicitud como resuelta.
    batch.update(db.collection("correcciones").doc(id), {
      estado: "aprobada",
      resueltoPor: adminInfo,
      resueltoEn: firebase.firestore.FieldValue.serverTimestamp(),
      comentarioResolucion: comentario || null
    });

    await batch.commit();

    if (nuevoRef && contadorRef) {
      const contadorSnap = await contadorRef.get();
      const numeroCorrelativo = contadorSnap.data()[anioComprobante];
      const numeroNuevo = formatearNumeroComprobante(anioComprobante, numeroCorrelativo);
      await nuevoRef.update({ numeroComprobante: numeroNuevo });
      // Referencia cruzada en el sentido inverso, para que comprobante.html pueda avisar
      // "fue reemplazado por el N.° X" al reimprimir el comprobante anulado. Es la misma
      // idea que numeroComprobanteReemplazado en el documento nuevo, pero no se puede
      // escribir en el mismo batch: el número recién se conoce después del commit.
      await refOrigen.update({ reemplazadoPorNumero: numeroNuevo, reemplazadoPorId: nuevoRef.id });
    }

    cerrarRevisionCorreccion();
    await recargarTabActual();
    mostrarMensajeGeneral("Corrección aprobada. El stock ya está actualizado.", "exito");
  } catch (error) {
    console.error("Error al aprobar la corrección:", error);
    mostrarErrorEnModal("No se pudo aprobar. Reintentá en unos segundos.");
  } finally {
    procesando = false;
  }
}

// Después de aprobar o rechazar, se recarga la pestaña activa desde Firestore en vez de
// parchear el cache local — es una acción poco frecuente, y así el listado nunca puede
// desincronizarse de lo que realmente quedó guardado.
async function recargarTabActual() {
  if (filtroActivoCorrecciones === "pendientes") await cargarPendientesTab();
  else await cargarPrimeraPaginaTodas();
}
