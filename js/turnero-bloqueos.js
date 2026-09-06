// Lógica de la pantalla "Bloqueos" del módulo de Turnero (Etapa T9).
// Colección "turneroBloqueos". Pantalla exclusiva de administrador (ver punto 16 del
// alcance de Turnero), tanto para crear como para el listado de gestión.
//
// Fase 1 (modelo de datos y formulario de carga) y Fase 2 (el motor descuenta los
// bloqueos vigentes, ver turnero-motor.js/turnero-carga.js/turnero-grilla.js) ya están
// en producción. Esta entrega es la Fase 3: listado de gestión completo (levantar una
// fecha puntual de un bloqueo recurrente, modificar, eliminar con motivo, reactivar) y
// exportación a Excel. La Fase 4 (indicador visual en la grilla + seed del bloqueo
// recurrente de sábados de Emilio Civit) queda para la próxima entrega.
//
// Un bloqueo tiene sede, motivo, sillón opcional (vacío = todos los sillones de esa
// sede) y franja horaria opcional (vacía = todo el horario de atención de ese día).
// Es "puntual" (fechaInicio/fechaFin, mismo valor en las dos si es un solo día) o
// "recurrente" (diaSemana, indefinido, con "fechasExceptuadas" para levantar una fecha
// puntual sin borrar la regla general — así se resuelven los sábados de Emilio Civit
// con el mismo mecanismo, sin un segundo sistema aparte).
//
// Baja lógica ("eliminar"): activo pasa a false, con motivoBaja/bajaPor/bajaEn — mismo
// criterio de nunca borrar físicamente que ya rige turnos/entregas/egresos. Se puede
// reactivar (mismo patrón que turnero-protocolos.js/medicamentos.js), sin pedir motivo
// para eso: la decisión con Elías fue que solo "eliminar" pide motivo, no volver a
// activarlo. El "update" de turneroBloqueos en firestore.rules quedó abierto a
// administrador sin revalidar esquema desde la Fase 1 (mismo criterio que
// turneroSedes/turneroMedicos/etc.), así que ni "eliminar" ni "reactivar" ni "levantar"
// ni "modificar" necesitan ningún cambio de reglas — toda la responsabilidad de mandar
// los campos correctos queda del lado del cliente, acá.

const DIAS_SEMANA_BLOQUEOS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_LABEL_BLOQUEOS = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes", sabado: "Sábado"
};
const DIAS_EN_ESPANOL_BLOQUEOS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

const TEXTOS_VACIO_BLOQUEOS = {
  vigentes: "No hay bloqueos vigentes.",
  inactivos: "No hay bloqueos inactivos.",
  todos: "Todavía no se cargó ningún bloqueo."
};

let sedesCacheBloqueos = [];
let bloqueosCache = [];
let usuarioActualBloqueos = null;
let datosUsuarioActualBloqueos = null;

let filtroActualBloqueos = "vigentes"; // "vigentes" | "inactivos" | "todos"
let bloqueoEditandoId = null; // null = el formulario está creando uno nuevo
let bloqueoLevantandoId = null; // doc sobre el que está abierto el modal de "levantar fecha"
let bloqueoEliminandoId = null; // doc sobre el que está abierto el modal de "eliminar"

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function mostrarMensajeBloqueos(texto, tipo) {
  const contenedor = document.getElementById("mensaje-bloqueos");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

// Parsea una fecha ISO ("2026-09-12") en componentes locales, igual que
// turnero-motor.js — evita el corrimiento de un día que da "new Date(isoString)"
// cuando el navegador interpreta esa forma como UTC en vez de hora local.
function nombreDiaDesdeFechaISOBloqueos(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return DIAS_EN_ESPANOL_BLOQUEOS[new Date(anio, mes - 1, dia).getDay()];
}

function iniciarBloqueos(user, datosUsuario) {
  usuarioActualBloqueos = user;
  datosUsuarioActualBloqueos = datosUsuario;

  document.getElementById("select-tipo-bloqueo").addEventListener("change", onCambioTipoBloqueo);
  document.getElementById("select-sede-bloqueo").addEventListener("change", actualizarSillonesSegunSedeBloqueo);
  document.getElementById("check-franja-bloqueo").addEventListener("change", onCambioFranjaBloqueo);
  document.getElementById("form-nuevo-bloqueo").addEventListener("submit", onEnviarFormularioBloqueo);

  configurarTabsBloqueos();
  configurarCierreModalesBloqueos();

  cargarSedesBloqueos();
}

function configurarTabsBloqueos() {
  document.querySelectorAll("#filtro-tabs-bloqueos .filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => cambiarFiltroBloqueos(btn.dataset.modo));
  });
}

