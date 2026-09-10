// Vista de agenda semanal — Etapa T6 del Módulo de Turnero.
// Fase 1 (de 3): grilla de solo lectura. Elegir sede, navegar la semana, ver los
// turnos ya cargados como tarjetas dentro de su día y horario, con el sillón
// como etiqueta visible para el personal. Sin modal de carga ni arrastre todavía
// (llegan en las Fases 2 y 3).
//
// Ronda de ajustes (2/9): se agregó el sábado como sexta columna (mismo horario
// que el resto de la semana — todavía no existe el mecanismo de "bloqueo
// invertido" del punto 3 del alcance para los sábados puntuales de Emilio Civit,
// así que esto es solo una columna más en la grilla, no cambia el motor de
// búsqueda de huecos), filtro por médico, más datos en la tarjeta cuando la
// altura del bloque lo permite (ciclo/sesión, DNI, obra social), y modo de
// pantalla completa para aprovechar mejor el alto de la pantalla.
//
// Reutiliza los helpers de fecha/hora de turnero-motor.js (minutoDesdeString,
// stringDesdeMinuto, fechaISO) — este archivo no los redeclara.
//
// Nomenclatura: todo lo declarado acá lleva el sufijo "Grilla" a propósito.
// turnero-carga.js se suma a esta misma página en la Fase 2 (modal "+ nuevo
// turno") y ya tiene sus propias const/let/function de nivel superior —
// evitar colisión de scope global entre los tres archivos, mismo criterio que
// ya se viene aplicando desde T3.

const DIAS_SEMANA_GRILLA = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_LABEL_GRILLA = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes", sabado: "Sábado"
};
const MESES_LABEL_GRILLA = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];
const PIXELES_POR_MINUTO_GRILLA = 2; // escala vertical de la grilla

let sedesCacheGrilla = [];
let turnosCacheGrilla = [];
let sedeSeleccionadaGrilla = null; // id de la sede activa (p. ej. "emilio-civit")
let semanaOffsetGrilla = 0; // 0 = semana actual, -1 = anterior, +1 = siguiente
let medicoFiltroGrilla = null; // null = todos los médicos
let rolActualGrilla = null;
let usuarioActualGrilla = null;
let datosUsuarioActualGrilla = null;
let modalNuevoTurnoInicializadoGrilla = false;

// Fase 3 (T6): caches propios de médicos y cupos, para que el motor extendido
// (buscarHuecosSemanaEnSede) tenga lo que necesita para atadura/cupo sin depender de
// que turnero-carga.js ya haya cargado los suyos (medicosCacheCarga/cuposCacheCarga
// solo se llenan cuando se abre el modal "+ nuevo turno" al menos una vez — si alguien
// arrastra un turno antes de abrir ese modal, esos caches estarían vacíos y la atadura/
// cupo se saltearían en silencio). Se cargan una vez al iniciar la agenda, igual que
// sedesCacheGrilla.
let medicosCacheGrilla = [];
let cuposCacheGrilla = [];
let bloqueosCacheGrilla = []; // T9: array de docs de turneroBloqueos (activos)

// Fase 3 (T6): estado del arrastre en curso (null cuando no se está arrastrando nada).
let arrastreActivoGrilla = null;

// Etapa T7: arrastre pendiente de motivo (el candidato ya se soltó en un hueco válido,
// pero todavía no se guardó — espera a que se complete el modal de motivo). También lo
// usa "Reasignar" por formulario (mismo modal de motivo, otro origen).
let arrastrePendienteGrilla = null;

// Etapa T7 — Reasignar por formulario: id del turno que se está reasignando mientras el
// modal de búsqueda está abierto.
let turnoIdReasignarActual = null;

// Etapa T7 — Modificar por formulario: id del turno que se está modificando mientras el
// modal de edición está abierto.
let turnoIdModificarActual = null;

