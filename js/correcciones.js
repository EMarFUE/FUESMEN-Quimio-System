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

let usuarioActualCorrecciones = null;
let datosUsuarioActualCorrecciones = null;
let correccionesPendientesCache = [];
let procesando = false;

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
  await cargarPendientes();
}

// --- Listado de solicitudes pendientes ---

async function cargarPendientes() {
  const tbody = document.getElementById("cuerpo-tabla-correcciones");
  tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-muted);">Cargando...</td></tr>`;
  try {
    const snapshot = await db.collection("correcciones")
      .where("estado", "==", "pendiente")
      .orderBy("solicitadoEn", "asc")
      .get();
    correccionesPendientesCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderizarListaPendientes();
  } catch (error) {
    console.error("Error al cargar correcciones pendientes:", error);
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger);padding:16px 6px;">
      No se pudo cargar el listado. Si es la primera vez que se usa esta pantalla, puede faltar
      crear un índice en Firestore (estado + solicitadoEn) — abrí la consola del navegador (F12):
      el error trae un enlace directo para crearlo con un clic.
    </td></tr>`;
  }
}

function renderizarListaPendientes() {
  const tbody = document.getElementById("cuerpo-tabla-correcciones");
  tbody.innerHTML = "";

  if (correccionesPendientesCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-muted);padding:16px 6px;">No hay solicitudes pendientes.</td></tr>`;
    return;
  }

  correccionesPendientesCache.forEach((c) => tbody.appendChild(filaPendiente(c)));
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

function filaPendiente(c) {
  const tr = document.createElement("tr");
  const d = c.datosOriginales || {};
  const paciente = d.paciente || {};
  tr.innerHTML = `
    <td>${formatearFechaHora(c.solicitadoEn)}</td>
    <td>${etiquetaOrigen(c.coleccionOrigen)}</td>
    <td>${etiquetaTipo(c)}</td>
    <td>${paciente.apellido || ""}, ${paciente.nombre || ""}<br><span style="color:var(--color-muted);font-size:12px;">${d.deposito || ""}</span></td>
    <td>${(c.solicitadoPor && c.solicitadoPor.nombre) || "—"}</td>
    <td style="max-width:220px;">${c.motivo || ""}</td>
    <td class="acciones-fila"></td>
  `;
  const celda = tr.querySelector(".acciones-fila");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "enlace-accion";
  boton.textContent = "Revisar";
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
  const correccion = correccionesPendientesCache.find((c) => c.id === id);
  if (!correccion) return;

  const panel = document.getElementById("panel-revision-correccion");
  const contenedor = document.getElementById("modal-panel-revision");
  panel.style.display = "flex";
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
    correccionesPendientesCache = correccionesPendientesCache.filter((c) => c.id !== id);
    renderizarListaPendientes();
    mostrarMensajeGeneral("Solicitud rechazada. No se modificó ningún dato ni stock.", "exito");
  } catch (error) {
    console.error("Error al rechazar la corrección:", error);
    mostrarErrorEnModal("No se pudo rechazar. Reintentá en unos segundos.");
  } finally {
    procesando = false;
  }
}

// --- Aprobación: acá es donde se toca el stock de verdad ---

function armarDatosReemplazo(coleccion, datosCorregidos, adminInfo, correccionId, documentoOrigenId) {
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
  } else {
    base.ciclo = datosCorregidos.ciclo;
    base.sesion = datosCorregidos.sesion;
  }
  return base;
}

async function aprobarCorreccion(id) {
  if (procesando) return;
  procesando = true;

  const correccion = correccionesPendientesCache.find((c) => c.id === id);
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
        correccion.coleccionOrigen, correccion.datosCorregidos, adminInfo, id, correccion.documentoOrigenId
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
      await nuevoRef.update({ numeroComprobante: formatearNumeroComprobante(anioComprobante, numeroCorrelativo) });
    }

    cerrarRevisionCorreccion();
    correccionesPendientesCache = correccionesPendientesCache.filter((c) => c.id !== id);
    renderizarListaPendientes();
    mostrarMensajeGeneral("Corrección aprobada. El stock ya está actualizado.", "exito");
  } catch (error) {
    console.error("Error al aprobar la corrección:", error);
    mostrarErrorEnModal("No se pudo aprobar. Reintentá en unos segundos.");
  } finally {
    procesando = false;
  }
}