// Escape cierra el modal que esté abierto en ese momento (levantar o eliminar). No hace
// falta la lógica de "stack depth" de turnero-grilla.js porque acá nunca hay dos modales
// abiertos a la vez: ambos se disparan desde un botón de la misma fila del listado.
function configurarCierreModalesBloqueos() {
  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    if (document.getElementById("overlay-levantar-bloqueo").style.display !== "none") {
      cerrarModalLevantarBloqueo();
    } else if (document.getElementById("overlay-eliminar-bloqueo").style.display !== "none") {
      cerrarModalEliminarBloqueo();
    }
  });
}

async function cargarSedesBloqueos() {
  try {
    const snapshot = await db.collection("turneroSedes").get();
    sedesCacheBloqueos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    sedesCacheBloqueos.sort((a, b) => (a.id === "emilio-civit" ? -1 : 1));

    const select = document.getElementById("select-sede-bloqueo");
    select.innerHTML = sedesCacheBloqueos.map(sede =>
      `<option value="${sede.id}">${escaparHtml(sede.nombre)}</option>`
    ).join("");

    actualizarSillonesSegunSedeBloqueo();
    cargarBloqueosSegunFiltro();
  } catch (error) {
    console.error("Error al cargar sedes:", error);
    mostrarMensajeBloqueos("No se pudieron cargar las sedes.", "error");
  }
}

function actualizarSillonesSegunSedeBloqueo() {
  const sedeId = document.getElementById("select-sede-bloqueo").value;
  const sede = sedesCacheBloqueos.find(s => s.id === sedeId);
  const select = document.getElementById("select-sillon-bloqueo");
  const sillones = (sede && sede.sillones) || [];
  const sillonesOrdenados = [...sillones].sort((a, b) => a.numero - b.numero);

  select.innerHTML = '<option value="">Todos los sillones de la sede</option>' +
    sillonesOrdenados.map(s =>
      `<option value="${s.numero}">Sillón ${s.numero}${s.tipo === "backup" ? " (backup)" : ""}</option>`
    ).join("");
}

function onCambioTipoBloqueo() {
  const tipo = document.getElementById("select-tipo-bloqueo").value;
  const esPuntual = tipo === "puntual";
  document.getElementById("bloque-puntual-bloqueo").style.display = esPuntual ? "grid" : "none";
  document.getElementById("bloque-recurrente-bloqueo").style.display = esPuntual ? "none" : "grid";
  document.getElementById("campo-fecha-inicio-bloqueo").required = esPuntual;
  document.getElementById("campo-fecha-fin-bloqueo").required = esPuntual;
}

function onCambioFranjaBloqueo() {
  const activa = document.getElementById("check-franja-bloqueo").checked;
  document.getElementById("bloque-franja-bloqueo").style.display = activa ? "grid" : "none";
  if (!activa) {
    document.getElementById("campo-hora-inicio-bloqueo").value = "";
    document.getElementById("campo-hora-fin-bloqueo").value = "";
  }
}

// --- Alta y edición (Fase 3: el mismo formulario sirve para las dos) ---
//
// "Modificar" reedita el mismo documento en el lugar (decisión con Elías: a diferencia
// de los turnos, un bloqueo no tiene el mismo requisito de trazabilidad de anular y
// crear de nuevo). Como el "update" en firestore.rules no revalida el esquema, acá hay
// que tener cuidado de limpiar a mano los campos del tipo que se abandona (ej.: si un
// bloqueo pasa de "recurrente" a "puntual", hay que borrar diaSemana/fechasExceptuadas
// explícitamente con FieldValue.delete(), porque un update() nunca borra solo).