function escaparHtmlGrilla(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// --- Cálculo de la semana visible (lunes a sábado) ---

function calcularLunesGrilla(fechaBase) {
  const fecha = new Date(fechaBase);
  const diaSemana = fecha.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
  const diferencia = diaSemana === 0 ? -6 : 1 - diaSemana;
  fecha.setDate(fecha.getDate() + diferencia);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

function obtenerDiasVisiblesGrilla() {
  const lunesActual = calcularLunesGrilla(new Date());
  const lunesVisible = new Date(lunesActual);
  lunesVisible.setDate(lunesVisible.getDate() + semanaOffsetGrilla * 7);

  const dias = [];
  for (let i = 0; i < 6; i++) { // lunes a sábado
    const dia = new Date(lunesVisible);
    dia.setDate(dia.getDate() + i);
    dias.push(dia);
  }
  return dias;
}

function formatearRangoSemanaGrilla(dias) {
  const primero = dias[0];
  const ultimo = dias[dias.length - 1];
  if (primero.getMonth() === ultimo.getMonth()) {
    return `${primero.getDate()} al ${ultimo.getDate()} de ${MESES_LABEL_GRILLA[primero.getMonth()]} de ${primero.getFullYear()}`;
  }
  return `${primero.getDate()} de ${MESES_LABEL_GRILLA[primero.getMonth()]} al ${ultimo.getDate()} de ${MESES_LABEL_GRILLA[ultimo.getMonth()]} de ${ultimo.getFullYear()}`;
}

// --- Inicio de la pantalla ---

async function iniciarAgenda(user, datosUsuario) {
  rolActualGrilla = datosUsuario.rol;
  usuarioActualGrilla = user;
  datosUsuarioActualGrilla = datosUsuario;

  // Fase 2: "+ nuevo turno" — mismos roles que ya podían cargar en carga.html
  // (administrativo queda sin este botón, solo lectura de la agenda).
  if (rolActualGrilla !== "administrativo") {
    document.getElementById("boton-nuevo-turno-grilla").style.display = "inline-block";
    // Etapa T10: mismos roles que "+ nuevo turno" (administrativo queda sin esto
    // tampoco, aunque no guarde nada — decisión explícita con Elías).
    document.getElementById("boton-consultar-disponibilidad-grilla").style.display = "inline-block";
  }

  try {
    await Promise.all([cargarSedesGrilla(), cargarMedicosGrilla(), cargarCuposGrilla(), cargarBloqueosGrilla()]);
  } catch (error) {
    console.error("Error al cargar sedes:", error);
    document.getElementById("grilla-contenedor").innerHTML =
      `<p style="color:var(--color-danger);padding:20px;">No se pudieron cargar las sedes.</p>`;
    return;
  }

  if (sedesCacheGrilla.length === 0) {
    document.getElementById("grilla-contenedor").innerHTML =
      `<p style="color:var(--color-muted);padding:20px;">Todavía no hay sedes cargadas. Un administrador puede cargarlas desde "Sedes y sillones".</p>`;
    return;
  }

  sedeSeleccionadaGrilla = sedesCacheGrilla.some(s => s.id === "entre-rios")
    ? "entre-rios"
    : sedesCacheGrilla[0].id;

  renderizarSelectorSedeGrilla();
  await cargarYRenderizarGrilla();
}

async function cargarSedesGrilla() {
  const snapshot = await db.collection("turneroSedes").get();
  sedesCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  sedesCacheGrilla.sort((a, b) => (a.id === "emilio-civit" ? -1 : 1));
}

async function cargarMedicosGrilla() {
  const snapshot = await db.collection("turneroMedicos").get();
  medicosCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function cargarCuposGrilla() {
  const snapshot = await db.collection("turneroCupos").get();
  cuposCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Etapa T9: bloqueos vigentes, para que el arrastre respete sillones/franjas/días
// bloqueados igual que la búsqueda por formulario.
async function cargarBloqueosGrilla() {
  const snapshot = await db.collection("turneroBloqueos").where("activo", "==", true).get();
  bloqueosCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function renderizarSelectorSedeGrilla() {
  const contenedor = document.getElementById("selector-sede-grilla");
  contenedor.innerHTML = sedesCacheGrilla.map(sede => `
    <button type="button" class="boton-sede-grilla ${sede.id === sedeSeleccionadaGrilla ? "activo" : ""}"
      onclick="cambiarSedeGrilla('${sede.id}')">${escaparHtmlGrilla(sede.nombre)}</button>
  `).join("");
}

async function cambiarSedeGrilla(sedeId) {
  sedeSeleccionadaGrilla = sedeId;
  medicoFiltroGrilla = null; // el listado de médicos cambia con la sede
  renderizarSelectorSedeGrilla();
  await cargarYRenderizarGrilla();
}

async function cambiarSemanaGrilla(delta) {
  semanaOffsetGrilla += delta;
  await cargarYRenderizarGrilla();
}

async function irASemanaActualGrilla() {
  semanaOffsetGrilla = 0;
  await cargarYRenderizarGrilla();
}

// --- Filtro por médico ---

function poblarFiltroMedicoGrilla() {
  const nombres = Array.from(new Set(
    turnosCacheGrilla.map(t => t.medicoNombre).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "es"));

  // Si el médico filtrado ya no aparece en esta sede/semana, volver a "Todos"
  // en vez de dejar el filtro aplicado sobre una opción que no existe más.
  if (medicoFiltroGrilla && !nombres.includes(medicoFiltroGrilla)) {
    medicoFiltroGrilla = null;
  }

  const select = document.getElementById("filtro-medico-grilla");
  select.innerHTML = `<option value="">Todos los médicos</option>` +
    nombres.map(nombre => `<option value="${escaparHtmlGrilla(nombre)}" ${nombre === medicoFiltroGrilla ? "selected" : ""}>${escaparHtmlGrilla(nombre)}</option>`).join("");
}

function cambiarFiltroMedicoGrilla(valor) {
  medicoFiltroGrilla = valor || null;
  renderizarGrilla(); // ya está todo en caché, no hace falta volver a consultar Firestore
}

// --- Modal "+ nuevo turno" (Fase 2) ---
// Reutiliza el formulario y la lógica de turnero-carga.js sin tocarlos. La primera
// vez que se abre, se inicializa completo (listeners + datos + primera fila de
// protocolo). Las siguientes veces solo se refrescan los datos (sobre todo turnos,
// para que el motor no trabaje con información vieja) y se resetea el formulario
// con las funciones que turnero-carga.js ya expone para eso — evita re-adjuntar
// listeners duplicados o duplicar filas de protocolo.

async function abrirModalNuevoTurnoGrilla() {
  document.getElementById("overlay-nuevo-turno-grilla").style.display = "flex";

  if (!modalNuevoTurnoInicializadoGrilla) {
    modalNuevoTurnoInicializadoGrilla = true;
    await iniciarCargaTurno(usuarioActualGrilla, datosUsuarioActualGrilla);
    observarGuardadoTurnoGrilla();
  } else {
    await Promise.all([
      cargarPacientesCarga(), cargarMedicosCarga(), cargarProtocolosCarga(),
      cargarSedesCarga(), cargarTurnosExistentes(), cargarCuposCarga(), cargarBloqueosCarga()
    ]);
    poblarSelectMedico();
    poblarSelectSedeManual();
    resetearFormularioCarga();
  }
}

function cerrarModalNuevoTurnoGrilla() {
  document.getElementById("overlay-nuevo-turno-grilla").style.display = "none";
  cargarYRenderizarGrilla(); // por si se guardó algún turno mientras estaba abierto
}

function observarGuardadoTurnoGrilla() {
  const mensaje = document.getElementById("mensaje-general");
  const observer = new MutationObserver(() => {
    // Ojo si se cambia el texto de éxito en turnero-carga.js: este chequeo tiene que
    // seguir empezando igual. Bug real de la Etapa T8: al agregar "Abriendo
    // comprobante…" al final del mensaje, la comparación exacta de acá dejó de
    // cumplirse y el modal quedó de nuevo abierto — cambiado a startsWith() para que no
    // dependa de que el mensaje completo quede idéntico letra por letra.
    if (mensaje.textContent.trim().startsWith("Turno guardado correctamente.")) {
      // Antes (T2) el modal quedaba abierto a propósito para cargar varios turnos
      // seguidos sin reabrirlo cada vez. A pedido de Elías ahora se cierra solo — se
      // deja un instante el mensaje de éxito visible antes de cerrar, para que no
      // desaparezca de golpe sin que se llegue a leer.
      setTimeout(() => cerrarModalNuevoTurnoGrilla(), 900);
    }
  });
  observer.observe(mensaje, { childList: true, characterData: true, subtree: true });
}

// Cierre con Escape para los modales de la agenda. A pedido de Elías para el de "nuevo
// turno"; se generaliza acá a los demás por consistencia. Revisa primero los tres que
// se superponen al de "nuevo turno" durante la búsqueda (sobreturno/cupo/atadura) —
// si alguno de esos está abierto, Escape cierra ese y no el de atrás.
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;

  const modalSobreturno = document.getElementById("modal-sobreturno");
  if (modalSobreturno && modalSobreturno.style.display !== "none") {
    cerrarModalSobreturno();
    return;
  }
  const modalCupo = document.getElementById("modal-bloqueo-cupo");
  if (modalCupo && modalCupo.style.display !== "none") {
    cerrarModalBloqueoCupo();
    return;
  }
  const modalAtadura = document.getElementById("modal-bloqueo-atadura");
  if (modalAtadura && modalAtadura.style.display !== "none") {
    cerrarModalBloqueoAtadura();
    return;
  }
  const overlayMotivo = document.getElementById("overlay-motivo-arrastre-grilla");
  if (overlayMotivo && overlayMotivo.style.display !== "none") {
    cancelarMotivoArrastreGrilla();
    return;
  }
  const overlayReasignar = document.getElementById("overlay-reasignar-grilla");
  if (overlayReasignar && overlayReasignar.style.display !== "none") {
    cerrarReasignarGrilla();
    return;
  }
  const overlayModificar = document.getElementById("overlay-modificar-grilla");
  if (overlayModificar && overlayModificar.style.display !== "none") {
    cerrarModificarGrilla();
    return;
  }
  const overlayDetalle = document.getElementById("overlay-detalle-turno-grilla");
  if (overlayDetalle && overlayDetalle.style.display !== "none") {
    cerrarDetalleTurnoGrilla();
    return;
  }
  const overlayDetalleBloqueo = document.getElementById("overlay-detalle-bloqueo-grilla");
  if (overlayDetalleBloqueo && overlayDetalleBloqueo.style.display !== "none") {
    cerrarDetalleBloqueoGrilla();
    return;
  }
  const overlayNuevoTurno = document.getElementById("overlay-nuevo-turno-grilla");
  if (overlayNuevoTurno && overlayNuevoTurno.style.display !== "none") {
    cerrarModalNuevoTurnoGrilla();
    return;
  }
  const overlayConsultaDisponibilidad = document.getElementById("overlay-consulta-disponibilidad-grilla");
  if (overlayConsultaDisponibilidad && overlayConsultaDisponibilidad.style.display !== "none") {
    cerrarConsultaDisponibilidadGrilla();
    return;
  }
});

// --- Menú de cuenta (contraído por defecto: volver a Turnero / cerrar sesión) ---

function alternarMenuCuentaGrilla(evento) {
  evento.stopPropagation();
  const panel = document.getElementById("panel-menu-cuenta-grilla");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

document.addEventListener("click", (evento) => {
  const panel = document.getElementById("panel-menu-cuenta-grilla");
  if (!panel || panel.style.display !== "block") return;
  const boton = document.querySelector(".boton-menu-cuenta-grilla");
  if (panel.contains(evento.target) || (boton && boton.contains(evento.target))) return;
  panel.style.display = "none";
});

// --- Carga de turnos de la sede activa ---

// Etapa T12: antes traía TODOS los turnos activos de la sede, sin límite de fecha —
// cada cambio de semana, cada guardado, cada arrastre volvía a leer la historia
// completa. El arrastre solo calcula huecos contra la semana visible
// (obtenerDiasVisiblesGrilla(), ver armarArrastreGrilla()), y Elías pidió dejar
// margen para poder reasignar a la semana siguiente sin sentirse limitado — por eso
// la ventana son dos semanas (la visible + la que sigue), no una sola.
async function cargarTurnosGrilla() {
  const diasVisibles = obtenerDiasVisiblesGrilla();
  const desde = fechaISO(diasVisibles[0]);
  const hastaDate = new Date(diasVisibles[0]);
  hastaDate.setDate(hastaDate.getDate() + 14);
  const hasta = fechaISO(hastaDate);

  const snapshot = await db.collection("turnos")
    .where("sedeId", "==", sedeSeleccionadaGrilla)
    .where("estado", "==", "activo")
    .where("fecha", ">=", desde)
    .where("fecha", "<=", hasta)
    .get();
  turnosCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function cargarYRenderizarGrilla() {
  const contenedor = document.getElementById("grilla-contenedor");
  contenedor.innerHTML = `<p style="color:var(--color-muted);padding:20px;">Cargando...</p>`;

  try {
    await cargarTurnosGrilla();
    poblarFiltroMedicoGrilla();
    renderizarGrilla();
  } catch (error) {
    console.error("Error al cargar la agenda:", error);
    contenedor.innerHTML = `<p style="color:var(--color-danger);padding:20px;">No se pudo cargar la agenda. Reintentá en unos segundos.</p>`;
  }
}

// --- Fase 3 (T6): separar turnos superpuestos en carriles ---
// Antes del arrastre, dos turnos que coincidían en horario (sillones distintos)
// quedaban tapados uno encima del otro (las tarjetas usaban left:4px;right:4px fijo,
// sin importar cuántos turnos había a la misma hora). Con el arrastre esto se vuelve
// mucho más común de ver, así que se resuelve acá: agrupa los turnos que se solapan en
// el tiempo en "racimos" y les asigna un carril (0, 1, 2...) dentro de su racimo, para
// poder ubicarlos lado a lado. Mismo criterio que usan Google Calendar/Outlook en su
// vista semanal. Devuelve un Map(turnoId -> {lane, totalLanes}).
function calcularLanesDiaGrilla(turnosDelDia) {
  const turnosOrdenados = [...turnosDelDia].sort((a, b) => {
    const ia = minutoDesdeString(a.horarioInicio), ib = minutoDesdeString(b.horarioInicio);
    if (ia !== ib) return ia - ib;
    return minutoDesdeString(a.horarioFin) - minutoDesdeString(b.horarioFin);
  });

  const resultado = new Map();
  let clusterActual = [];
  let finesDeLanesCluster = [];
  let finMaximoClusterActual = -Infinity;

  function cerrarCluster() {
    if (clusterActual.length === 0) return;
    const totalLanes = finesDeLanesCluster.length;
    clusterActual.forEach(({ turno, lane }) => resultado.set(turno.id, { lane, totalLanes }));
    clusterActual = [];
    finesDeLanesCluster = [];
  }

  for (const turno of turnosOrdenados) {
    const inicio = minutoDesdeString(turno.horarioInicio);
    const fin = minutoDesdeString(turno.horarioFin);

    if (clusterActual.length > 0 && inicio >= finMaximoClusterActual) {
      cerrarCluster();
      finMaximoClusterActual = -Infinity;
    }

    let laneAsignada = finesDeLanesCluster.findIndex(finLane => finLane <= inicio);
    if (laneAsignada === -1) {
      laneAsignada = finesDeLanesCluster.length;
      finesDeLanesCluster.push(fin);
    } else {
      finesDeLanesCluster[laneAsignada] = fin;
    }

    clusterActual.push({ turno, lane: laneAsignada });
    finMaximoClusterActual = Math.max(finMaximoClusterActual, fin);
  }
  cerrarCluster();

  return resultado;
}

// --- Fase 3 (T6): quién puede arrastrar este turno puntual ---
// Administrador y enfermería: cualquier turno. Médico: solo los propios (comparando
// medicoId contra su propio medicoId). Administrativo: nunca (ni siquiera ve el botón
// "+ nuevo turno"). Los turnos de "Otro" derivante guardan medicoId: null, así que
// nunca van a coincidir con el medicoId de un médico logueado — quedan protegidos sin
// necesidad de un caso especial.
function puedeArrastrarTurnoGrilla(turno) {
  if (rolActualGrilla === "administrador" || rolActualGrilla === "enfermeria") return true;
  if (rolActualGrilla === "medico") {
    if (!datosUsuarioActualGrilla.medicoId || turno.medicoId !== datosUsuarioActualGrilla.medicoId) return false;
    // Permiso nuevo: si el administrador deshabilitó a este médico para cargar/modificar
    // turnos, no puede arrastrar ni los suyos propios (ver turnero-medicos.js). Si el
    // caché de médicos todavía no cargó, no se bloquea acá — firestore.rules protege
    // del lado del servidor de todas formas.
    const medicoPropio = medicosCacheGrilla.find(m => m.id === datosUsuarioActualGrilla.medicoId);
    return !medicoPropio || medicoPropio.habilitadoParaCargar !== false;
  }
  return false;
}

// --- Render de la grilla ---

function renderizarGrilla() {
  const sede = sedesCacheGrilla.find(s => s.id === sedeSeleccionadaGrilla);
  const dias = obtenerDiasVisiblesGrilla();
  document.getElementById("etiqueta-semana-grilla").textContent = formatearRangoSemanaGrilla(dias);

  const minutoApertura = minutoDesdeString(sede.horaApertura);
  const minutoCierre = minutoDesdeString(sede.horaCierre);
  const alturaTotal = (minutoCierre - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
  const hoyISO = fechaISO(new Date());

  let etiquetasHtml = "";
  for (let minuto = minutoApertura; minuto <= minutoCierre; minuto += 30) {
    const top = (minuto - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
    etiquetasHtml += `<div class="etiqueta-hora-grilla" style="top:${top}px;">${stringDesdeMinuto(minuto)}</div>`;
  }

  const turnosVisibles = medicoFiltroGrilla
    ? turnosCacheGrilla.filter(t => t.medicoNombre === medicoFiltroGrilla)
    : turnosCacheGrilla;

  const columnasHtml = dias.map((dia, indice) => {
    const fechaDiaISO = fechaISO(dia);
    // Solo entran al cálculo de carriles los turnos que efectivamente se pueden ubicar
    // en la grilla (con horarioInicio/horarioFin como texto) — mismo filtro que ya
    // aplicaba renderizarTarjetaTurnoGrilla antes, ahora hecho acá para poder calcular
    // los carriles sobre el conjunto correcto.
    const turnosDelDia = turnosVisibles.filter(t =>
      t.fecha === fechaDiaISO && typeof t.horarioInicio === "string" && typeof t.horarioFin === "string"
    );

    // Fase 4 (T9): indicador visual de bloqueos. Un bloqueo de UN sillón puntual entra
    // al MISMO cálculo de carriles que los turnos reales, como una tarjeta más — así
    // nunca se superpone visualmente con un turno de otro sillón a la misma hora,
    // mismo criterio que ya usa el motor puertas adentro (pseudoTurnosBloqueoEnFecha en
    // turnero-motor.js) para el cálculo de huecos. Un bloqueo de TODOS los sillones
    // (franja o día completo) no compite por carril: se resuelve aparte como una banda
    // de fondo (ver renderizarBandasBloqueoGrilla), porque no tiene sentido que le gane
    // el lugar a un turno real — decisión ya tomada con Elías: el bloqueo no le hace
    // nada a un turno ya otorgado, solo avisa.
    const bloqueosDelDia = bloqueosVigentesEnFechaGrilla(fechaDiaISO);
    const bloqueosSillonPuntual = bloqueosDelDia.filter(b => b.sillon != null);
    const pseudoTarjetasBloqueo = bloqueosSillonPuntual.map(b => ({
      id: `bloqueo-${b.id}`,
      horarioInicio: b.horaInicio || sede.horaApertura,
      horarioFin: b.horaFin || sede.horaCierre,
      esBloqueoVisual: true,
      bloqueoOriginal: b
    }));

    const itemsParaLanes = [...turnosDelDia, ...pseudoTarjetasBloqueo];
    const lanesDelDia = calcularLanesDiaGrilla(itemsParaLanes);

    const bandasHtml = renderizarBandasBloqueoGrilla(bloqueosDelDia, minutoApertura, minutoCierre);
    const tarjetasHtml = itemsParaLanes
      .map(item => item.esBloqueoVisual
        ? renderizarTarjetaBloqueoGrilla(item, minutoApertura, lanesDelDia.get(item.id))
        : renderizarTarjetaTurnoGrilla(item, minutoApertura, sede, lanesDelDia.get(item.id))
      )
      .join("");

    return `
      <div class="columna-dia-grilla">
        <div class="encabezado-dia-grilla ${fechaDiaISO === hoyISO ? "hoy" : ""}">
          ${DIAS_LABEL_GRILLA[DIAS_SEMANA_GRILLA[indice]]}
          <span class="fecha-dia-grilla">${String(dia.getDate()).padStart(2, "0")}/${String(dia.getMonth() + 1).padStart(2, "0")}</span>
        </div>
        <div class="pista-dia-grilla" data-fecha="${fechaDiaISO}" style="height:${alturaTotal}px;">
          ${bandasHtml}${tarjetasHtml || ""}
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("grilla-contenedor").innerHTML = `
    <div class="grilla-turnero">
      <div class="eje-horario-grilla" style="height:${alturaTotal}px;">${etiquetasHtml}</div>
      ${columnasHtml}
    </div>
  `;
}

function renderizarTarjetaTurnoGrilla(turno, minutoApertura, sede, laneInfo) {
  if (typeof turno.horarioInicio !== "string" || typeof turno.horarioFin !== "string") {
    // Turnos de T1/T2, sin estos campos todavía — no se pueden ubicar en la grilla.
    return "";
  }

  const inicio = minutoDesdeString(turno.horarioInicio);
  const fin = minutoDesdeString(turno.horarioFin);
  const top = (inicio - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
  const alto = Math.max((fin - inicio) * PIXELES_POR_MINUTO_GRILLA, 18);

  // Fase 3 (T6): si este turno comparte horario con otro(s) (sillones distintos), se
  // divide el ancho de la columna entre la cantidad de turnos simultáneos de su racimo,
  // para que ninguno tape al otro. Sin solapamiento, ocupa el ancho completo como antes.
  const { lane, totalLanes } = laneInfo || { lane: 0, totalLanes: 1 };
  const posicionHtml = totalLanes > 1
    ? `left:calc(4px + (100% - 8px) * ${lane} / ${totalLanes} + 1px);width:calc((100% - 8px) / ${totalLanes} - 2px);`
    : `left:4px;right:4px;`;

  const puedeArrastrar = puedeArrastrarTurnoGrilla(turno);

  // Feedback tras probar la Fase 3: con varios sillones coincidiendo en horario, la
  // tarjeta de antes (sillón+horario, paciente completo, médico, extras) no entraba.
  // Ahora la tarjeta muestra solo lo indispensable — sillón y apellido — y el resto
  // (nombre completo, médico, horario, ciclo/sesión, DNI, obra social, sobreturno) se ve
  // en un modal al clickear/tocar la tarjeta (abrirDetalleTurnoGrilla).
  const nombreMostrado = turno.paciente
    ? `${turno.paciente.nombre || ""} ${turno.paciente.apellido || ""}`.trim() || "Sin paciente"
    : "Sin paciente";
  const pacienteCompleto = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";

  const infoSillon = (sede.sillones || []).find(s => s.numero === turno.sillon);
  const esBackup = infoSillon && infoSillon.tipo === "backup";
  const textoSillon = turno.sillon != null ? `S${turno.sillon}` : "S?";

  const tituloPartes = [
    pacienteCompleto,
    turno.medicoNombre || "",
    `${turno.horarioInicio}–${turno.horarioFin}`,
    (turno.ciclo != null || turno.sesion != null) ? `Ciclo ${turno.ciclo ?? "-"} · Sesión ${turno.sesion ?? "-"}` : null,
    turno.paciente && turno.paciente.numeroDocumento ? `DNI ${turno.paciente.numeroDocumento}` : null,
    turno.paciente && turno.paciente.obraSocial ? turno.paciente.obraSocial : null
  ].filter(Boolean);
  const tituloCompleto = escaparHtmlGrilla(tituloPartes.join(" · "));

  // Toda tarjeta reacciona al clic/toque: si es arrastrable, el pointerdown decide solo
  // (toque simple sin mover = detalle, ver soltarArrastreGrilla); si no, un click directo
  // basta, porque nunca va a arrastrarse.
  const accionClic = puedeArrastrar
    ? `onpointerdown="iniciarArrastreGrilla(event, '${turno.id}')"`
    : `onclick="abrirDetalleTurnoGrilla('${turno.id}')"`;

  // Con 3 o más turnos superpuestos, cada carril queda muy angosto para texto
  // horizontal — el apellido pasa a escribirse en vertical (ver .vertical-grilla en
  // el CSS) para aprovechar el largo de la tarjeta en vez del ancho.
  const modoVertical = totalLanes >= 3;

  return `
    <div class="tarjeta-turno-grilla ${puedeArrastrar ? "arrastrable-grilla" : ""} ${modoVertical ? "vertical-grilla" : ""}"
      style="top:${top}px;height:${alto}px;${posicionHtml}" title="${tituloCompleto}"
      data-turno-id="${turno.id}" ${accionClic}>
      <span class="badge-sillon-grilla ${esBackup ? "backup" : ""}">${textoSillon}</span>
      <span class="apellido-turno-grilla">${escaparHtmlGrilla(nombreMostrado)}</span>
    </div>
  `;
}

// --- Fase 4 (T9): indicador visual de bloqueos ---
//
// bloqueosCacheGrilla ya está cargado (Fase 2, cargarBloqueosGrilla) y solo trae
// documentos con activo == true. bloqueoVigenteEnFecha() es la misma función de
// turnero-motor.js que ya usa el motor para descontar huecos — evita reimplementar acá
// el criterio de "puntual dentro de rango" / "recurrente salvo fechasExceptuadas".
function bloqueosVigentesEnFechaGrilla(fechaISO) {
  return (bloqueosCacheGrilla || []).filter(b =>
    b.sedeId === sedeSeleccionadaGrilla && bloqueoVigenteEnFecha(b, fechaISO)
  );
}

// Banda de fondo para un bloqueo de "todos los sillones" (franja o día completo) — no
// entra al cálculo de carriles, se dibuja ANTES que las tarjetas de turnos en el HTML
// (ver renderizarGrilla) para quedar detrás sin necesitar z-index.
function renderizarBandasBloqueoGrilla(bloqueosDelDia, minutoApertura, minutoCierre) {
  return bloqueosDelDia
    .filter(b => b.sillon == null)
    .map(bloqueo => {
      const inicio = bloqueo.horaInicio ? minutoDesdeString(bloqueo.horaInicio) : minutoApertura;
      const fin = bloqueo.horaFin ? minutoDesdeString(bloqueo.horaFin) : minutoCierre;
      const top = (inicio - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
      const alto = Math.max((fin - inicio) * PIXELES_POR_MINUTO_GRILLA, 18);

      return `
        <div class="banda-bloqueo-grilla" style="top:${top}px;height:${alto}px;"
          title="Bloqueado: ${escaparHtmlGrilla(bloqueo.motivo)}" onclick="abrirDetalleBloqueoGrilla('${bloqueo.id}')">
          <span class="etiqueta-banda-bloqueo-grilla">Bloqueado: ${escaparHtmlGrilla(bloqueo.motivo)}</span>
        </div>
      `;
    })
    .join("");
}

// Pseudo-tarjeta para un bloqueo de UN sillón puntual — comparte el sistema de carriles
// con renderizarTarjetaTurnoGrilla (mismo "item" con horarioInicio/horarioFin, ver el
// armado de pseudoTarjetasBloqueo en renderizarGrilla), por eso recibe laneInfo igual.
function renderizarTarjetaBloqueoGrilla(item, minutoApertura, laneInfo) {
  const bloqueo = item.bloqueoOriginal;
  const inicio = minutoDesdeString(item.horarioInicio);
  const fin = minutoDesdeString(item.horarioFin);
  const top = (inicio - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
  const alto = Math.max((fin - inicio) * PIXELES_POR_MINUTO_GRILLA, 18);

  const { lane, totalLanes } = laneInfo || { lane: 0, totalLanes: 1 };
  const posicionHtml = totalLanes > 1
    ? `left:calc(4px + (100% - 8px) * ${lane} / ${totalLanes} + 1px);width:calc((100% - 8px) / ${totalLanes} - 2px);`
    : `left:4px;right:4px;`;

  const tituloCompleto = escaparHtmlGrilla(`Sillón ${bloqueo.sillon} bloqueado · ${bloqueo.motivo}`);

  return `
    <div class="tarjeta-bloqueo-grilla" style="top:${top}px;height:${alto}px;${posicionHtml}"
      title="${tituloCompleto}" onclick="abrirDetalleBloqueoGrilla('${bloqueo.id}')">
      <span class="badge-bloqueo-grilla">S${bloqueo.sillon}</span>
      <span class="motivo-bloqueo-grilla">${escaparHtmlGrilla(bloqueo.motivo)}</span>
    </div>
  `;
}

// Detalle al hacer clic/toque — mismo patrón que abrirDetalleTurnoGrilla (más abajo),
// de solo lectura para los cuatro roles; administrador recibe además un enlace directo
// a la gestión completa.
function abrirDetalleBloqueoGrilla(bloqueoId) {
  const bloqueo = (bloqueosCacheGrilla || []).find(b => b.id === bloqueoId);
  if (!bloqueo) return;

  const cuando = bloqueo.tipo === "recurrente"
    ? `Todos los ${DIAS_LABEL_GRILLA[bloqueo.diaSemana] || bloqueo.diaSemana}`
    : (bloqueo.fechaInicio === bloqueo.fechaFin ? bloqueo.fechaInicio : `${bloqueo.fechaInicio} al ${bloqueo.fechaFin}`);

  const filas = [
    ["Sede", bloqueo.sedeNombre],
    ["Cuándo", cuando],
    ["Sillón", bloqueo.sillon == null ? "Todos" : `Sillón ${bloqueo.sillon}`],
    ["Franja", (bloqueo.horaInicio && bloqueo.horaFin) ? `${bloqueo.horaInicio} a ${bloqueo.horaFin}` : "Todo el horario"],
    ["Motivo", bloqueo.motivo],
    ["Creado por", (bloqueo.creadoPor && bloqueo.creadoPor.nombre) || "-"]
  ];

  const filasHtml = filas.map(([etiqueta, valor]) => `
    <div class="fila-detalle-turno-grilla">
      <span class="etiqueta-detalle-turno-grilla">${escaparHtmlGrilla(etiqueta)}</span>
      <span>${escaparHtmlGrilla(valor)}</span>
    </div>
  `).join("");

  const enlaceGestion = rolActualGrilla === "administrador"
    ? `<div style="margin-top:14px;"><a class="enlace-accion" href="bloqueos.html" target="_blank">Ir a gestión de bloqueos</a></div>`
    : "";

  document.getElementById("contenido-detalle-bloqueo-grilla").innerHTML = `
    <h2 style="margin-top:0;font-size:16px;">Bloqueado</h2>
    ${filasHtml}
    ${enlaceGestion}
  `;
  document.getElementById("overlay-detalle-bloqueo-grilla").style.display = "flex";
}

function cerrarDetalleBloqueoGrilla() {
  document.getElementById("overlay-detalle-bloqueo-grilla").style.display = "none";
}

function cerrarDetalleBloqueoGrillaSiFondo(evento) {
  if (evento.target.id === "overlay-detalle-bloqueo-grilla") cerrarDetalleBloqueoGrilla();
}

// --- Fase 3 (T6): arrastre de turnos ---
//
// Usa Pointer Events (no el drag-and-drop nativo de HTML5) para que funcione igual con
// mouse y con dedo en tablet/celular — el drag-and-drop nativo del navegador no anda
// bien en touch sin librerías extra.
//
// Flujo: pointerdown sobre una tarjeta arrastrable arranca el seguimiento, pero no hace
// nada visible todavía (evita que un simple toque dispare una búsqueda). Recién cuando
// el puntero se movió más de UMBRAL_ARRASTRE_PX_GRILLA se "arma" el arrastre de verdad:
// se llama a buscarHuecosSemanaEnSede() una sola vez (con el turno arrastrado ya
// excluido del cálculo), se atenúan los días sin ningún hueco válido para esa duración/
// médico, y aparece un indicador fantasma que sigue al puntero, en verde si la posición
// bajo el cursor (redondeada a 15 minutos) es un hueco válido, en rojo si no. Al soltar,
// si había un candidato válido, se actualiza el turno en Firestore.

const UMBRAL_ARRASTRE_PX_GRILLA = 6;

function mostrarMensajeAgenda(texto, tipo) {
  const el = document.getElementById("mensaje-agenda");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  clearTimeout(mostrarMensajeAgenda._temporizador);
  mostrarMensajeAgenda._temporizador = setTimeout(() => { el.style.display = "none"; }, 4000);
}

function iniciarArrastreGrilla(evento, turnoId) {
  if (arrastreActivoGrilla) return; // ya hay un arrastre en curso (no debería pasar, por las dudas)
  const turno = turnosCacheGrilla.find(t => t.id === turnoId);
  if (!turno) return;

  arrastreActivoGrilla = {
    turno,
    elementoTarjeta: evento.currentTarget,
    pointerId: evento.pointerId,
    xInicio: evento.clientX,
    yInicio: evento.clientY,
    enMovimiento: false, // true recién cuando se supera el umbral
    huecosSemana: null,
    elementoGhost: null,
    candidatoActual: null // { fechaISO, hueco } | null
  };

  evento.currentTarget.setPointerCapture(evento.pointerId);
  evento.currentTarget.addEventListener("pointermove", moverArrastreGrilla);
  evento.currentTarget.addEventListener("pointerup", soltarArrastreGrilla);
  evento.currentTarget.addEventListener("pointercancel", cancelarArrastreGrilla);
  // Red de seguridad: si la tarjeta se destruye en medio de un arrastre (por ejemplo,
  // el usuario cambia de semana o de sede mientras arrastra, y cargarYRenderizarGrilla()
  // reemplaza toda la grilla), el navegador libera la captura del puntero solo — hay que
  // limpiar el estado en ese momento, si no queda "colgado" un arrastre fantasma.
  evento.currentTarget.addEventListener("lostpointercapture", cancelarArrastreGrilla);
}

async function moverArrastreGrilla(evento) {
  if (!arrastreActivoGrilla) return;
  const estado = arrastreActivoGrilla;

  if (!estado.enMovimiento) {
    const dx = evento.clientX - estado.xInicio;
    const dy = evento.clientY - estado.yInicio;
    if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE_PX_GRILLA) return; // todavía no se movió lo suficiente
    estado.enMovimiento = true;
    await armarArrastreGrilla(estado);
    if (arrastreActivoGrilla !== estado) return; // se soltó/canceló mientras se armaba
  }

  actualizarCandidatoArrastreGrilla(estado, evento);
}

async function armarArrastreGrilla(estado) {
  const turno = estado.turno;
  const sede = sedesCacheGrilla.find(s => s.id === sedeSeleccionadaGrilla);
  const medicoDoc = medicosCacheGrilla.find(m => m.id === turno.medicoId);
  // Ronda "mejoras motor", Frente 3: el sillón backup ya no integra el pool automático
  // (decisión de T0 revertida explícitamente) — el arrastre usa búsqueda automática
  // (buscarHuecosSemanaEnSede), así que queda alineado con el mismo cambio ya aplicado
  // en turnero-motor.js para la carga normal. El backup sigue eligible a mano desde
  // "Modificar" (poblarSelectSillonModificar, más abajo), que no se tocó.
  const sillones = (sede.sillones || [])
    .filter(s => s.tipo === "regular")
    .map(s => s.numero);
  // Excluir el turno que se está moviendo del cálculo: si no, chocaría contra sí mismo
  // (conflicto de sillón falso) y su propio tiempo ya usado se contaría dos veces en
  // el cupo del médico ese día.
  const turnosSinElArrastrado = turnosCacheGrilla.filter(t => t.id !== turno.id);
  const diasVisibles = obtenerDiasVisiblesGrilla();

  // Regla nueva: un paciente no puede tener más de un turno el mismo día, en ninguna
  // sede. turnosCacheGrilla solo tiene la sede visible en pantalla — hace falta una
  // consulta aparte, acotada a este paciente, para ver también la otra sede.
  const diasBloqueadosPaciente = await calcularDiasBloqueadosPacienteGrilla(
    turno.paciente && turno.paciente.id, turno.id
  );

  estado.huecosSemana = await buscarHuecosSemanaEnSede(
    sede.id, sede.nombre, diasVisibles,
    turno.duracionTotalMinutos, sede.horaApertura, sede.horaCierre, sede.diasAtencion,
    turnosSinElArrastrado, sillones,
    turno.medicoId, medicoDoc, sede.usaAtaduraDia === true, sede.usaCuposPorcentaje === true,
    cuposCacheGrilla, diasBloqueadosPaciente, bloqueosCacheGrilla
  );

  document.querySelectorAll(".pista-dia-grilla").forEach(pista => {
    const resultadoDia = estado.huecosSemana[pista.dataset.fecha];
    const sinHuecos = !resultadoDia || !resultadoDia.atiende || resultadoDia.huecos.length === 0;
    pista.classList.toggle("dia-sin-huecos-grilla", sinHuecos);
  });

  estado.elementoTarjeta.classList.add("arrastrando-grilla");

  estado.elementoGhost = document.createElement("div");
  estado.elementoGhost.className = "indicador-drop-grilla invalido-grilla";
  estado.elementoGhost.style.height = `${Math.max(turno.duracionTotalMinutos * PIXELES_POR_MINUTO_GRILLA, 18)}px`;
  estado.elementoGhost.style.display = "none"; // hasta que el puntero esté sobre una pista
  document.body.appendChild(estado.elementoGhost);
}

// Consulta acotada (solo turnos activos de este paciente puntual) para poder aplicar la
// regla "un turno por día" de forma transversal a las dos sedes, sin tener que cargar
// todos los turnos de todas las sedes en el caché general de la grilla.
async function calcularDiasBloqueadosPacienteGrilla(pacienteId, turnoIdExcluir) {
  if (!pacienteId) return new Set();
  try {
    const snapshot = await db.collection("turnos")
      .where("paciente.id", "==", pacienteId)
      .where("estado", "==", "activo")
      .get();
    const turnosDelPaciente = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return diasBloqueadosPorPaciente(pacienteId, turnosDelPaciente, turnoIdExcluir);
  } catch (error) {
    console.error("Error al chequear otros turnos del paciente:", error);
    return new Set(); // ante la duda, no bloquear por un error de red — el motor igual
                       // sigue validando sillón/atadura/cupo con normalidad
  }
}

function actualizarCandidatoArrastreGrilla(estado, evento) {
  const elementoBajoPuntero = document.elementFromPoint(evento.clientX, evento.clientY);
  const pista = elementoBajoPuntero ? elementoBajoPuntero.closest(".pista-dia-grilla") : null;

  if (!pista) {
    estado.candidatoActual = null;
    estado.elementoGhost.style.display = "none";
    return;
  }

  const sede = sedesCacheGrilla.find(s => s.id === sedeSeleccionadaGrilla);
  const minutoApertura = minutoDesdeString(sede.horaApertura);
  const rect = pista.getBoundingClientRect();
  const offsetY = evento.clientY - rect.top;
  const minutoCrudo = minutoApertura + offsetY / PIXELES_POR_MINUTO_GRILLA;
  const minutoRedondeado = Math.round(minutoCrudo / 15) * 15; // redondeo a 15 minutos

  const fechaISOCandidata = pista.dataset.fecha;
  const resultadoDia = estado.huecosSemana[fechaISOCandidata];
  const hueco = resultadoDia && resultadoDia.atiende
    ? resultadoDia.huecos.find(h => h.minutoInicioBloqueNormalizado === minutoRedondeado)
    : null;

  estado.candidatoActual = hueco ? { fechaISO: fechaISOCandidata, hueco } : null;

  if (estado.elementoGhost.parentElement !== pista) {
    pista.appendChild(estado.elementoGhost);
  }
  estado.elementoGhost.style.top = `${(minutoRedondeado - minutoApertura) * PIXELES_POR_MINUTO_GRILLA}px`;
  estado.elementoGhost.style.display = "flex";
  estado.elementoGhost.classList.toggle("valido-grilla", !!hueco);
  estado.elementoGhost.classList.toggle("invalido-grilla", !hueco);
  estado.elementoGhost.textContent = hueco
    ? `${hueco.horaInicio}–${hueco.horaFin}`
    : `${stringDesdeMinuto(minutoRedondeado)}–${stringDesdeMinuto(minutoRedondeado + estado.turno.duracionTotalMinutos)}`;
}

async function soltarArrastreGrilla(evento) {
  if (!arrastreActivoGrilla) return;
  const estado = arrastreActivoGrilla;
  desengancharListenersArrastreGrilla(estado);

  const huboMovimientoReal = estado.enMovimiento;
  const candidato = estado.candidatoActual;
  const turnoId = estado.turno.id;

  limpiarVisualArrastreGrilla(estado);
  arrastreActivoGrilla = null;

  if (!huboMovimientoReal) {
    abrirDetalleTurnoGrilla(turnoId); // toque/clic simple, sin arrastre real: mostrar el detalle
    return;
  }
  if (!candidato) return; // soltó fuera de un hueco válido

  confirmarArrastreGrilla(estado.turno, candidato); // abre el modal de motivo (T7); el guardado real es async y queda en confirmarMotivoArrastreGrilla
}

function cancelarArrastreGrilla(evento) {
  if (!arrastreActivoGrilla) return;
  const estado = arrastreActivoGrilla;
  desengancharListenersArrastreGrilla(estado);
  limpiarVisualArrastreGrilla(estado);
  arrastreActivoGrilla = null;
}

function desengancharListenersArrastreGrilla(estado) {
  estado.elementoTarjeta.removeEventListener("pointermove", moverArrastreGrilla);
  estado.elementoTarjeta.removeEventListener("pointerup", soltarArrastreGrilla);
  estado.elementoTarjeta.removeEventListener("pointercancel", cancelarArrastreGrilla);
  estado.elementoTarjeta.removeEventListener("lostpointercapture", cancelarArrastreGrilla);
}

function limpiarVisualArrastreGrilla(estado) {
  if (estado.elementoGhost && estado.elementoGhost.parentElement) {
    estado.elementoGhost.parentElement.removeChild(estado.elementoGhost);
  }
  document.querySelectorAll(".pista-dia-grilla.dia-sin-huecos-grilla").forEach(pista => {
    pista.classList.remove("dia-sin-huecos-grilla");
  });
  if (estado.elementoTarjeta) estado.elementoTarjeta.classList.remove("arrastrando-grilla");
}

// Etapa T7: el arrastre deja de actualizar el turno en el lugar (rastro simple de T6
// Fase 3) y pasa a usar el mecanismo formal — motivo obligatorio, turno nuevo enlazado,
// turno viejo anulado sin borrarse (ver anularYCrearTurnoGrilla más abajo). Este primer
// paso solo abre el modal de motivo; el guardado real queda en confirmarMotivoArrastreGrilla.
function confirmarArrastreGrilla(turno, candidato) {
  const hueco = candidato.hueco;

  const sinCambioReal = turno.fecha === hueco.fecha &&
    turno.horarioInicio === hueco.horaInicio && turno.sillon === hueco.sillon;
  if (sinCambioReal) return; // soltó en el mismo lugar donde ya estaba

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "el paciente";
  abrirModalMotivoGrilla(turno, {
    fecha: hueco.fecha,
    horarioInicio: hueco.horaInicio,
    horarioFin: hueco.horaFin,
    horario: hueco.horaInicio, // compatibilidad con el comprobante, mismo criterio que al cargar
    sillon: hueco.sillon,
    // T7: la sede del hueco encontrado — en el arrastre siempre coincide con la sede ya
    // seleccionada en la grilla, pero en "Reasignar" con un médico de sede automática
    // (Occhipinti) el motor puede haber elegido la otra sede.
    sedeId: hueco.sedeId,
    sedeNombre: hueco.sedeNombre,
    tipoSobreturno: null // un hueco de la grilla semanal siempre es un sillón físico real
  }, "arrastre", `Vas a mover el turno de ${paciente} a ${hueco.fechaLegible || hueco.fecha}, ${hueco.horaInicio}hs.`, "Confirmar reasignación");
}

// Abre el modal de motivo compartido entre arrastre, "Reasignar", "Modificar" y
// "Eliminar" — misma pregunta, mismo guardado final (anularYCrearTurnoGrilla con el
// estado que corresponda). "camposNuevos" ya viene armado por quien llama — cada flujo
// sabe qué campos cambia y con qué valores (vacío en "Eliminar", no hay turno nuevo).
// "origen" decide qué hacer después de guardar/cancelar (ver cancelarMotivoArrastreGrilla
// y confirmarMotivoArrastreGrilla) y qué estado queda en el turno anulado.
// "textoBoton" solo cambia la etiqueta del botón de confirmar, nada más.
function abrirModalMotivoGrilla(turno, camposNuevos, origen, textoResumen, textoBoton) {
  arrastrePendienteGrilla = { turno, camposNuevos, origen };
  document.getElementById("texto-motivo-arrastre-grilla").textContent = textoResumen;
  document.getElementById("campo-motivo-arrastre-grilla").value = "";
  document.getElementById("error-motivo-arrastre-grilla").style.display = "none";
  document.getElementById("boton-confirmar-motivo-arrastre-grilla").textContent = textoBoton || "Confirmar";
  document.getElementById("overlay-motivo-arrastre-grilla").style.display = "flex";
}

function cancelarMotivoArrastreGrilla() {
  const pendiente = arrastrePendienteGrilla;
  arrastrePendienteGrilla = null;
  document.getElementById("overlay-motivo-arrastre-grilla").style.display = "none";

  if (pendiente && pendiente.origen === "reasignarFormulario") {
    // Volver a la búsqueda (sigue con la misma fecha cargada, por si solo quiere
    // reintentar) en vez de cerrar todo.
    document.getElementById("overlay-reasignar-grilla").style.display = "flex";
    return;
  }
  if (pendiente && pendiente.origen === "modificarFormulario") {
    document.getElementById("overlay-modificar-grilla").style.display = "flex";
    return;
  }
  // Arrastre y Eliminar: no hay un modal previo al que volver — durante el arrastre,
  // además, la tarjeta original queda oculta (visibility:hidden), así que hace falta
  // refrescar para que vuelva a aparecer en su lugar real.
  cargarYRenderizarGrilla();
}

async function confirmarMotivoArrastreGrilla() {
  const motivo = document.getElementById("campo-motivo-arrastre-grilla").value.trim();
  if (!motivo) {
    document.getElementById("error-motivo-arrastre-grilla").style.display = "block";
    return;
  }
  if (!arrastrePendienteGrilla) return; // por las dudas, no debería poder pasar

  const { turno, camposNuevos, origen } = arrastrePendienteGrilla;
  const tipoAccion = origen === "modificarFormulario" ? "modificado"
    : origen === "eliminarFormulario" ? "cancelado"
    : "reasignado";
  const botonConfirmar = document.getElementById("boton-confirmar-motivo-arrastre-grilla");
  botonConfirmar.disabled = true;

  try {
    const nuevoTurnoId = await anularYCrearTurnoGrilla(turno, camposNuevos, motivo, tipoAccion);

    arrastrePendienteGrilla = null;
    document.getElementById("overlay-motivo-arrastre-grilla").style.display = "none";
    if (origen === "reasignarFormulario") {
      document.getElementById("overlay-reasignar-grilla").style.display = "none";
      turnoIdReasignarActual = null;
    }
    if (origen === "modificarFormulario") {
      document.getElementById("overlay-modificar-grilla").style.display = "none";
      turnoIdModificarActual = null;
    }
    const mensajeExito = tipoAccion === "modificado" ? "Turno modificado correctamente. Abriendo comprobante…"
      : tipoAccion === "cancelado" ? "Turno eliminado correctamente."
      : "Turno reasignado correctamente. Abriendo comprobante…";
    mostrarMensajeAgenda(mensajeExito, "exito");
    // Etapa T8: nuevoTurnoId es null en "cancelado" (no hay turno de reemplazo al que
    // emitirle comprobante) — abrirComprobanteTurno() está definida en turnero-carga.js,
    // que se carga antes que este archivo en agenda.html.
    if (nuevoTurnoId) abrirComprobanteTurno(nuevoTurnoId);
    await cargarYRenderizarGrilla();
  } catch (error) {
    console.error("Error al guardar el cambio del turno:", error);
    mostrarMensajeAgenda("No se pudo guardar el cambio. Reintentá en unos segundos.", "error");
    await cargarYRenderizarGrilla();
  } finally {
    botonConfirmar.disabled = false;
  }
}

// --- Reasignar por formulario (Etapa T7, Fase 1) ---
// A diferencia del arrastre (que ya sabe a qué hueco fue soltado), acá hace falta
// buscar la disponibilidad primero. Reutiliza el mismo motor y la misma orquestación de
// turnero-carga.js que usa "+ nuevo turno" (buscarYMostrarHuecos, con los tres caminos
// de reserva de siempre: sobreturno físico, cupo excedido, atadura bloqueada) — la única
// diferencia es que acá el paciente/médico/protocolo ya están fijos (son los del turno
// que se reasigna, no se cargan de un formulario), y el guardado final no es un alta
// nueva sino anularYCrearTurnoGrilla con motivo obligatorio (ver guardarTurnoConHueco en
// turnero-carga.js, rama "modoReasignar").


async function abrirReasignarGrilla(turnoId) {
  const turno = turnosCacheGrilla.find(t => t.id === turnoId);
  if (!turno || !puedeArrastrarTurnoGrilla(turno)) return; // resguardo — el botón que llama a esto ya está gateado igual

  cerrarDetalleTurnoGrilla();

  // T7: turnero-carga.js (buscarYMostrarHuecos, mostrarBloqueoCupo/Atadura) decide qué
  // mostrarle a cada rol según rolActualCarga — normalmente lo fija iniciarCargaTurno()
  // al abrir "+ nuevo turno" por primera vez. Si "Reasignar" se usa sin haber abierto
  // nunca ese modal en esta sesión, rolActualCarga sigue en null y un médico vería por
  // error la variante de enfermería/administrador. Se fija acá también, sin duplicar el
  // resto de iniciarCargaTurno (que además engancha listeners del formulario de carga).
  usuarioActualCarga = usuarioActualGrilla;
  datosUsuarioActualCarga = datosUsuarioActualGrilla;
  rolActualCarga = datosUsuarioActualGrilla.rol;

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";
  const protocolosTexto = (turno.protocolos || []).map(p => p.nombre || p).join(", ") || "-";
  document.getElementById("resumen-reasignar-grilla").innerHTML = [
    ["Paciente", paciente],
    ["Médico", turno.medicoNombre || "-"],
    ["Protocolo(s)", protocolosTexto],
    ["Turno actual", `${turno.fecha || "-"}, ${turno.horarioInicio || "-"}hs`]
  ].map(([etiqueta, valor]) => `
    <div class="fila-detalle-turno-grilla">
      <span class="etiqueta-detalle-turno-grilla">${escaparHtmlGrilla(etiqueta)}</span>
      <span>${escaparHtmlGrilla(valor)}</span>
    </div>
  `).join("");

  document.getElementById("campo-fecha-reasignar-grilla").value = turno.fecha || "";
  document.getElementById("campo-fecha-reasignar-grilla").min = fechaLocalHoy();
  document.getElementById("campo-fecha-reasignar-grilla").max = fechaMaximaAnticipacionISO();
  document.getElementById("mensaje-reasignar-grilla").style.display = "none";
  turnoIdReasignarActual = turnoId;
  document.getElementById("overlay-reasignar-grilla").style.display = "flex";

  // Refrescar los catálogos que el motor necesita — puede que en esta sesión nunca se
  // haya abierto "+ nuevo turno" y estos cachés (de turnero-carga.js) arranquen vacíos.
  await Promise.all([
    cargarMedicosCarga(), cargarSedesCarga(), cargarTurnosExistentes(), cargarCuposCarga(), cargarBloqueosCarga()
  ]);
}

function cerrarReasignarGrilla() {
  document.getElementById("overlay-reasignar-grilla").style.display = "none";
  turnoIdReasignarActual = null;
}

function mostrarMensajeReasignarGrilla(texto, tipo) {
  const el = document.getElementById("mensaje-reasignar-grilla");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
}

async function buscarReasignarGrilla() {
  const turno = turnosCacheGrilla.find(t => t.id === turnoIdReasignarActual);
  if (!turno) {
    mostrarMensajeReasignarGrilla("El turno ya no está disponible. Cerrá esta ventana y volvé a intentar.", "error");
    return;
  }
  const fechaReferencia = document.getElementById("campo-fecha-reasignar-grilla").value;
  if (!fechaReferencia) {
    mostrarMensajeReasignarGrilla("Elegí una fecha de referencia.", "error");
    return;
  }
  if (fechaReferencia > fechaMaximaAnticipacionISO()) {
    mostrarMensajeReasignarGrilla(`No se puede buscar disponibilidad con más de ${TOPE_DIAS_ANTICIPACION} días de anticipación.`, "error");
    return;
  }

  const datosBasicos = {
    esMedicoOtro: turno.esMedicoOtro,
    medicoId: turno.medicoId,
    medicoNombre: turno.medicoNombre,
    sedeId: turno.sedeId,
    sedeNombre: turno.sedeNombre,
    sedeAutomatica: turno.sedeAutomatica,
    protocolos: turno.protocolos,
    premedicacion: turno.premedicacion,
    duracionTotalMinutos: turno.duracionTotalMinutos,
    ciclo: turno.ciclo,
    sesion: turno.sesion,
    fecha: fechaReferencia,
    diasSolicitados: null,
    fechaCalculadaDesdeDias: false,
    pacienteObraSocial: turno.paciente ? (turno.paciente.obraSocial || "") : "", // T7: ver guardarComoSobreturnoFisico (caso Occhipinti)
    // T7: le indica a buscarYMostrarHuecos/guardarTurnoConHueco (turnero-carga.js) que
    // esto no es un alta nueva — hay que pedir motivo y anular+crear en vez de agregar.
    modoReasignar: true,
    turnoIdParaReasignar: turno.id
  };

  const boton = document.getElementById("boton-buscar-reasignar-grilla");
  boton.disabled = true;
  mostrarMensajeReasignarGrilla("Buscando disponibilidad…", "info");
  try {
    await buscarYMostrarHuecos(datosBasicos, {
      id: turno.paciente ? turno.paciente.id : null,
      obraSocial: turno.paciente ? turno.paciente.obraSocial : ""
    });
  } finally {
    boton.disabled = false;
  }
}

// Retoma turnero-carga.js → guardarTurnoConHueco cuando modoReasignar está activo: en
// vez de guardar directo, pide el motivo obligatorio (mismo modal que el arrastre).
function abrirMotivoReasignarGrilla(datosBasicos, hueco, tipoSobreturno) {
  const turno = turnosCacheGrilla.find(t => t.id === datosBasicos.turnoIdParaReasignar);
  if (!turno) {
    mostrarMensajeReasignarGrilla("El turno original ya no está disponible. Cerrá esta ventana y volvé a intentar.", "error");
    return;
  }
  document.getElementById("overlay-reasignar-grilla").style.display = "none";

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "el paciente";
  abrirModalMotivoGrilla(turno, {
    fecha: hueco.fecha,
    horarioInicio: hueco.horaInicio,
    horarioFin: hueco.horaFin,
    horario: hueco.horaInicio, // compatibilidad con el comprobante, mismo criterio que al cargar
    sillon: hueco.sillon,
    sedeId: hueco.sedeId,
    sedeNombre: hueco.sedeNombre,
    // Un hueco encontrado por el motor siempre es un sillón físico real, o (si viene de
    // un sobreturno confirmado) explícito como tal — nunca hereda un tipoSobreturno
    // viejo que ya no corresponde.
    tipoSobreturno: tipoSobreturno || null
  }, "reasignarFormulario", `Vas a reasignar el turno de ${paciente} a ${hueco.fechaLegible || hueco.fecha}, ${hueco.horaInicio}hs.`, "Confirmar reasignación");
}

// --- Modificar por formulario (Etapa T7, Fase 1) ---
// A diferencia de Reasignar, acá la fecha y la hora de inicio NUNCA cambian — solo
// sillón, médico, protocolo(s)/premedicación/duración, ciclo/sesión u obra social
// (dato guardado en el turno, no la ficha del paciente). Interfaz propia, no comparte
// campos con "+ nuevo turno" (decisión con Elías: la selección de protocolos de ese
// formulario es una sola instancia con ids/variables globales fijos — reusarla ahí
// significaba tocar ese formulario o duplicar la lógica; se eligió duplicar, así no se
// arriesga nada de lo que ya funciona en "+ nuevo turno"). Si la nueva duración no entra
// en el sillón elegido a esa hora, o el cambio de médico no pasa atadura/cupo, se avisa
// y no se guarda nada — no ofrece buscar otro horario, para eso ya está "Reasignar"
// (confirmado con Elías).

let protocolosSeleccionadosModificar = {};
let contadorFilasProtocoloModificar = 0;

async function abrirModificarGrilla(turnoId) {
  const turno = turnosCacheGrilla.find(t => t.id === turnoId);
  if (!turno || !puedeArrastrarTurnoGrilla(turno)) return; // resguardo — el botón que llama a esto ya está gateado igual

  cerrarDetalleTurnoGrilla();

  // Mismo motivo que en abrirReasignarGrilla: turnero-carga.js decide qué mostrarle a
  // cada rol según rolActualCarga, que normalmente fija iniciarCargaTurno() al abrir
  // "+ nuevo turno" por primera vez.
  usuarioActualCarga = usuarioActualGrilla;
  datosUsuarioActualCarga = datosUsuarioActualGrilla;
  rolActualCarga = datosUsuarioActualGrilla.rol;

  turnoIdModificarActual = turno.id;

  await Promise.all([
    cargarMedicosCarga(), cargarSedesCarga(), cargarProtocolosCarga(),
    cargarTurnosExistentes(), cargarCuposCarga(), cargarBloqueosCarga()
  ]);

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";
  document.getElementById("resumen-modificar-grilla").innerHTML = [
    ["Paciente", paciente],
    ["Turno (fijo acá)", `${turno.fecha || "-"}, ${turno.horarioInicio || "-"}hs — para cambiar día u horario, usá Reasignar`]
  ].map(([etiqueta, valor]) => `
    <div class="fila-detalle-turno-grilla">
      <span class="etiqueta-detalle-turno-grilla">${escaparHtmlGrilla(etiqueta)}</span>
      <span>${escaparHtmlGrilla(valor)}</span>
    </div>
  `).join("");

  poblarSelectMedicoModificar(turno);
  poblarSelectSillonModificar(turno);

  document.getElementById("lista-protocolos-modificar").innerHTML = "";
  protocolosSeleccionadosModificar = {};
  contadorFilasProtocoloModificar = 0;
  const protocolosDelTurno = (turno.protocolos && turno.protocolos.length > 0) ? turno.protocolos : [null];
  protocolosDelTurno.forEach(p => agregarFilaProtocoloModificar(p));

  document.getElementById("campo-premedicacion-modificar").checked = turno.premedicacion === true;
  document.getElementById("campo-ciclo-modificar").value = turno.ciclo ?? "";
  document.getElementById("campo-sesion-modificar").value = turno.sesion ?? "";
  document.getElementById("campo-obra-social-modificar").value = (turno.paciente && turno.paciente.obraSocial) || "";
  actualizarResumenDuracionModificar();

  document.getElementById("mensaje-modificar-grilla").style.display = "none";
  document.getElementById("overlay-modificar-grilla").style.display = "flex";
}

function cerrarModificarGrilla() {
  document.getElementById("overlay-modificar-grilla").style.display = "none";
  turnoIdModificarActual = null;
}

function mostrarMensajeModificarGrilla(texto, tipo) {
  const el = document.getElementById("mensaje-modificar-grilla");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
}

// El médico no puede reasignarse ni modificarse a otro médico distinto por acá — mismo
// criterio que "+ nuevo turno" (poblarSelectMedico): un médico solo puede tocar sus
// propios turnos, nunca dárselos a otro médico.
function poblarSelectMedicoModificar(turno) {
  const select = document.getElementById("campo-medico-modificar");
  select.innerHTML = "";

  if (rolActualGrilla === "medico") {
    const medicoPropio = medicosCacheCarga.find(m => m.id === datosUsuarioActualGrilla.medicoId);
    const option = document.createElement("option");
    option.value = medicoPropio ? medicoPropio.id : (turno.medicoId || "");
    option.textContent = medicoPropio ? medicoPropio.nombre : turno.medicoNombre;
    select.appendChild(option);
    select.value = option.value;
    select.disabled = true;
    document.getElementById("bloque-medico-otro-modificar").style.display = "none";
    return;
  }

  medicosCacheCarga.forEach(m => {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = m.nombre;
    select.appendChild(option);
  });
  const optionOtro = document.createElement("option");
  optionOtro.value = "otro";
  optionOtro.textContent = "Otro";
  select.appendChild(optionOtro);

  select.disabled = false;
  select.value = turno.esMedicoOtro ? "otro" : (turno.medicoId || "");
  document.getElementById("campo-medico-otro-nombre-modificar").value = turno.esMedicoOtro ? (turno.medicoNombre || "") : "";
  actualizarBloqueMedicoOtroModificar();
}

function actualizarBloqueMedicoOtroModificar() {
  const esOtro = document.getElementById("campo-medico-modificar").value === "otro";
  document.getElementById("bloque-medico-otro-modificar").style.display = esOtro ? "block" : "none";
}

// A diferencia de "+ nuevo turno" (que asigna el sillón automáticamente y nunca deja
// elegirlo a mano), acá SÍ se elige a mano — es una corrección puntual de un dato ya
// cargado, no una búsqueda de disponibilidad.
function poblarSelectSillonModificar(turno) {
  const select = document.getElementById("campo-sillon-modificar");
  select.innerHTML = '<option value="">Sin asignar (sobreturno)</option>';
  const sedeDoc = sedesCacheCarga.find(s => s.id === turno.sedeId);
  const sillones = sedeDoc
    ? (sedeDoc.sillones || []).filter(s => s.tipo === "regular" || s.tipo === "backup")
    : [];
  sillones.forEach(s => {
    const option = document.createElement("option");
    option.value = String(s.numero);
    option.textContent = `Sillón ${s.numero}${s.tipo === "backup" ? " (backup)" : ""}`;
    select.appendChild(option);
  });
  select.value = turno.sillon != null ? String(turno.sillon) : "";
}

// --- Selección de protocolos — copia deliberada de agregarFilaProtocolo/
// actualizarBuscadorProtocolo/quitarFilaProtocolo/actualizarResumenDuracion
// (turnero-carga.js), con contenedor y variables propias, para no tocar el formulario
// de "+ nuevo turno" (ver nota de diseño arriba). protocoloExistente es opcional —
// permite precargar una fila con un protocolo ya elegido (usado al abrir el modal).
function agregarFilaProtocoloModificar(protocoloExistente) {
  const id = `fila-protocolo-modificar-${contadorFilasProtocoloModificar++}`;
  const lista = document.getElementById("lista-protocolos-modificar");

  const fila = document.createElement("div");
  fila.id = id;
  fila.className = "fila-medicamento";

  fila.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>protocolo ${contadorFilasProtocoloModificar}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="campo" style="margin-bottom:0;">
      <label>Nombre del protocolo</label>
      <input type="text" class="inp-buscar-protocolo" value="${protocoloExistente ? escaparHtmlGrilla(protocoloExistente.nombre) : ""}" placeholder="Escribí el nombre o parte del nombre" />
      <div class="resultados-protocolo"></div>
    </div>
  `;

  fila.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaProtocoloModificar(id));
  fila.querySelector(".inp-buscar-protocolo").addEventListener("input", (e) => actualizarBuscadorProtocoloModificar(id, e.target.value));

  lista.appendChild(fila);

  protocolosSeleccionadosModificar[id] = protocoloExistente
    ? {
        protocoloId: protocoloExistente.protocoloId || null,
        nombre: protocoloExistente.nombre,
        duracionMinutos: protocoloExistente.duracionMinutos
      }
    : null;
}

function actualizarBuscadorProtocoloModificar(filaId, texto) {
  const resultados = document.querySelector(`#${filaId} .resultados-protocolo`);
  resultados.innerHTML = "";

  if (!texto.trim()) {
    protocolosSeleccionadosModificar[filaId] = null;
    actualizarResumenDuracionModificar();
    return;
  }

  const norm = normalizarTexto(texto);
  const encontrados = protocolosCacheCarga.filter(p => normalizarTexto(p.nombre).includes(norm));

  encontrados.slice(0, 5).forEach(p => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtmlGrilla(p.nombre)} (${p.duracionMinutos} min)</span>
      <button type="button" class="enlace-accion">usar</button>`;
    div.querySelector("button").addEventListener("click", () => {
      protocolosSeleccionadosModificar[filaId] = { protocoloId: p.id, nombre: p.nombre, duracionMinutos: p.duracionMinutos };
      document.querySelector(`#${filaId} input`).value = p.nombre;
      resultados.innerHTML = "";
      actualizarResumenDuracionModificar();
    });
    resultados.appendChild(div);
  });
}

function quitarFilaProtocoloModificar(filaId) {
  const filas = document.querySelectorAll("#lista-protocolos-modificar .fila-medicamento");
  if (filas.length <= 1) {
    alert("Tiene que quedar al menos un protocolo cargado.");
    return;
  }
  delete protocolosSeleccionadosModificar[filaId];
  document.getElementById(filaId).remove();
  actualizarResumenDuracionModificar();
}

function actualizarResumenDuracionModificar() {
  const sumaProtocolos = Object.values(protocolosSeleccionadosModificar)
    .filter(p => p !== null)
    .reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0);
  const premedicacion = document.getElementById("campo-premedicacion-modificar").checked;
  const total = sumaProtocolos + (premedicacion ? PREMEDICACION_MINUTOS : 0);
  const detalle = premedicacion
    ? `${sumaProtocolos} min de protocolo(s) + ${PREMEDICACION_MINUTOS} min de premedicación`
    : `${sumaProtocolos} min de protocolo(s)`;
  document.getElementById("resumen-duracion-modificar").textContent = `Duración total: ${total} min (${detalle}).`;
}

// Traduce el resultado de validarModificacionTurno (turnero-motor.js) a un mensaje para
// mostrar en el modal — sin ofrecer ninguna excepción/override, a diferencia de los
// carteles de cupo/atadura de "+ nuevo turno"/Reasignar (decisión con Elías: si no
// entra, avisa y no guarda).
function mensajeValidacionModificarGrilla(validacion, medicoNombre) {
  switch (validacion.motivo) {
    case "sillonOcupado":
      return "Ese sillón ya está ocupado a esa hora. Elegí otro.";
    case "bloqueado":
      return `Ese sillón está bloqueado a esa hora (motivo: ${validacion.motivoBloqueo || "sin especificar"}). Elegí otro sillón u horario.`;
    case "horario":
      return "El horario resultante, con la nueva duración, queda fuera del horario de atención de la sede.";
    case "atadura": {
      const dias = formatearListaDiasLegibles(validacion.diasAtencionMedico);
      return dias
        ? `${medicoNombre} no atiende los ${diaLegible(validacion.nombreDiaSolicitado)} en esta sede. Atiende los ${dias}.`
        : `${medicoNombre} no tiene días configurados en esta sede.`;
    }
    case "cupo": {
      const restantes = Math.max(0, Math.round(validacion.techoMinutos - validacion.minutosUsados));
      return `${medicoNombre} ya usó el tiempo que tiene asignado ese día en esta sede (le quedan ${restantes} minutos disponibles y este cambio necesita más).`;
    }
    case "franja":
      // Ronda "mejoras motor", Frente 1: Modificar no busca otro horario (para eso está
      // Reasignar) — solo informa el rango permitido y corta ahí, mismo criterio que
      // atadura/cupo en este mismo modal.
      return `${medicoNombre} solo atiende de ${validacion.franjaHorario.horaInicio} a ${validacion.franjaHorario.horaFin}. Elegí un horario dentro de ese rango, o usá Reasignar para buscar otro día/hora.`;
    case "sedeNoEncontrada":
      return "No se encontró la sede de este turno en el catálogo. Refrescá la página e intentá de nuevo.";
    default:
      return "No se pudo validar el cambio.";
  }
}

async function guardarModificacionGrilla() {
  const turno = turnosCacheGrilla.find(t => t.id === turnoIdModificarActual);
  if (!turno) {
    mostrarMensajeModificarGrilla("El turno ya no está disponible. Cerrá esta ventana y volvé a intentar.", "error");
    return;
  }

  const medicoValor = document.getElementById("campo-medico-modificar").value;
  const esMedicoOtro = medicoValor === "otro";
  let medicoId = null;
  let medicoNombre = "";
  if (esMedicoOtro) {
    medicoNombre = document.getElementById("campo-medico-otro-nombre-modificar").value.trim();
    if (!medicoNombre) {
      mostrarMensajeModificarGrilla("Cargá el nombre del profesional.", "error");
      return;
    }
  } else {
    if (!medicoValor) {
      mostrarMensajeModificarGrilla("Elegí un médico.", "error");
      return;
    }
    const medicoDoc = medicosCacheCarga.find(m => m.id === medicoValor);
    if (!medicoDoc) {
      mostrarMensajeModificarGrilla("El médico elegido ya no está disponible. Volvé a elegirlo.", "error");
      return;
    }
    medicoId = medicoDoc.id;
    medicoNombre = medicoDoc.nombre;
  }

  const sillonValor = document.getElementById("campo-sillon-modificar").value;
  const sillon = sillonValor === "" ? null : Number(sillonValor);

  const protocolos = Object.values(protocolosSeleccionadosModificar).filter(p => p !== null);
  if (protocolos.length === 0) {
    mostrarMensajeModificarGrilla("Cargá al menos un protocolo válido.", "error");
    return;
  }
  const premedicacion = document.getElementById("campo-premedicacion-modificar").checked;
  const duracionTotalMinutos = protocolos.reduce((acc, p) => acc + (Number(p.duracionMinutos) || 0), 0) +
    (premedicacion ? PREMEDICACION_MINUTOS : 0);

  const ciclo = parseInt(document.getElementById("campo-ciclo-modificar").value, 10);
  const sesion = parseInt(document.getElementById("campo-sesion-modificar").value, 10);
  if (!Number.isInteger(ciclo) || ciclo < 1 || !Number.isInteger(sesion) || sesion < 1) {
    mostrarMensajeModificarGrilla("Cargá ciclo y sesión (números enteros de 1 en adelante).", "error");
    return;
  }

  const obraSocial = document.getElementById("campo-obra-social-modificar").value.trim();

  // La fecha y la hora de inicio no cambian acá (eso es "Reasignar"). Si la duración
  // cambió, la hora de fin sí se recalcula a partir de la misma hora de inicio.
  const horarioInicio = turno.horarioInicio;
  const horarioFin = stringDesdeMinuto(minutoDesdeString(horarioInicio) + duracionTotalMinutos);

  const boton = document.getElementById("boton-guardar-modificar-grilla");
  boton.disabled = true;
  mostrarMensajeModificarGrilla("Validando…", "info");

  try {
    const validacion = validarModificacionTurno(
      esMedicoOtro ? null : medicoId,
      turno.sedeId,
      turno.fecha,
      horarioInicio,
      horarioFin,
      sillon,
      medicosCacheCarga,
      sedesCacheCarga,
      turnosExistentes,
      cuposCacheCarga,
      turno.id,
      bloqueosCacheCarga
    );

    if (!validacion.valido) {
      mostrarMensajeModificarGrilla(mensajeValidacionModificarGrilla(validacion, medicoNombre), "error");
      return;
    }

    const paciente = turno.paciente
      ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
      : "el paciente";

    abrirModalMotivoGrilla(turno, {
      medicoId: esMedicoOtro ? null : medicoId,
      medicoNombre,
      esMedicoOtro,
      sillon,
      // Si ahora tiene un sillón físico real, cualquier marca de sobreturno vieja ya no
      // corresponde. Si sigue sin sillón, se mantiene la que tenía.
      tipoSobreturno: sillon != null ? null : turno.tipoSobreturno,
      protocolos,
      premedicacion,
      duracionTotalMinutos,
      ciclo,
      sesion,
      horarioFin,
      paciente: turno.paciente ? { ...turno.paciente, obraSocial: obraSocial || "" } : turno.paciente
    }, "modificarFormulario", `Vas a modificar el turno de ${paciente}.`, "Confirmar modificación");

    document.getElementById("overlay-modificar-grilla").style.display = "none";
    mostrarMensajeModificarGrilla("", "info");
    document.getElementById("mensaje-modificar-grilla").style.display = "none";
  } finally {
    boton.disabled = false;
  }
}

// --- Consulta de disponibilidad sin cargar (Etapa T10) ---
//
// Simulador de solo lectura: llama directo a buscarHuecosEnSede() (turnero-motor.js,
// sin cambios, sin wrapper propio — decisión con Elías) con sede siempre manual (nunca
// hay paciente acá para resolver "sede automática por obra social"), médico opcional
// (salvo rol médico, fijo en sí mismo igual que "+ nuevo turno" — decisión con Elías) y
// protocolo(s) del catálogo real. No pide paciente ni guarda nada en Firestore.
//
// Reutiliza los cachés y los "cargarXxxCarga()" de turnero-carga.js (medicosCacheCarga,
// sedesCacheCarga, protocolosCacheCarga, cuposCacheCarga, bloqueosCacheCarga,
// turnosExistentes), refrescándolos al abrir — mismo criterio que ya usan Reasignar y
// Modificar por formulario más arriba, para no depender de que "+ nuevo turno" se haya
// abierto antes en la sesión. turnosExistentes viene de TODAS las sedes: se filtra acá
// por la sede elegida, igual que hace buscarHuecos() (la función de más alto nivel que
// esta pantalla no usa, justamente porque esa resuelve sede automática y esta no).
//
// La selección de protocolos es una copia deliberada del mismo patrón que ya usa
// Modificar (agregarFilaProtocoloModificar/actualizarBuscadorProtocoloModificar): un
// buscador de texto con resultados, no las filas de "+ nuevo turno" (mismo motivo ya
// documentado ahí: esas filas usan ids/variables globales fijos de ese formulario).

let modalConsultaDisponibilidadInicializadoGrilla = false;
let protocolosSeleccionadosConsultaGrilla = {};
let contadorFilasProtocoloConsultaGrilla = 0;
// Guarda lo necesario para "Cargar este turno" después de una búsqueda exitosa — se
// arma de nuevo en cada buscarDisponibilidadGrilla(), null hasta la primera búsqueda o
// si la búsqueda no encontró nada.
let ultimoResultadoConsultaDisponibilidadGrilla = null;

async function abrirConsultaDisponibilidadGrilla() {
  document.getElementById("overlay-consulta-disponibilidad-grilla").style.display = "flex";

  // Mismo motivo que en Reasignar/Modificar: turnero-carga.js decide qué mostrarle a
  // cada rol según rolActualCarga, que normalmente fija iniciarCargaTurno().
  usuarioActualCarga = usuarioActualGrilla;
  datosUsuarioActualCarga = datosUsuarioActualGrilla;
  rolActualCarga = datosUsuarioActualGrilla.rol;

  await Promise.all([
    cargarMedicosCarga(), cargarSedesCarga(), cargarProtocolosCarga(),
    cargarTurnosExistentes(), cargarCuposCarga(), cargarBloqueosCarga()
  ]);

  poblarSelectSedeConsultaGrilla();
  poblarSelectMedicoConsultaGrilla();

  document.getElementById("lista-protocolos-consulta-grilla").innerHTML = "";
  protocolosSeleccionadosConsultaGrilla = {};
  agregarFilaProtocoloConsultaGrilla();

  document.getElementById("campo-premedicacion-consulta-grilla").checked = false;
  document.getElementById("campo-fecha-consulta-grilla").value = "";
  document.getElementById("campo-fecha-consulta-grilla").min = fechaLocalHoy();
  document.getElementById("campo-fecha-consulta-grilla").max = fechaMaximaAnticipacionISO();
  document.getElementById("resultado-disponibilidad-grilla").innerHTML = "";
  document.getElementById("mensaje-consulta-disponibilidad-grilla").style.display = "none";
  ultimoResultadoConsultaDisponibilidadGrilla = null;
  actualizarResumenDuracionConsultaGrilla();

  modalConsultaDisponibilidadInicializadoGrilla = true;
}

function cerrarConsultaDisponibilidadGrilla() {
  document.getElementById("overlay-consulta-disponibilidad-grilla").style.display = "none";
}

function mostrarMensajeConsultaDisponibilidadGrilla(texto, tipo) {
  const el = document.getElementById("mensaje-consulta-disponibilidad-grilla");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
}

function poblarSelectSedeConsultaGrilla() {
  const select = document.getElementById("select-sede-consulta-grilla");
  select.innerHTML = '<option value="">Elegir sede</option>';
  sedesCacheCarga.forEach((s) => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.nombre;
    select.appendChild(option);
  });
}

// A diferencia de "+ nuevo turno", acá el médico es opcional para administrador y
// enfermería (opción en blanco = sin médico específico). Para rol médico, queda fijo
// en sí mismo — decisión explícita con Elías, mismo criterio que "+ nuevo turno".
function poblarSelectMedicoConsultaGrilla() {
  const select = document.getElementById("select-medico-consulta-grilla");
  select.innerHTML = "";

  if (rolActualGrilla === "medico") {
    const medicoPropio = medicosCacheCarga.find((m) => m.id === datosUsuarioActualGrilla.medicoId);
    const option = document.createElement("option");
    option.value = medicoPropio ? medicoPropio.id : "";
    option.textContent = medicoPropio ? medicoPropio.nombre : "Sin médico asociado";
    select.appendChild(option);
    select.value = option.value;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  const optionNinguno = document.createElement("option");
  optionNinguno.value = "";
  optionNinguno.textContent = "Sin médico específico";
  select.appendChild(optionNinguno);

  medicosCacheCarga.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = m.nombre;
    select.appendChild(option);
  });
}

// --- Selección de protocolos de la consulta — misma copia deliberada que Modificar ---

function agregarFilaProtocoloConsultaGrilla() {
  const id = `fila-protocolo-consulta-grilla-${contadorFilasProtocoloConsultaGrilla++}`;
  const lista = document.getElementById("lista-protocolos-consulta-grilla");

  const fila = document.createElement("div");
  fila.id = id;
  fila.className = "fila-medicamento";

  fila.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>protocolo</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="campo" style="margin-bottom:0;">
      <label>Nombre del protocolo</label>
      <input type="text" class="inp-buscar-protocolo" placeholder="Escribí el nombre o parte del nombre" />
      <div class="resultados-protocolo"></div>
    </div>
  `;

  fila.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaProtocoloConsultaGrilla(id));
  fila.querySelector(".inp-buscar-protocolo").addEventListener("input", (e) => actualizarBuscadorProtocoloConsultaGrilla(id, e.target.value));

  lista.appendChild(fila);
  protocolosSeleccionadosConsultaGrilla[id] = null;
}

function actualizarBuscadorProtocoloConsultaGrilla(filaId, texto) {
  const resultados = document.querySelector(`#${filaId} .resultados-protocolo`);
  resultados.innerHTML = "";

  if (!texto.trim()) {
    protocolosSeleccionadosConsultaGrilla[filaId] = null;
    actualizarResumenDuracionConsultaGrilla();
    return;
  }

  const norm = normalizarTexto(texto);
  const encontrados = protocolosCacheCarga.filter(p => normalizarTexto(p.nombre).includes(norm));

  encontrados.slice(0, 5).forEach(p => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtmlGrilla(p.nombre)} (${p.duracionMinutos} min)</span>
      <button type="button" class="enlace-accion">usar</button>`;
    div.querySelector("button").addEventListener("click", () => {
      protocolosSeleccionadosConsultaGrilla[filaId] = { protocoloId: p.id, nombre: p.nombre, duracionMinutos: p.duracionMinutos };
      document.querySelector(`#${filaId} input`).value = p.nombre;
      resultados.innerHTML = "";
      actualizarResumenDuracionConsultaGrilla();
    });
    resultados.appendChild(div);
  });
}

