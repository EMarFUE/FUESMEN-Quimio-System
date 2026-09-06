// Lógica de la pantalla "Bloqueos" del módulo de Turnero (Etapa T9, Fase 1).
// Colección "turneroBloqueos". Pantalla exclusiva de administrador (ver punto 16 del
// alcance de Turnero), tanto para crear como para el listado de gestión.
//
// Fase 1 (de 4): modelo de datos y formulario de carga, más un listado simple de
// vigentes sin acciones — solo para confirmar visualmente lo cargado. Levantar,
// modificar y eliminar un bloqueo (baja lógica vía "activo": false, nunca borrado
// físico, mismo criterio que el resto del sistema) llegan en la Fase 3. El motor de
// huecos (turnero-motor.js) todavía no lee esta colección — eso es la Fase 2.
//
// Un bloqueo tiene sede, motivo, sillón opcional (vacío = todos los sillones de esa
// sede) y franja horaria opcional (vacía = todo el horario de atención de ese día).
// Es "puntual" (fechaInicio/fechaFin, mismo valor en las dos si es un solo día) o
// "recurrente" (diaSemana, indefinido, con "fechasExceptuadas" para levantar una fecha
// puntual sin borrar la regla general — así se resuelven los sábados de Emilio Civit
// con el mismo mecanismo, sin un segundo sistema aparte).

const DIAS_SEMANA_BLOQUEOS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_LABEL_BLOQUEOS = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes", sabado: "Sábado"
};

let sedesCacheBloqueos = [];
let bloqueosCache = [];
let usuarioActualBloqueos = null;
let datosUsuarioActualBloqueos = null;

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

function iniciarBloqueos(user, datosUsuario) {
  usuarioActualBloqueos = user;
  datosUsuarioActualBloqueos = datosUsuario;

  document.getElementById("select-tipo-bloqueo").addEventListener("change", onCambioTipoBloqueo);
  document.getElementById("select-sede-bloqueo").addEventListener("change", actualizarSillonesSegunSedeBloqueo);
  document.getElementById("check-franja-bloqueo").addEventListener("change", onCambioFranjaBloqueo);
  document.getElementById("form-nuevo-bloqueo").addEventListener("submit", onCrearBloqueo);

  cargarSedesBloqueos();
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
    cargarBloqueosVigentes();
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

async function onCrearBloqueo(evento) {
  evento.preventDefault();
  const boton = evento.target.querySelector("button[type=submit]");

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

  const bloqueo = {
    sedeId: sede.id,
    sedeNombre: sede.nombre,
    tipo,
    motivo,
    sillon: sillonTexto ? Number(sillonTexto) : null,
    horaInicio: horaInicio || null,
    horaFin: horaFin || null,
    activo: true,
    creadoPor: { uid: usuarioActualBloqueos.uid, nombre: datosUsuarioActualBloqueos.nombre || usuarioActualBloqueos.email },
    creadoEn: firebase.firestore.FieldValue.serverTimestamp()
  };

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
    bloqueo.fechaInicio = fechaInicio;
    bloqueo.fechaFin = fechaFin;
  } else {
    bloqueo.diaSemana = document.getElementById("select-dia-bloqueo").value;
    bloqueo.fechasExceptuadas = [];
  }

  boton.disabled = true;
  boton.textContent = "Guardando...";

  try {
    await db.collection("turneroBloqueos").add(bloqueo);
    mostrarMensajeBloqueos("Bloqueo creado correctamente.", "exito");
    evento.target.reset();
    onCambioTipoBloqueo();
    onCambioFranjaBloqueo();
    actualizarSillonesSegunSedeBloqueo();
    cargarBloqueosVigentes();
  } catch (error) {
    console.error("Error al crear bloqueo:", error);
    mostrarMensajeBloqueos("No se pudo crear el bloqueo.", "error");
  } finally {
    boton.disabled = false;
    boton.textContent = "Crear bloqueo";
  }
}

async function cargarBloqueosVigentes() {
  const contenedor = document.getElementById("contenedor-bloqueos");
  contenedor.innerHTML = `<p style="color:var(--color-muted);">Cargando...</p>`;

  try {
    const snapshot = await db.collection("turneroBloqueos").where("activo", "==", true).get();
    bloqueosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Se ordena en el cliente (más reciente primero) para no depender de un índice
    // compuesto de Firestore por una lista que, en esta fase, no filtra por nada más.
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
    contenedor.innerHTML = `<p style="color:var(--color-muted);">No hay bloqueos vigentes.</p>`;
    return;
  }

  const filas = bloqueosCache.map(bloqueo => `
    <tr>
      <td>${escaparHtml(bloqueo.sedeNombre)}</td>
      <td>${escaparHtml(formatearCuandoBloqueo(bloqueo))}</td>
      <td>${escaparHtml(formatearSillonBloqueo(bloqueo))}</td>
      <td>${escaparHtml(formatearFranjaBloqueo(bloqueo))}</td>
      <td>${escaparHtml(bloqueo.motivo)}</td>
      <td>${escaparHtml((bloqueo.creadoPor && bloqueo.creadoPor.nombre) || "")}</td>
    </tr>
  `).join("");

  contenedor.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="tabla">
        <thead>
          <tr><th>Sede</th><th>Cuándo</th><th>Sillón</th><th>Franja</th><th>Motivo</th><th>Creado por</th></tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}