function actualizarUiModoFormularioBloqueo() {
  const editando = !!bloqueoEditandoId;
  document.getElementById("titulo-formulario-bloqueo").textContent =
    editando ? "Editar bloqueo" : "Crear bloqueo";
  document.getElementById("boton-submit-bloqueo").textContent =
    editando ? "Guardar cambios" : "Crear bloqueo";
  document.getElementById("boton-cancelar-edicion-bloqueo").style.display =
    editando ? "inline" : "none";
}

function iniciarEdicionBloqueo(id) {
  const bloqueo = bloqueosCache.find(b => b.id === id);
  if (!bloqueo) return;

  bloqueoEditandoId = id;

  document.getElementById("select-sede-bloqueo").value = bloqueo.sedeId;
  actualizarSillonesSegunSedeBloqueo();
  document.getElementById("select-sillon-bloqueo").value = bloqueo.sillon == null ? "" : String(bloqueo.sillon);

  document.getElementById("select-tipo-bloqueo").value = bloqueo.tipo;
  onCambioTipoBloqueo();

  if (bloqueo.tipo === "puntual") {
    document.getElementById("campo-fecha-inicio-bloqueo").value = bloqueo.fechaInicio;
    document.getElementById("campo-fecha-fin-bloqueo").value = bloqueo.fechaFin;
  } else {
    document.getElementById("select-dia-bloqueo").value = bloqueo.diaSemana;
  }

  document.getElementById("campo-motivo-bloqueo").value = bloqueo.motivo;

  const usaFranja = !!(bloqueo.horaInicio && bloqueo.horaFin);
  document.getElementById("check-franja-bloqueo").checked = usaFranja;
  onCambioFranjaBloqueo();
  if (usaFranja) {
    document.getElementById("campo-hora-inicio-bloqueo").value = bloqueo.horaInicio;
    document.getElementById("campo-hora-fin-bloqueo").value = bloqueo.horaFin;
  }

  actualizarUiModoFormularioBloqueo();
  document.getElementById("form-nuevo-bloqueo").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelarEdicionBloqueo() {
  bloqueoEditandoId = null;
  document.getElementById("form-nuevo-bloqueo").reset();
  onCambioTipoBloqueo();
  onCambioFranjaBloqueo();
  actualizarSillonesSegunSedeBloqueo();
  actualizarUiModoFormularioBloqueo();
}

async function onEnviarFormularioBloqueo(evento) {
  evento.preventDefault();
  const editando = !!bloqueoEditandoId;
  const boton = document.getElementById("boton-submit-bloqueo");

  const sedeId = document.getElementById("select-sede-bloqueo").value;
  const sede = sedesCacheBloqueos.find(s => s.id === sedeId);
  const tipo = document.getElementById("select-tipo-bloqueo").value;
  const sillonTexto = document.getElementById("select-sillon-bloqueo").value;
  const motivo = document.getElementById("campo-motivo-bloqueo").value.trim();
  const usaFranja = document.getElementById("check-franja-bloqueo").checked;
  const horaInicio = usaFranja ? document.getElementById("campo-hora-inicio-bloqueo").value : null;
  const horaFin = usaFranja ? document.getElementById("campo-hora-fin-bloqueo").value : null;

  if (!sede) {
    mostrarMensajeBloqueos("Elegí una sede.", "error");
    return;
  }
  if (!motivo) {
    mostrarMensajeBloqueos("El motivo es obligatorio.", "error");
    return;
  }
  if (usaFranja) {
    if (!horaInicio || !horaFin) {
      mostrarMensajeBloqueos("Cargá desde y hasta de la franja horaria, o destildá la casilla.", "error");
      return;
    }
    if (horaInicio >= horaFin) {
      mostrarMensajeBloqueos("La hora de inicio de la franja tiene que ser anterior a la de fin.", "error");
      return;
    }
    if (horaInicio < sede.horaApertura || horaFin > sede.horaCierre) {
      mostrarMensajeBloqueos(
        `La franja tiene que estar dentro del horario de atención de ${sede.nombre} (${sede.horaApertura} a ${sede.horaCierre}).`,
        "error"
      );
      return;
    }
  }

  const datosBloqueo = {
    sedeId: sede.id,
    sedeNombre: sede.nombre,
    tipo,
    motivo,
    sillon: sillonTexto ? Number(sillonTexto) : null,
    horaInicio: horaInicio || null,
    horaFin: horaFin || null
  };

  const bloqueoPrevio = editando ? bloqueosCache.find(b => b.id === bloqueoEditandoId) : null;

  if (tipo === "puntual") {
    const fechaInicio = document.getElementById("campo-fecha-inicio-bloqueo").value;
    const fechaFin = document.getElementById("campo-fecha-fin-bloqueo").value;
    if (!fechaInicio || !fechaFin) {
      mostrarMensajeBloqueos("Cargá la fecha de inicio y de fin del bloqueo.", "error");
      return;
    }
    if (fechaInicio > fechaFin) {
      mostrarMensajeBloqueos('"Desde" no puede ser posterior a "Hasta".', "error");
      return;
    }
    datosBloqueo.fechaInicio = fechaInicio;
    datosBloqueo.fechaFin = fechaFin;
    // Si venía de un bloqueo recurrente, hay que borrar sus campos propios a mano: un
    // update() nunca los borra solo por no incluirlos.
    if (editando && bloqueoPrevio && bloqueoPrevio.tipo === "recurrente") {
      datosBloqueo.diaSemana = firebase.firestore.FieldValue.delete();
      datosBloqueo.fechasExceptuadas = firebase.firestore.FieldValue.delete();
    }
  } else {
    datosBloqueo.diaSemana = document.getElementById("select-dia-bloqueo").value;
    if (!editando) {
      datosBloqueo.fechasExceptuadas = [];
    } else if (!bloqueoPrevio || bloqueoPrevio.tipo !== "recurrente") {
      // Pasa de puntual a recurrente: arranca sin excepciones, como un alta nueva.
      datosBloqueo.fechasExceptuadas = [];
      datosBloqueo.fechaInicio = firebase.firestore.FieldValue.delete();
      datosBloqueo.fechaFin = firebase.firestore.FieldValue.delete();
    } else {
      // Ya era recurrente y sigue siéndolo: fechasExceptuadas no se toca acá, se
      // administra aparte con "levantar fecha".
      datosBloqueo.fechaInicio = firebase.firestore.FieldValue.delete();
      datosBloqueo.fechaFin = firebase.firestore.FieldValue.delete();
    }
  }

  boton.disabled = true;
  boton.textContent = "Guardando...";

  try {
    if (editando) {
      await db.collection("turneroBloqueos").doc(bloqueoEditandoId).update(datosBloqueo);
      mostrarMensajeBloqueos("Bloqueo actualizado correctamente.", "exito");
    } else {
      datosBloqueo.activo = true;
      datosBloqueo.creadoPor = { uid: usuarioActualBloqueos.uid, nombre: datosUsuarioActualBloqueos.nombre || usuarioActualBloqueos.email };
      datosBloqueo.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("turneroBloqueos").add(datosBloqueo);
      mostrarMensajeBloqueos("Bloqueo creado correctamente.", "exito");
    }
    cancelarEdicionBloqueo();
    cargarBloqueosSegunFiltro();
  } catch (error) {
    console.error("Error al guardar bloqueo:", error);
    mostrarMensajeBloqueos("No se pudo guardar el bloqueo.", "error");
  } finally {
    boton.disabled = false;
    actualizarUiModoFormularioBloqueo();
  }
}

// --- Listado de gestión: filtro por tabs (Fase 3) ---

function cambiarFiltroBloqueos(modo) {
  if (modo === filtroActualBloqueos) return;
  // Si estaba editando un bloqueo, cancelar: al cambiar de tab se recarga bloqueosCache
  // y el doc que se estaba editando puede dejar de estar ahí (ej. pasa a "Inactivos"),
  // lo que rompería la comparación con el tipo previo al guardar (ver onEnviarFormularioBloqueo).
  if (bloqueoEditandoId) cancelarEdicionBloqueo();
  filtroActualBloqueos = modo;
  document.querySelectorAll("#filtro-tabs-bloqueos .filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  cargarBloqueosSegunFiltro();
}

async function cargarBloqueosSegunFiltro() {
  const contenedor = document.getElementById("contenedor-bloqueos");
  contenedor.innerHTML = `<p style="color:var(--color-muted);">Cargando...</p>`;

  try {
    let consulta = db.collection("turneroBloqueos");
    if (filtroActualBloqueos === "vigentes") consulta = consulta.where("activo", "==", true);
    else if (filtroActualBloqueos === "inactivos") consulta = consulta.where("activo", "==", false);
    // "todos": sin where, se traen los dos estados.

    const snapshot = await consulta.get();
    bloqueosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Se ordena en el cliente (más reciente primero), mismo criterio que antes.
    bloqueosCache.sort((a, b) => (b.creadoEn ? b.creadoEn.toMillis() : 0) - (a.creadoEn ? a.creadoEn.toMillis() : 0));
    renderizarBloqueos();
  } catch (error) {
    console.error("Error al cargar bloqueos:", error);
    contenedor.innerHTML = `<p style="color:var(--color-danger);">No se pudieron cargar los bloqueos.</p>`;
  }
}

function formatearFechaLegibleBloqueo(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearCuandoBloqueo(bloqueo) {
  if (bloqueo.tipo === "recurrente") {
    const label = `Todos los ${DIAS_LABEL_BLOQUEOS[bloqueo.diaSemana] || bloqueo.diaSemana}`;
    const excepciones = bloqueo.fechasExceptuadas || [];
    if (excepciones.length === 0) return label;
    return `${label} (levantado el ${excepciones.map(formatearFechaLegibleBloqueo).join(", ")})`;
  }
  if (bloqueo.fechaInicio === bloqueo.fechaFin) {
    return formatearFechaLegibleBloqueo(bloqueo.fechaInicio);
  }
  return `${formatearFechaLegibleBloqueo(bloqueo.fechaInicio)} al ${formatearFechaLegibleBloqueo(bloqueo.fechaFin)}`;
}

function formatearFranjaBloqueo(bloqueo) {
  if (!bloqueo.horaInicio || !bloqueo.horaFin) return "Todo el horario";
  return `${bloqueo.horaInicio} a ${bloqueo.horaFin}`;
}

function formatearSillonBloqueo(bloqueo) {
  return bloqueo.sillon == null ? "Todos" : `Sillón ${bloqueo.sillon}`;
}

function renderizarBloqueos() {
  const contenedor = document.getElementById("contenedor-bloqueos");

  if (bloqueosCache.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--color-muted);">${TEXTOS_VACIO_BLOQUEOS[filtroActualBloqueos]}</p>`;
    return;
  }

  const filas = bloqueosCache.map(bloqueo => {
    const inactivo = bloqueo.activo === false;

    const estadoCelda = inactivo
      ? `<span class="badge">Inactivo</span><br><span style="font-size:12px;color:var(--color-muted);">${escaparHtml(bloqueo.motivoBaja || "-")}${bloqueo.bajaPor ? " · " + escaparHtml(bloqueo.bajaPor.nombre) : ""}</span>`
      : `<span class="badge badge-nuevo">Vigente</span>`;

    let acciones;
    if (inactivo) {
      acciones = `<button type="button" class="enlace-accion" onclick="reactivarBloqueo('${bloqueo.id}')">reactivar</button>`;
    } else {
      const botonLevantar = bloqueo.tipo === "recurrente"
        ? `<button type="button" class="enlace-accion" onclick="abrirModalLevantarBloqueo('${bloqueo.id}')">levantar fecha</button>`
        : "";
      acciones = `
        ${botonLevantar}
        <button type="button" class="enlace-accion" onclick="iniciarEdicionBloqueo('${bloqueo.id}')">modificar</button>
        <button type="button" class="enlace-accion peligro" onclick="abrirModalEliminarBloqueo('${bloqueo.id}')">eliminar</button>
      `;
    }

    return `
      <tr class="${inactivo ? "inactivo" : ""}">
        <td>${escaparHtml(bloqueo.sedeNombre)}</td>
        <td>${escaparHtml(formatearCuandoBloqueo(bloqueo))}</td>
        <td>${escaparHtml(formatearSillonBloqueo(bloqueo))}</td>
        <td>${escaparHtml(formatearFranjaBloqueo(bloqueo))}</td>
        <td>${escaparHtml(bloqueo.motivo)}</td>
        <td>${escaparHtml((bloqueo.creadoPor && bloqueo.creadoPor.nombre) || "")}</td>
        <td>${estadoCelda}</td>
        <td class="acciones-fila"><div class="grupo-acciones">${acciones}</div></td>
      </tr>
    `;
  }).join("");

  contenedor.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="tabla">
        <thead>
          <tr><th>Sede</th><th>Cuándo</th><th>Sillón</th><th>Franja</th><th>Motivo</th><th>Creado por</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

// --- "Levantar" una fecha puntual de un bloqueo recurrente (Fase 3) ---

function abrirModalLevantarBloqueo(id) {
  const bloqueo = bloqueosCache.find(b => b.id === id);
  if (!bloqueo) return;

  bloqueoLevantandoId = id;
  document.getElementById("texto-modal-levantar-bloqueo").textContent =
    `${bloqueo.sedeNombre} · todos los ${DIAS_LABEL_BLOQUEOS[bloqueo.diaSemana] || bloqueo.diaSemana}`;
  document.getElementById("campo-fecha-levantar-bloqueo").value = "";

  const excepciones = bloqueo.fechasExceptuadas || [];
  document.getElementById("lista-excepciones-levantar-bloqueo").textContent =
    excepciones.length ? excepciones.map(formatearFechaLegibleBloqueo).join(", ") : "ninguna todavía";

  document.getElementById("overlay-levantar-bloqueo").style.display = "flex";
}

function cerrarModalLevantarBloqueoSiFondo(evento) {
  if (evento.target.id === "overlay-levantar-bloqueo") cerrarModalLevantarBloqueo();
}

function cerrarModalLevantarBloqueo() {
  bloqueoLevantandoId = null;
  document.getElementById("overlay-levantar-bloqueo").style.display = "none";
}

async function confirmarLevantarBloqueo() {
  const bloqueo = bloqueosCache.find(b => b.id === bloqueoLevantandoId);
  if (!bloqueo) return;

  const fecha = document.getElementById("campo-fecha-levantar-bloqueo").value;
  if (!fecha) {
    alert("Elegí una fecha.");
    return;
  }

  const nombreDia = nombreDiaDesdeFechaISOBloqueos(fecha);
  if (nombreDia !== bloqueo.diaSemana) {
    alert(`Esa fecha es ${DIAS_LABEL_BLOQUEOS[nombreDia]}, no ${DIAS_LABEL_BLOQUEOS[bloqueo.diaSemana]}. El bloqueo no rige ahí, no hace falta levantarlo.`);
    return;
  }
  if ((bloqueo.fechasExceptuadas || []).includes(fecha)) {
    alert("Esa fecha ya estaba levantada.");
    return;
  }

  try {
    await db.collection("turneroBloqueos").doc(bloqueo.id).update({
      fechasExceptuadas: firebase.firestore.FieldValue.arrayUnion(fecha)
    });
    mostrarMensajeBloqueos("Fecha levantada correctamente.", "exito");
    cerrarModalLevantarBloqueo();
    cargarBloqueosSegunFiltro();
  } catch (error) {
    console.error("Error al levantar fecha:", error);
    mostrarMensajeBloqueos("No se pudo levantar la fecha.", "error");
  }
}

// --- "Eliminar" (baja lógica, con motivo obligatorio) y "reactivar" (Fase 3) ---

function abrirModalEliminarBloqueo(id) {
  const bloqueo = bloqueosCache.find(b => b.id === id);
  if (!bloqueo) return;

  bloqueoEliminandoId = id;
  document.getElementById("texto-modal-eliminar-bloqueo").textContent =
    `${bloqueo.sedeNombre} · ${formatearCuandoBloqueo(bloqueo)} · ${formatearSillonBloqueo(bloqueo)} · ${formatearFranjaBloqueo(bloqueo)}`;
  document.getElementById("campo-motivo-eliminar-bloqueo").value = "";

  document.getElementById("overlay-eliminar-bloqueo").style.display = "flex";
}

function cerrarModalEliminarBloqueoSiFondo(evento) {
  if (evento.target.id === "overlay-eliminar-bloqueo") cerrarModalEliminarBloqueo();
}

function cerrarModalEliminarBloqueo() {
  bloqueoEliminandoId = null;
  document.getElementById("overlay-eliminar-bloqueo").style.display = "none";
}

async function confirmarEliminarBloqueo() {
  const motivo = document.getElementById("campo-motivo-eliminar-bloqueo").value.trim();
  if (!motivo) {
    alert("El motivo es obligatorio.");
    return;
  }

  try {
    await db.collection("turneroBloqueos").doc(bloqueoEliminandoId).update({
      activo: false,
      motivoBaja: motivo,
      bajaPor: { uid: usuarioActualBloqueos.uid, nombre: datosUsuarioActualBloqueos.nombre || usuarioActualBloqueos.email },
      bajaEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    mostrarMensajeBloqueos("Bloqueo eliminado.", "exito");
    cerrarModalEliminarBloqueo();
    cargarBloqueosSegunFiltro();
  } catch (error) {
    console.error("Error al eliminar bloqueo:", error);
    mostrarMensajeBloqueos("No se pudo eliminar el bloqueo.", "error");
  }
}

// Sin motivo, a diferencia de "eliminar" — mismo criterio que
// turnero-protocolos.js/medicamentos.js, donde reactivar tampoco lo pide.
async function reactivarBloqueo(id) {
  if (!confirm("¿Reactivar este bloqueo?")) return;

  try {
    await db.collection("turneroBloqueos").doc(id).update({ activo: true });
    mostrarMensajeBloqueos("Bloqueo reactivado.", "exito");
    cargarBloqueosSegunFiltro();
  } catch (error) {
    console.error("Error al reactivar bloqueo:", error);
    mostrarMensajeBloqueos("No se pudo reactivar el bloqueo.", "error");
  }
}

// --- Exportar a Excel (Fase 3) — mismo patrón que exportarHistorialTurnosAExcel() en
// turnero-historial.js. Exporta lo que esté cargado en pantalla con el filtro activo
// (vigentes/inactivos/todos), no siempre "todos". ---

function exportarBloqueosAExcel() {
  const boton = document.getElementById("boton-exportar-bloqueos");

  if (bloqueosCache.length === 0) {
    alert("No hay datos para exportar con el filtro actual.");
    return;
  }

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Exportando...";

  try {
    const filas = bloqueosCache.map(bloqueo => ({
      Sede: bloqueo.sedeNombre,
      Cuándo: formatearCuandoBloqueo(bloqueo),
      Sillón: formatearSillonBloqueo(bloqueo),
      Franja: formatearFranjaBloqueo(bloqueo),
      Motivo: bloqueo.motivo || "",
      "Creado por": (bloqueo.creadoPor && bloqueo.creadoPor.nombre) || "",
      Estado: bloqueo.activo === false ? "Inactivo" : "Vigente",
      "Motivo de baja": bloqueo.activo === false ? (bloqueo.motivoBaja || "") : "",
      "Dado de baja por": bloqueo.activo === false ? ((bloqueo.bajaPor && bloqueo.bajaPor.nombre) || "") : ""
    }));

    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Bloqueos");

    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `bloqueos_${filtroActualBloqueos}_${fecha}.xlsx`);
  } catch (error) {
    console.error("Error al exportar bloqueos a Excel:", error);
    mostrarMensajeBloqueos("No se pudo exportar.", "error");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}