function quitarFilaProtocoloConsultaGrilla(filaId) {
  const filas = document.querySelectorAll("#lista-protocolos-consulta-grilla .fila-medicamento");
  if (filas.length <= 1) {
    alert("Tiene que quedar al menos un protocolo cargado.");
    return;
  }
  delete protocolosSeleccionadosConsultaGrilla[filaId];
  document.getElementById(filaId).remove();
  actualizarResumenDuracionConsultaGrilla();
}

function actualizarResumenDuracionConsultaGrilla() {
  const sumaProtocolos = Object.values(protocolosSeleccionadosConsultaGrilla)
    .filter(p => p !== null)
    .reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0);
  const premedicacion = document.getElementById("campo-premedicacion-consulta-grilla").checked;
  const total = sumaProtocolos + (premedicacion ? PREMEDICACION_MINUTOS : 0);
  const detalle = premedicacion
    ? `${sumaProtocolos} min de protocolo(s) + ${PREMEDICACION_MINUTOS} min de premedicación`
    : `${sumaProtocolos} min de protocolo(s)`;
  const el = document.getElementById("resumen-duracion-consulta-grilla");
  el.textContent = `Duración total: ${total} min (${detalle}).`;
  el.className = "resumen-suma " + (total > 0 ? "ok" : "error");
}

