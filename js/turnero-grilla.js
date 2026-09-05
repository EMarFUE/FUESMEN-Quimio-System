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

// Fase 3 (T6): estado del arrastre en curso (null cuando no se está arrastrando nada).
let arrastreActivoGrilla = null;

// Etapa T7: arrastre pendiente de motivo (el candidato ya se soltó en un hueco válido,
// pero todavía no se guardó — espera a que se complete el modal de motivo). También lo
// usa "Reasignar" por formulario (mismo modal de motivo, otro origen).
let arrastrePendienteGrilla = null;

// Etapa T7 — Reasignar por formulario: id del turno que se está reasignando mientras el
// modal de búsqueda está abierto.
let turnoIdReasignarActual = null;

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
  }

  try {
    await Promise.all([cargarSedesGrilla(), cargarMedicosGrilla(), cargarCuposGrilla()]);
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
      cargarSedesCarga(), cargarTurnosExistentes(), cargarCuposCarga()
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
    if (mensaje.textContent.trim() === "Turno guardado correctamente.") {
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
  const overlayDetalle = document.getElementById("overlay-detalle-turno-grilla");
  if (overlayDetalle && overlayDetalle.style.display !== "none") {
    cerrarDetalleTurnoGrilla();
    return;
  }
  const overlayNuevoTurno = document.getElementById("overlay-nuevo-turno-grilla");
  if (overlayNuevoTurno && overlayNuevoTurno.style.display !== "none") {
    cerrarModalNuevoTurnoGrilla();
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

async function cargarTurnosGrilla() {
  const snapshot = await db.collection("turnos")
    .where("sedeId", "==", sedeSeleccionadaGrilla)
    .where("estado", "==", "activo")
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
    const lanesDelDia = calcularLanesDiaGrilla(turnosDelDia);
    const tarjetasHtml = turnosDelDia
      .map(turno => renderizarTarjetaTurnoGrilla(turno, minutoApertura, sede, lanesDelDia.get(turno.id)))
      .join("");

    return `
      <div class="columna-dia-grilla">
        <div class="encabezado-dia-grilla ${fechaDiaISO === hoyISO ? "hoy" : ""}">
          ${DIAS_LABEL_GRILLA[DIAS_SEMANA_GRILLA[indice]]}
          <span class="fecha-dia-grilla">${String(dia.getDate()).padStart(2, "0")}/${String(dia.getMonth() + 1).padStart(2, "0")}</span>
        </div>
        <div class="pista-dia-grilla" data-fecha="${fechaDiaISO}" style="height:${alturaTotal}px;">
          ${tarjetasHtml || ""}
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
  const sillones = (sede.sillones || [])
    .filter(s => s.tipo === "regular" || s.tipo === "backup")
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
    cuposCacheGrilla, diasBloqueadosPaciente
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

  abrirModalMotivoGrilla(turno, hueco, null, "arrastre", "mover");
}

// Abre el modal de motivo compartido entre el arrastre y "Reasignar" por formulario —
// misma pregunta, mismo guardado final (anularYCrearTurnoGrilla), solo cambia qué hacer
// después de guardar/cancelar (ver "origen" en cancelarMotivoArrastreGrilla y
// confirmarMotivoArrastreGrilla).
function abrirModalMotivoGrilla(turno, hueco, tipoSobreturno, origen, verbo) {
  arrastrePendienteGrilla = { turno, hueco, tipoSobreturno, origen };
  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "el paciente";
  document.getElementById("texto-motivo-arrastre-grilla").textContent =
    `Vas a ${verbo} el turno de ${paciente} a ${hueco.fechaLegible || hueco.fecha}, ${hueco.horaInicio}hs.`;
  document.getElementById("campo-motivo-arrastre-grilla").value = "";
  document.getElementById("error-motivo-arrastre-grilla").style.display = "none";
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
  // Arrastre: durante el arrastre la tarjeta original queda oculta (visibility:hidden);
  // al cancelar sin guardar nada hace falta refrescar para que vuelva a aparecer en su
  // lugar real.
  cargarYRenderizarGrilla();
}

async function confirmarMotivoArrastreGrilla() {
  const motivo = document.getElementById("campo-motivo-arrastre-grilla").value.trim();
  if (!motivo) {
    document.getElementById("error-motivo-arrastre-grilla").style.display = "block";
    return;
  }
  if (!arrastrePendienteGrilla) return; // por las dudas, no debería poder pasar

  const { turno, hueco, tipoSobreturno, origen } = arrastrePendienteGrilla;
  const botonConfirmar = document.getElementById("boton-confirmar-motivo-arrastre-grilla");
  botonConfirmar.disabled = true;

  try {
    await anularYCrearTurnoGrilla(turno, {
      fecha: hueco.fecha,
      horarioInicio: hueco.horaInicio,
      horarioFin: hueco.horaFin,
      horario: hueco.horaInicio, // compatibilidad con el comprobante, mismo criterio que al cargar
      sillon: hueco.sillon,
      // T7: la sede del hueco encontrado — en el arrastre siempre coincide con la sede
      // ya seleccionada en la grilla, pero en "Reasignar" con un médico de sede
      // automática (Occhipinti) el motor puede haber elegido la otra sede.
      sedeId: hueco.sedeId,
      sedeNombre: hueco.sedeNombre,
      // Un hueco encontrado por el motor (arrastre o "Reasignar") siempre es un sillón
      // físico real (o, si viene de un sobreturno confirmado en "Reasignar", explícito
      // como tal) — nunca hereda un tipoSobreturno viejo que ya no corresponde.
      tipoSobreturno: tipoSobreturno || null
    }, motivo, "reasignado");

    arrastrePendienteGrilla = null;
    document.getElementById("overlay-motivo-arrastre-grilla").style.display = "none";
    if (origen === "reasignarFormulario") {
      document.getElementById("overlay-reasignar-grilla").style.display = "none";
      turnoIdReasignarActual = null;
    }
    mostrarMensajeAgenda("Turno reasignado correctamente.", "exito");
    await cargarYRenderizarGrilla();
  } catch (error) {
    console.error("Error al reasignar el turno:", error);
    mostrarMensajeAgenda("No se pudo reasignar el turno. Reintentá en unos segundos.", "error");
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
  document.getElementById("mensaje-reasignar-grilla").style.display = "none";
  turnoIdReasignarActual = turnoId;
  document.getElementById("overlay-reasignar-grilla").style.display = "flex";

  // Refrescar los catálogos que el motor necesita — puede que en esta sesión nunca se
  // haya abierto "+ nuevo turno" y estos cachés (de turnero-carga.js) arranquen vacíos.
  await Promise.all([
    cargarMedicosCarga(), cargarSedesCarga(), cargarTurnosExistentes(), cargarCuposCarga()
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
  abrirModalMotivoGrilla(turno, hueco, tipoSobreturno, "reasignarFormulario", "reasignar");
}

// --- Mecanismo formal de trazabilidad (Etapa T7) ---
// Reemplaza el rastro simple de T6 Fase 3 (que actualizaba el turno en el lugar y
// pisaba "ultimaReasignacion" en cada movimiento). Acá el turno original nunca se toca
// más que para anularlo — queda como registro histórico completo — y se crea un turno
// nuevo enlazado por id en ambas direcciones. Mismo patrón que ya usa correcciones.js
// con las entregas de Medicación: la referencia del documento nuevo se genera ANTES del
// batch para poder escribir el enlace cruzado (turnoNuevoId) en la misma operación, sin
// necesitar una segunda escritura después del commit.
//
// turnoOriginal: el turno tal como está en caché (incluye "id").
// camposNuevos: los campos que cambian respecto del original — se combinan con una
// copia del resto de los campos del turno original (paciente, médico, protocolos, etc.).
// motivo: texto obligatorio, se guarda en el turno que se anula.
// tipoAccion: "reasignado" (cambio de fecha/horario, vía arrastre o formulario) o
// "modificado" (corrección de otro dato) — define el estado que queda en el turno viejo.
async function anularYCrearTurnoGrilla(turnoOriginal, camposNuevos, motivo, tipoAccion) {
  const nuevoRef = db.collection("turnos").doc();

  // Campos exclusivos del turno viejo (rastro de anulación) o generados de nuevo para
  // el turno que se crea — nunca se copian tal cual de un documento al otro.
  const camposExcluidos = new Set([
    "id", "estado", "creadoPor", "creadoEn", "modificadoPor", "modificadoEn",
    "ultimaReasignacion", "anuladoPor", "anuladoEn", "motivoCambio", "turnoNuevoId",
    "turnoOriginalId"
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

  const datosAnulacion = {
    estado: tipoAccion,
    motivoCambio: motivo,
    anuladoPor: {
      uid: usuarioActualGrilla.uid,
      nombre: datosUsuarioActualGrilla.nombre || usuarioActualGrilla.email
    },
    anuladoEn: firebase.firestore.FieldValue.serverTimestamp(),
    turnoNuevoId: nuevoRef.id
  };

  const batch = db.batch();
  batch.set(nuevoRef, docNuevo);
  batch.update(db.collection("turnos").doc(turnoOriginal.id), datosAnulacion);
  await batch.commit();
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

  // Etapa T7, Fase 1: "Reasignar" respeta el mismo permiso que ya regía el arrastre
  // (administrador/enfermería sin restricción; médico solo turnos propios y habilitado).
  const botonReasignarHtml = puedeArrastrarTurnoGrilla(turno)
    ? `<button type="button" class="boton-principal" style="margin-top:16px;" onclick="abrirReasignarGrilla('${turno.id}')">Reasignar</button>`
    : "";

  document.getElementById("contenido-detalle-turno-grilla").innerHTML = `
    <h2 style="margin-top:0;">Detalle del turno</h2>
    ${filasHtml}
    ${botonReasignarHtml}
  `;
  document.getElementById("overlay-detalle-turno-grilla").style.display = "flex";
}

function cerrarDetalleTurnoGrilla() {
  document.getElementById("overlay-detalle-turno-grilla").style.display = "none";
}

function cerrarDetalleTurnoGrillaSiFondo(evento) {
  if (evento.target.id === "overlay-detalle-turno-grilla") cerrarDetalleTurnoGrilla();
}
