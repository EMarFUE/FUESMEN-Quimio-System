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
const ALTO_LINEA_GRILLA = 13; // alto aproximado de cada línea de texto dentro de una tarjeta
const LINEAS_BASE_GRILLA = 3; // sillón+horario, paciente, médico — siempre se muestran

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
      cargarYRenderizarGrilla(); // refresca la grilla de fondo sin cerrar el modal,
      // así se puede seguir cargando turnos para otros pacientes y ver el resultado
    }
  });
  observer.observe(mensaje, { childList: true, characterData: true, subtree: true });
}

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
    return !!datosUsuarioActualGrilla.medicoId && turno.medicoId === datosUsuarioActualGrilla.medicoId;
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

  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";

  const infoSillon = (sede.sillones || []).find(s => s.numero === turno.sillon);
  const esBackup = infoSillon && infoSillon.tipo === "backup";
  const textoSillon = turno.sillon != null ? `S${turno.sillon}` : "S?";

  // Líneas opcionales, en el orden pedido: ciclo/sesión, DNI, obra social.
  // Solo se muestran las que entran según el alto real de la tarjeta (proporcional
  // a la duración del turno) — en tarjetas cortas no se agrega ninguna, y el
  // tooltip (title) siempre tiene el detalle completo igual.
  const lineasOpcionales = [];
  if (turno.ciclo != null || turno.sesion != null) {
    const partes = [];
    if (turno.ciclo != null) partes.push(`Ciclo ${turno.ciclo}`);
    if (turno.sesion != null) partes.push(`Sesión ${turno.sesion}`);
    lineasOpcionales.push(partes.join(" · "));
  }
  if (turno.paciente && turno.paciente.numeroDocumento) {
    lineasOpcionales.push(`DNI ${turno.paciente.numeroDocumento}`);
  }
  if (turno.paciente && turno.paciente.obraSocial) {
    lineasOpcionales.push(turno.paciente.obraSocial);
  }

  const lineasDisponibles = Math.floor((alto - 8) / ALTO_LINEA_GRILLA) - LINEAS_BASE_GRILLA;
  const lineasAMostrar = lineasOpcionales.slice(0, Math.max(lineasDisponibles, 0));
  const lineasOpcionalesHtml = lineasAMostrar
    .map(texto => `<span class="detalle-turno-grilla">${escaparHtmlGrilla(texto)}</span>`)
    .join("");

  const tituloPartes = [
    paciente,
    turno.medicoNombre || "",
    `${turno.horarioInicio}–${turno.horarioFin}`,
    (turno.ciclo != null || turno.sesion != null) ? `Ciclo ${turno.ciclo ?? "-"} · Sesión ${turno.sesion ?? "-"}` : null,
    turno.paciente && turno.paciente.numeroDocumento ? `DNI ${turno.paciente.numeroDocumento}` : null,
    turno.paciente && turno.paciente.obraSocial ? turno.paciente.obraSocial : null
  ].filter(Boolean);
  const tituloCompleto = escaparHtmlGrilla(tituloPartes.join(" · "));

  return `
    <div class="tarjeta-turno-grilla ${puedeArrastrar ? "arrastrable-grilla" : ""}"
      style="top:${top}px;height:${alto}px;${posicionHtml}" title="${tituloCompleto}"
      data-turno-id="${turno.id}"
      ${puedeArrastrar ? `onpointerdown="iniciarArrastreGrilla(event, '${turno.id}')"` : ""}>
      <span class="linea-superior-turno-grilla">
        <span class="badge-sillon-grilla ${esBackup ? "backup" : ""}">${textoSillon}</span>
        <span class="horario-turno-grilla">${turno.horarioInicio}</span>
      </span>
      <span class="paciente-turno-grilla">${escaparHtmlGrilla(paciente)}</span>
      <span class="medico-turno-grilla">${escaparHtmlGrilla(turno.medicoNombre || "")}</span>
      ${lineasOpcionalesHtml}
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

  estado.huecosSemana = await buscarHuecosSemanaEnSede(
    sede.id, sede.nombre, diasVisibles,
    turno.duracionTotalMinutos, sede.horaApertura, sede.horaCierre, sede.diasAtencion,
    turnosSinElArrastrado, sillones,
    turno.medicoId, medicoDoc, sede.usaAtaduraDia === true, sede.usaCuposPorcentaje === true,
    cuposCacheGrilla
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

  limpiarVisualArrastreGrilla(estado);
  arrastreActivoGrilla = null;

  if (!huboMovimientoReal || !candidato) return; // toque simple, o soltó fuera de un hueco válido

  await confirmarArrastreGrilla(estado.turno, candidato);
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

async function confirmarArrastreGrilla(turno, candidato) {
  const hueco = candidato.hueco;

  const sinCambioReal = turno.fecha === hueco.fecha &&
    turno.horarioInicio === hueco.horaInicio && turno.sillon === hueco.sillon;
  if (sinCambioReal) return; // soltó en el mismo lugar donde ya estaba

  // Rastro de auditoría simple (punto 5 de las decisiones de Fase 3): un único objeto
  // con la posición anterior, que se pisa en cada arrastre — no un historial completo,
  // eso queda para el mecanismo formal de la Etapa T7 si hace falta más adelante.
  const actualizacion = {
    fecha: hueco.fecha,
    horarioInicio: hueco.horaInicio,
    horarioFin: hueco.horaFin,
    horario: hueco.horaInicio, // compatibilidad con el comprobante, mismo criterio que al cargar
    sillon: hueco.sillon,
    modificadoPor: {
      uid: usuarioActualGrilla.uid,
      nombre: datosUsuarioActualGrilla.nombre || usuarioActualGrilla.email
    },
    modificadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    ultimaReasignacion: {
      fecha: turno.fecha,
      horarioInicio: turno.horarioInicio,
      horarioFin: turno.horarioFin,
      sillon: turno.sillon
    }
  };

  try {
    await db.collection("turnos").doc(turno.id).update(actualizacion);
    mostrarMensajeAgenda("Turno reasignado correctamente.", "exito");
    await cargarYRenderizarGrilla();
  } catch (error) {
    console.error("Error al reasignar el turno:", error);
    mostrarMensajeAgenda("No se pudo mover el turno. Reintentá en unos segundos.", "error");
    await cargarYRenderizarGrilla(); // por las dudas, refresca para reflejar el estado real
  }
}