// --- Búsqueda (llamado directo a buscarHuecosEnSede, sin wrapper propio) ---

async function buscarDisponibilidadGrilla() {
  const sedeId = document.getElementById("select-sede-consulta-grilla").value;
  if (!sedeId) {
    mostrarMensajeConsultaDisponibilidadGrilla("Elegí una sede.", "error");
    return;
  }

  const protocolosElegidos = Object.values(protocolosSeleccionadosConsultaGrilla).filter(p => p !== null);
  if (protocolosElegidos.length === 0) {
    mostrarMensajeConsultaDisponibilidadGrilla("Elegí al menos un protocolo.", "error");
    return;
  }

  const premedicacion = document.getElementById("campo-premedicacion-consulta-grilla").checked;
  const duracionMinutos = protocolosElegidos.reduce((total, p) => total + (Number(p.duracionMinutos) || 0), 0)
    + (premedicacion ? PREMEDICACION_MINUTOS : 0);

  const medicoId = document.getElementById("select-medico-consulta-grilla").value || null;
  const medicoDoc = medicoId ? medicosCacheCarga.find(m => m.id === medicoId) : undefined;

  const sedeDoc = sedesCacheCarga.find(s => s.id === sedeId);
  if (!sedeDoc) {
    mostrarMensajeConsultaDisponibilidadGrilla("No se pudo leer la información de la sede. Reintentá en unos segundos.", "error");
    return;
  }

  const fechaElegida = document.getElementById("campo-fecha-consulta-grilla").value;
  const fechaInicioBusqueda = fechaElegida ? fechaDesdeISO(fechaElegida) : fechaDesdeISO(fechaLocalHoy());

  // Ronda "mejoras motor", Frente 3: mismo criterio que la carga normal — el sillón
  // backup ya no forma parte del pool automático, tampoco en el simulador de T10.
  const sillones = (sedeDoc.sillones || [])
    .filter(s => s.tipo === "regular")
    .map(s => s.numero);
  const turnosEnSede = turnosExistentes.filter(t => t.sedeId === sedeId);

  const boton = document.getElementById("boton-buscar-disponibilidad-grilla");
  boton.disabled = true;
  mostrarMensajeConsultaDisponibilidadGrilla("Buscando…", "info");
  document.getElementById("resultado-disponibilidad-grilla").innerHTML = "";
  ultimoResultadoConsultaDisponibilidadGrilla = null;

  try {
    const resultado = await buscarHuecosEnSede(
      sedeId,
      sedeDoc.nombre,
      fechaInicioBusqueda,
      duracionMinutos,
      sedeDoc.horaApertura,
      sedeDoc.horaCierre,
      sedeDoc.diasAtencion || [],
      turnosEnSede,
      sillones,
      medicoId,
      medicoDoc,
      sedeDoc.usaAtaduraDia === true,
      sedeDoc.usaCuposPorcentaje === true,
      cuposCacheCarga,
      undefined, // diasBloqueadosPaciente: no aplica, esta pantalla no pide paciente
      bloqueosCacheCarga
    );

    // Para poder avisar con precisión cuándo la atadura de día es la causa real de "sin
    // huecos" (y no simplemente que no había lugar físico ningún día): se calcula acá,
    // con los mismos datos que usa resolverSedesPosiblesMedico() en turnero-carga.js, si
    // el médico elegido atiende esta sede el día de la semana puntualmente pedido.
    const DIAS_SEMANA_ES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const nombreDiaPedido = DIAS_SEMANA_ES[fechaInicioBusqueda.getDay()];
    const diasDelMedicoEnEstaSede = medicoDoc && medicoDoc.diasPorSede ? (medicoDoc.diasPorSede[sedeDoc.nombre] || []) : null;
    const ataduraBloqueaDiaPedido = sedeDoc.usaAtaduraDia === true && !!medicoId
      && diasDelMedicoEnEstaSede !== null && !diasDelMedicoEnEstaSede.includes(nombreDiaPedido);

    document.getElementById("mensaje-consulta-disponibilidad-grilla").style.display = "none";
    renderizarResultadoDisponibilidadGrilla(resultado, {
      sedeId, sedeNombre: sedeDoc.nombre,
      medicoId, medicoNombre: medicoDoc ? medicoDoc.nombre : null,
      protocolosElegidos, premedicacion,
      fechaPedidaISO: fechaElegida || null,
      ataduraBloqueaDiaPedido
    });
  } catch (error) {
    console.error("Error al buscar disponibilidad:", error);
    mostrarMensajeConsultaDisponibilidadGrilla("No se pudo completar la búsqueda. Reintentá en unos segundos.", "error");
  } finally {
    boton.disabled = false;
  }
}

