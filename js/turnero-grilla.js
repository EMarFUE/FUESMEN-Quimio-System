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
    await cargarSedesGrilla();
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

  sedeSeleccionadaGrilla = sedesCacheGrilla.some(s => s.id === "emilio-civit")
    ? "emilio-civit"
    : sedesCacheGrilla[0].id;

  renderizarSelectorSedeGrilla();
  await cargarYRenderizarGrilla();
}

async function cargarSedesGrilla() {
  const snapshot = await db.collection("turneroSedes").get();
  sedesCacheGrilla = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  sedesCacheGrilla.sort((a, b) => (a.id === "emilio-civit" ? -1 : 1));
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
    const turnosDelDia = turnosVisibles.filter(t => t.fecha === fechaDiaISO);
    const tarjetasHtml = turnosDelDia
      .map(turno => renderizarTarjetaTurnoGrilla(turno, minutoApertura, sede))
      .join("");

    return `
      <div class="columna-dia-grilla">
        <div class="encabezado-dia-grilla ${fechaDiaISO === hoyISO ? "hoy" : ""}">
          ${DIAS_LABEL_GRILLA[DIAS_SEMANA_GRILLA[indice]]}
          <span class="fecha-dia-grilla">${String(dia.getDate()).padStart(2, "0")}/${String(dia.getMonth() + 1).padStart(2, "0")}</span>
        </div>
        <div class="pista-dia-grilla" style="height:${alturaTotal}px;">
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

function renderizarTarjetaTurnoGrilla(turno, minutoApertura, sede) {
  if (typeof turno.horarioInicio !== "string" || typeof turno.horarioFin !== "string") {
    // Turnos de T1/T2, sin estos campos todavía — no se pueden ubicar en la grilla.
    return "";
  }

  const inicio = minutoDesdeString(turno.horarioInicio);
  const fin = minutoDesdeString(turno.horarioFin);
  const top = (inicio - minutoApertura) * PIXELES_POR_MINUTO_GRILLA;
  const alto = Math.max((fin - inicio) * PIXELES_POR_MINUTO_GRILLA, 18);

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
    <div class="tarjeta-turno-grilla" style="top:${top}px;height:${alto}px;" title="${tituloCompleto}">
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