// Arma el bloque de resultado. buscarHuecosEnSede ya corta en el primer día con huecos
// y los devuelve todos ordenados por mejor ajuste (no solo el mejor) — se muestran
// todos, tal cual vienen. Contempla los dos casos de uso confirmados con Elías: fecha
// puntual (aclara si el motor tuvo que correrse a otro día) y pregunta abierta (muestra
// directo la primera fecha con lugar).
function renderizarResultadoDisponibilidadGrilla(resultado, contexto) {
  const cont = document.getElementById("resultado-disponibilidad-grilla");

  if (resultado.huecos.length > 0) {
    const fechaEncontrada = resultado.huecos[0].fecha;
    const fechaLegible = resultado.huecos[0].fechaLegible || fechaEncontrada;
    let aviso = "";
    // Fecha puntual pedida pero el motor se corrió a un día posterior: aclarar (decisión
    // con Elías — sugerir la fecha más próxima en vez de un mensaje seco).
    if (contexto.fechaPedidaISO && contexto.fechaPedidaISO !== fechaEncontrada) {
      aviso = `<p style="font-size:13px;color:var(--color-muted);margin-top:0;">
        Ese día no había lugar. El próximo espacio disponible es el <strong>${escaparHtmlGrilla(fechaLegible)}</strong>:
      </p>`;
    } else {
      aviso = `<p style="font-size:13px;margin-top:0;">Hay lugar el <strong>${escaparHtmlGrilla(fechaLegible)}</strong>:</p>`;
    }

    const filasHuecos = resultado.huecos.map(h => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-border);font-size:13.5px;">
        <span>Sillón ${h.sillon}</span>
        <span>${h.horaInicio} a ${h.horaFin}</span>
      </div>
    `).join("");

    cont.innerHTML = `
      ${aviso}
      <div>${filasHuecos}</div>
      <button type="button" id="boton-cargar-este-turno-consulta-grilla" class="boton-principal" style="margin-top:14px;" onclick="cargarEsteTurnoDesdeConsultaGrilla()">Cargar este turno</button>
    `;

    ultimoResultadoConsultaDisponibilidadGrilla = {
      sedeId: contexto.sedeId,
      medicoId: contexto.medicoId,
      medicoNombre: contexto.medicoNombre,
      protocolosElegidos: contexto.protocolosElegidos,
      premedicacion: contexto.premedicacion,
      fechaEncontrada
    };
    return;
  }

  // Sin huecos. Distinguir el caso de atadura de día, porque ahí el motor no busca
  // fecha alternativa (corta directo si el día pedido no es del médico) — a diferencia
  // de cupo, que sí sigue buscando pero puede agotar los 10 días igual.
  if (contexto.ataduraBloqueaDiaPedido) {
    cont.innerHTML = `<p style="font-size:13px;color:var(--color-danger);margin:0;">
      ${escaparHtmlGrilla(contexto.medicoNombre || "Este médico")} no atiende en ${escaparHtmlGrilla(contexto.sedeNombre)}
      el día pedido. El motor no busca una fecha alternativa en este caso — probá con otro día
      donde el médico sí atienda esa sede.
    </p>`;
    return;
  }

  if (resultado.candidatoCupoExcedido) {
    cont.innerHTML = `<p style="font-size:13px;color:var(--color-danger);margin:0;">
      Había lugar físico ese día, pero ${escaparHtmlGrilla(contexto.medicoNombre || "el médico")} ya alcanzó
      su cupo. Esta pantalla no ofrece cargar como excepción — para eso, usá "+ Nuevo turno".
    </p>`;
    return;
  }

  cont.innerHTML = `<p style="font-size:13px;color:var(--color-danger);margin:0;">
    No se encontró lugar en los próximos 10 días con estos datos.
  </p>`;
}

// Cierra la consulta y abre "+ nuevo turno" con médico/protocolo(s)/fecha precargados.
// El paciente se elige recién en "+ nuevo turno", con el flujo de guardado de siempre —
// esta función nunca escribe en Firestore. Toca variables globales de turnero-carga.js
// a propósito (protocolosSeleccionados, contadorFilasProtocolo, modoFechaTurno), mismo
// criterio ya usado por Reasignar/Modificar más arriba.
async function cargarEsteTurnoDesdeConsultaGrilla() {
  const datos = ultimoResultadoConsultaDisponibilidadGrilla;
  if (!datos) return;

  cerrarConsultaDisponibilidadGrilla();
  await abrirModalNuevoTurnoGrilla();

  // Médico: si el rol es médico, "+ nuevo turno" ya lo fija en sí mismo (coincide con
  // la consulta, que también lo fija) — no se toca el select. Para administrador/
  // enfermería, se precarga acá.
  if (rolActualCarga !== "medico") {
    const selectMedico = document.getElementById("campo-medico");
    selectMedico.value = datos.medicoId || "otro"; // "Sin médico específico" en la consulta → "Otro" acá
    actualizarBloqueMedico();
  }
  // Sede manual: independiente del rol — un médico que atiende las dos sedes (ej.
  // Occhipinti) también ve este selector en "+ nuevo turno", igual que administrador/
  // enfermería con médico "Otro" o con más de una sede posible. Si el formulario la
  // dejó automática (un único posible, o Occhipinti por obra social — recién se resuelve
  // al elegir paciente), no se toca; puede no coincidir con la sede de acá si la obra
  // social deriva a la otra sede (comportamiento ya existente, no nuevo de esta etapa).
  const selectSedeManual = document.getElementById("campo-sede-manual");
  if (selectSedeManual.style.display !== "none") {
    selectSedeManual.value = datos.sedeId;
  }

  // Protocolos: reconstruir las filas para que coincidan exactamente con lo elegido en
  // la consulta (agregarFilaProtocolo() no acepta prellenado, a diferencia de la copia
  // de Modificar — se arma la fila vacía y se completa a mano acá).
  document.getElementById("lista-protocolos").innerHTML = "";
  protocolosSeleccionados = {};
  datos.protocolosElegidos.forEach(p => {
    agregarFilaProtocolo();
    const filas = document.querySelectorAll("#lista-protocolos .fila-medicamento");
    const filaNueva = filas[filas.length - 1];
    filaNueva.querySelector(".inp-buscar-protocolo").value = p.nombre;
    protocolosSeleccionados[filaNueva.id] = { protocoloId: p.protocoloId, nombre: p.nombre, duracionMinutos: p.duracionMinutos };
  });

  document.getElementById("campo-premedicacion").checked = datos.premedicacion === true;

  // Fecha: pasar a modo calendario con la fecha exacta donde se encontró el hueco.
  modoFechaTurno = "calendario";
  renderizarModoFecha();
  document.getElementById("campo-fecha").value = datos.fechaEncontrada;

  actualizarResumenDuracion();
  mostrarMensajeGeneral("Datos precargados desde la consulta de disponibilidad. Elegí el paciente y confirmá.", "info");
}

// --- Eliminar (Etapa T7, Fase 2) ---
// No borra nada — marca el turno como estado "cancelado" con motivo y usuario, y deja
// de aparecer en la agenda (toda lectura de turnos ya filtra por estado === "activo",
// no hace falta tocar ninguna consulta). Sin turno de reemplazo, a diferencia de
// reasignar/modificar. Mismo modal de motivo, mismo mecanismo de guardado
// (anularYCrearTurnoGrilla), mismo permiso por rol que el resto de T7.
function abrirEliminarGrilla(turnoId) {
  const turno = turnosCacheGrilla.find(t => t.id === turnoId);
  if (!turno || !puedeArrastrarTurnoGrilla(turno)) return; // resguardo — el botón que llama a esto ya está gateado igual

  cerrarDetalleTurnoGrilla();

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "el paciente";
  abrirModalMotivoGrilla(
    turno,
    {}, // sin turno de reemplazo, no hace falta armar camposNuevos
    "eliminarFormulario",
    `Vas a eliminar el turno de ${paciente} (${turno.fecha || "-"}, ${turno.horarioInicio || "-"}hs). Esta acción no se puede deshacer desde la agenda.`,
    "Confirmar eliminación"
  );
}

// --- Mecanismo formal de trazabilidad (Etapa T7) ---
// Reemplaza el rastro simple de T6 Fase 3 (que actualizaba el turno en el lugar y
// pisaba "ultimaReasignacion" en cada movimiento). Acá el turno original nunca se toca
// más que para anularlo — queda como registro histórico completo. En "reasignado" y
// "modificado" (Fase 1) además se crea un turno nuevo enlazado por id en ambas
// direcciones, mismo patrón que ya usa correcciones.js con las entregas de Medicación:
// la referencia del documento nuevo se genera ANTES del batch para poder escribir el
// enlace cruzado (turnoNuevoId) en la misma operación, sin necesitar una segunda
// escritura después del commit. En "cancelado" (Fase 2, eliminar) no hay reemplazo —
// solo se anula.
//
// turnoOriginal: el turno tal como está en caché (incluye "id").
// camposNuevos: los campos que cambian respecto del original — se combinan con una
// copia del resto de los campos del turno original (paciente, médico, protocolos, etc.).
// Ignorado en "cancelado" (no hay turno nuevo que armar).
// motivo: texto obligatorio, se guarda en el turno que se anula.
// tipoAccion: "reasignado" (cambio de fecha/horario, vía arrastre o formulario),
// "modificado" (corrección de otro dato) o "cancelado" (eliminar) — define el estado
// que queda en el turno viejo.
async function anularYCrearTurnoGrilla(turnoOriginal, camposNuevos, motivo, tipoAccion) {
  const datosAnulacion = {
    estado: tipoAccion,
    motivoCambio: motivo,
    anuladoPor: {
      uid: usuarioActualGrilla.uid,
      nombre: datosUsuarioActualGrilla.nombre || usuarioActualGrilla.email
    },
    anuladoEn: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (tipoAccion === "cancelado") {
    // Eliminar (Fase 2): sin turno de reemplazo, una sola escritura alcanza. No genera
    // comprobante nuevo (T8) — no hay turno nuevo al que emitírselo.
    await db.collection("turnos").doc(turnoOriginal.id).update(datosAnulacion);
    return null;
  }

  const nuevoRef = db.collection("turnos").doc();

  // Campos exclusivos del turno viejo (rastro de anulación), generados de nuevo para el
  // turno que se crea, o propios del comprobante (Etapa T8) — nunca se copian tal cual
  // de un documento al otro. "numeroComprobante" del nuevo se genera recién después del
  // commit (ver más abajo); "numeroComprobanteReemplazado" se arma acá mismo con el
  // número del turno original, pero como campo nuevo, no copiado.
  const camposExcluidos = new Set([
    "id", "estado", "creadoPor", "creadoEn", "modificadoPor", "modificadoEn",
    "ultimaReasignacion", "anuladoPor", "anuladoEn", "motivoCambio", "turnoNuevoId",
    "turnoOriginalId", "numeroComprobante", "numeroComprobanteReemplazado",
    "reemplazadoPorNumero", "reemplazadoPorId"
  ]);
  const docNuevo = {};
  for (const [clave, valor] of Object.entries(turnoOriginal)) {
    if (!camposExcluidos.has(clave)) docNuevo[clave] = valor;
  }
  Object.assign(docNuevo, camposNuevos);
  docNuevo.estado = "activo";
  docNuevo.creadoPor = {
    uid: usuarioActualGrilla.uid,
    nombre: datosUsuarioActualGrilla.nombre || usuarioActualGrilla.email
  };
  docNuevo.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
  docNuevo.turnoOriginalId = turnoOriginal.id;
  // Etapa T8: si el turno original ya tenía comprobante (todo turno creado desde esta
  // etapa lo tiene; uno cargado antes de T8 puede no tenerlo), el nuevo queda enlazado
  // hacia atrás de una. La referencia hacia adelante (reemplazadoPorNumero, en el turno
  // viejo) recién se puede escribir después del commit, cuando se conoce el número
  // propio del turno nuevo — ver más abajo, mismo criterio que correcciones.js con los
  // comprobantes de Medicación.
  if (turnoOriginal.numeroComprobante) {
    docNuevo.numeroComprobanteReemplazado = turnoOriginal.numeroComprobante;
  }

  datosAnulacion.turnoNuevoId = nuevoRef.id;

  const batch = db.batch();
  const anio = new Date().getFullYear().toString();
  const contadorRef = db.collection("contadores").doc("comprobantesTurno");
  batch.set(nuevoRef, docNuevo);
  batch.update(db.collection("turnos").doc(turnoOriginal.id), datosAnulacion);
  batch.set(contadorRef, { [anio]: firebase.firestore.FieldValue.increment(1) }, { merge: true });
  await batch.commit();

  // Etapa T8: número de comprobante del turno nuevo, recién después del commit (mismo
  // motivo que en guardarTurnoConHueco(), turnero-carga.js). Con eso ya se puede además
  // avisar en el turno viejo con qué comprobante fue reemplazado — solo si el viejo
  // tenía uno propio para reemplazar.
  const contadorSnap = await contadorRef.get();
  const numeroCorrelativo = contadorSnap.data()[anio];
  const numeroComprobante = formatearNumeroComprobanteTurno(anio, numeroCorrelativo);
  await nuevoRef.update({ numeroComprobante });
  if (turnoOriginal.numeroComprobante) {
    await db.collection("turnos").doc(turnoOriginal.id).update({
      reemplazadoPorNumero: numeroComprobante,
      reemplazadoPorId: nuevoRef.id
    });
  }

  return nuevoRef.id;
}

// --- Detalle del turno (feedback tras Fase 3) ---
// La tarjeta comprimida solo muestra sillón + apellido; acá va todo lo demás, en un
// modal centrado (mismo patrón .overlay-modal/.modal-panel que "+ nuevo turno").

function abrirDetalleTurnoGrilla(turnoId) {
  const turno = turnosCacheGrilla.find(t => t.id === turnoId);
  if (!turno) return;

  const sede = sedesCacheGrilla.find(s => s.id === sedeSeleccionadaGrilla);
  const infoSillon = sede && (sede.sillones || []).find(s => s.numero === turno.sillon);
  const esBackup = infoSillon && infoSillon.tipo === "backup";
  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";

  const filas = [
    ["Paciente", paciente],
    ["Sillón", turno.sillon != null ? `${turno.sillon}${esBackup ? " (backup)" : ""}` : "Sin asignar (sobreturno)"],
    ["Horario", `${turno.horarioInicio || "-"} – ${turno.horarioFin || "-"}`],
    ["Fecha", turno.fecha || "-"],
    ["Médico", turno.medicoNombre || "-"]
  ];
  if (turno.ciclo != null || turno.sesion != null) {
    filas.push(["Ciclo / Sesión", `${turno.ciclo ?? "-"} / ${turno.sesion ?? "-"}`]);
  }
  if (turno.paciente && turno.paciente.numeroDocumento) {
    filas.push(["Documento", `${turno.paciente.tipoDocumento || ""} ${turno.paciente.numeroDocumento}`.trim()]);
  }
  if (turno.paciente && turno.paciente.obraSocial) {
    filas.push(["Obra social", turno.paciente.obraSocial]);
  }
  if (turno.tipoSobreturno) {
    filas.push(["Sobreturno", turno.tipoSobreturno]);
  }

  const filasHtml = filas.map(([etiqueta, valor]) => `
    <div class="fila-detalle-turno-grilla">
      <span class="etiqueta-detalle-turno-grilla">${escaparHtmlGrilla(etiqueta)}</span>
      <span>${escaparHtmlGrilla(valor)}</span>
    </div>
  `).join("");

  // Etapa T7: "Reasignar"/"Modificar"/"Eliminar" respetan el mismo permiso que ya regía
  // el arrastre (administrador/enfermería sin restricción; médico solo turnos propios y
  // habilitado). "Eliminar" se distingue con el color de peligro (--color-danger), nada
  // más — mismo modal de motivo que las otras dos, sin confirmación aparte.
  //
  // Ajuste post-entrega de la Etapa T8, a pedido de Elías: "Reimprimir" (solo ícono, más
  // chico que los otros tres) va SIEMPRE, sin depender de puedeArrastrarTurnoGrilla() —
  // reimprimir el comprobante es una acción de lectura, igual que en el historial, no
  // una edición del turno. abrirComprobanteTurno() está definida en turnero-carga.js,
  // que se carga antes que este archivo en agenda.html.
  const botonReimprimirHtml = `
    <button type="button" class="boton-icono" title="Reimprimir comprobante" aria-label="Reimprimir comprobante" onclick="abrirComprobanteTurno('${turno.id}')">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    </button>`;
  const botonesEdicionHtml = puedeArrastrarTurnoGrilla(turno)
    ? `<button type="button" class="boton-principal" style="width:auto;" onclick="abrirReasignarGrilla('${turno.id}')">Reasignar</button>
       <button type="button" class="boton-secundario" style="width:auto;" onclick="abrirModificarGrilla('${turno.id}')">Modificar</button>
       <button type="button" class="boton-secundario" style="width:auto;color:var(--color-danger);border-color:var(--color-danger);" onclick="abrirEliminarGrilla('${turno.id}')">Eliminar</button>`
    : "";
  const botonesAccionHtml = `<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center;">
         ${botonReimprimirHtml}
         ${botonesEdicionHtml}
       </div>`;

  document.getElementById("contenido-detalle-turno-grilla").innerHTML = `
    <h2 style="margin-top:0;">Detalle del turno</h2>
    ${filasHtml}
    ${botonesAccionHtml}
  `;
  document.getElementById("overlay-detalle-turno-grilla").style.display = "flex";
}

function cerrarDetalleTurnoGrilla() {
  document.getElementById("overlay-detalle-turno-grilla").style.display = "none";
}

function cerrarDetalleTurnoGrillaSiFondo(evento) {
  if (evento.target.id === "overlay-detalle-turno-grilla") cerrarDetalleTurnoGrilla();
}
