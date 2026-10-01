// Etapa 5, fase 1 — vista mensual de la agenda (turnero/agenda-mensual.html).
//
// Pantalla de SOLO CONSULTA (decisión con Elías): no arrastra ni edita turnos. Cada día
// muestra la cantidad de turnos y una línea "hora + apellido" por turno; clic en el turno
// abre un detalle de solo lectura, y de ahí un botón lleva a la semana de ese turno
// (agenda.html) para editar, comentar o reimprimir. El número de cada día abre la vista de
// día (agenda.html con ?vista=dia). Prioridad, presente y comentarios NO
// se dibujan en la línea: se ven en el tooltip y en el detalle.
//
// Carga de datos (diseñada para no releer de más):
// - UNA consulta por mes y por sede, con la misma forma que la de la semana (sedeId +
//   estado + rango de fecha), así que usa el mismo índice compuesto ya existente.
// - El rango es el mes exacto (día 1 al último día): los días de las semanas vecinas que
//   completan la grilla quedan en blanco y no se leen.
// - Cada mes leído queda en memoria (cacheMesesMensual) mientras la pantalla siga abierta:
//   volver a un mes ya visto no consulta la base. "Actualizar" fuerza la relectura del mes
//   visible (y de los bloqueos) y la pantalla muestra a qué hora se leyó.
// - El detalle sale de la misma caché: no hay lecturas por abrir un turno. Del texto de los
//   comentarios se muestra solo la cantidad (cantidadNotas viene en el turno); leerlos
//   costaría una lectura de subcolección por apertura.
// - Sedes y bloqueos se leen una sola vez al arrancar. No se leen médicos: el filtro se arma
//   con los que aparecen en los turnos del mes, igual que en la semana.
//
// Este archivo se carga junto con turnero-motor.js (fechaISO, fechaDesdeISO,
// minutoDesdeString y bloqueoVigenteEnFecha) y nada más: todos sus nombres llevan el sufijo
// "Mensual" para no chocar con los de turnero-carga.js / turnero-grilla.js.

const DIAS_LABEL_MENSUAL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES_LABEL_MENSUAL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const ETIQUETAS_PRIORIDAD_TOOLTIP_MENSUAL = {
  rojo: "Rojo — hay que verlo obligatoriamente",
  amarillo: "Amarillo — trae análisis/consulta corta",
  verde: "Verde — pasa directo a hospital de día"
};
const ETIQUETAS_PRIORIDAD_DETALLE_MENSUAL = { rojo: "🔴 Rojo", amarillo: "🟡 Amarillo", verde: "🟢 Verde" };

let sedesCacheMensual = [];
let bloqueosCacheMensual = [];
let sedeSeleccionadaMensual = null;
let anioVisibleMensual = null;
let mesVisibleMensual = null; // 0 = enero ... 11 = diciembre
let medicoFiltroMensual = null; // null = todos los médicos
let turnosMesMensual = []; // turnos (ubicables en la grilla) del mes y la sede visibles
let leidoEnMesMensual = null;
let rolActualMensual = null;
const cacheMesesMensual = new Map(); // "sede|desde|hasta" -> { turnos, leidoEn }
let versionCargaMensual = 0; // descarta respuestas viejas si se navega más rápido que la red

// Etapa 5C, punto 2.6 — mismo criterio y mismo formato que
// formatearDuracionComprobanteTurno en turnero/comprobante-turno.html, y que
// formatearDuracionDetalleGrilla en turnero-grilla.js (archivo aparte: agenda-mensual.html
// no carga turnero-grilla.js).
function formatearDuracionDetalleMensual(minutos) {
  const total = Number(minutos);
  if (!total || total <= 0) return "-";
  const horas = Math.floor(total / 60);
  const mins = total % 60;
  if (horas === 0) return `${mins} min`;
  if (mins === 0) return `${horas} h`;
  return `${horas} h ${mins} min`;
}

function escaparHtmlMensual(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Fechas del mes ---

function rangoMesMensual(anio, mes) {
  return {
    desde: fechaISO(new Date(anio, mes, 1)),
    hasta: fechaISO(new Date(anio, mes + 1, 0))
  };
}

// Semanas (lunes a sábado) que tocan el mes, como arreglos de 6 posiciones. Cada posición
// es la fecha (Date) si pertenece al mes, o null si es un día de un mes vecino (queda en
// blanco: no se lee ni se dibuja). Los domingos no existen en la agenda, así que una semana
// que solo tendría el domingo dentro del mes no genera fila.
function armarSemanasMesMensual(anio, mes) {
  const ultimoDia = new Date(anio, mes + 1, 0).getDate();
  const semanas = [];
  let semanaActual = null;
  let claveLunesActual = null;

  for (let dia = 1; dia <= ultimoDia; dia++) {
    const fecha = new Date(anio, mes, dia);
    const diaSemana = fecha.getDay(); // 0 = domingo
    if (diaSemana === 0) continue;

    const lunes = new Date(anio, mes, dia - (diaSemana - 1));
    const claveLunes = fechaISO(lunes);
    if (claveLunes !== claveLunesActual) {
      semanaActual = new Array(6).fill(null);
      semanas.push(semanaActual);
      claveLunesActual = claveLunes;
    }
    semanaActual[diaSemana - 1] = fecha;
  }
  return semanas;
}

// --- Parámetros de la URL (sede, médico y fecha vienen de la agenda semanal) ---

function leerParametrosMensual() {
  const params = new URLSearchParams(window.location.search);
  const fecha = params.get("fecha");
  let fechaValida = null;
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const objeto = fechaDesdeISO(fecha);
    if (fechaISO(objeto) === fecha) fechaValida = objeto;
  }
  return { sede: params.get("sede"), medico: params.get("medico"), fecha: fechaValida };
}

// Enlace a la agenda semanal conservando sede y filtro de médico. Con turnoId, la semana
// se abre con el detalle de ese turno ya desplegado (ver iniciarAgenda en turnero-grilla.js).
function urlAgendaSemanaMensual(fechaISOTexto, turnoId) {
  const params = new URLSearchParams();
  params.set("sede", sedeSeleccionadaMensual);
  if (medicoFiltroMensual) params.set("medico", medicoFiltroMensual);
  params.set("fecha", fechaISOTexto);
  if (turnoId) params.set("turno", turnoId);
  return `agenda.html?${params.toString()}`;
}

// Etapa 5, fase 2: enlace a la vista de día de la agenda (agenda.html en modo "Día").
function urlAgendaDiaMensual(fechaISOTexto) {
  return `${urlAgendaSemanaMensual(fechaISOTexto, null)}&vista=dia`;
}

// --- Inicio de la pantalla ---

async function iniciarAgendaMensual(user, datosUsuario) {
  rolActualMensual = datosUsuario.rol;
  const contenedor = document.getElementById("grilla-mensual-contenedor");

  try {
    await Promise.all([cargarSedesMensual(), cargarBloqueosMensual()]);
  } catch (error) {
    console.error("Error al cargar sedes:", error);
    contenedor.innerHTML = `<p style="color:var(--color-danger);padding:20px;">No se pudieron cargar las sedes.</p>`;
    return;
  }

  if (sedesCacheMensual.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--color-muted);padding:20px;">Todavía no hay sedes cargadas. Un administrador puede cargarlas desde "Sedes y sillones".</p>`;
    return;
  }

  const parametros = leerParametrosMensual();
  if (parametros.sede && sedesCacheMensual.some(s => s.id === parametros.sede)) {
    sedeSeleccionadaMensual = parametros.sede;
  } else {
    // Misma sede por defecto que la agenda semanal.
    sedeSeleccionadaMensual = sedesCacheMensual.some(s => s.id === "entre-rios")
      ? "entre-rios"
      : sedesCacheMensual[0].id;
  }
  const fechaInicial = parametros.fecha || new Date();
  anioVisibleMensual = fechaInicial.getFullYear();
  mesVisibleMensual = fechaInicial.getMonth();
  medicoFiltroMensual = parametros.medico || null;

  renderizarSelectorSedeMensual();
  await cargarYRenderizarMensual(false);
}

async function cargarSedesMensual() {
  const snapshot = await db.collection("turneroSedes").get();
  sedesCacheMensual = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  sedesCacheMensual.sort((a, b) => (a.id === "emilio-civit" ? -1 : 1));
}

async function cargarBloqueosMensual() {
  const snapshot = await db.collection("turneroBloqueos").where("activo", "==", true).get();
  bloqueosCacheMensual = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function renderizarSelectorSedeMensual() {
  const contenedor = document.getElementById("selector-sede-mensual");
  contenedor.innerHTML = sedesCacheMensual.map(sede => `
    <button type="button" class="boton-sede-grilla ${sede.id === sedeSeleccionadaMensual ? "activo" : ""}"
      onclick="cambiarSedeMensual('${escaparHtmlMensual(sede.id)}')">${escaparHtmlMensual(sede.nombre)}</button>
  `).join("");
}

// --- Navegación ---

async function cambiarSedeMensual(sedeId) {
  sedeSeleccionadaMensual = sedeId;
  medicoFiltroMensual = null; // el listado de médicos cambia con la sede
  renderizarSelectorSedeMensual();
  await cargarYRenderizarMensual(false);
}

async function cambiarMesMensual(delta) {
  const nuevo = new Date(anioVisibleMensual, mesVisibleMensual + delta, 1);
  anioVisibleMensual = nuevo.getFullYear();
  mesVisibleMensual = nuevo.getMonth();
  await cargarYRenderizarMensual(false);
}

async function irAMesActualMensual() {
  const hoy = new Date();
  anioVisibleMensual = hoy.getFullYear();
  mesVisibleMensual = hoy.getMonth();
  await cargarYRenderizarMensual(false);
}

async function actualizarMesMensual() {
  await cargarYRenderizarMensual(true);
}

// "Ver semana": vuelve a agenda.html en hoy (si el mes visible es el actual) o en el día 1
// del mes visible.
function irASemanaDesdeMesMensual() {
  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anioVisibleMensual && hoy.getMonth() === mesVisibleMensual;
  const fecha = esMesActual ? hoy : new Date(anioVisibleMensual, mesVisibleMensual, 1);
  window.location.href = urlAgendaSemanaMensual(fechaISO(fecha), null);
}

// Etapa 5 — botón "Día" del selector de vista: abre hoy si el mes visible es el actual, o el
// día 1 del mes visible (agenda.html lo lleva al lunes si cae domingo).
function urlDiaDesdeMesMensual() {
  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anioVisibleMensual && hoy.getMonth() === mesVisibleMensual;
  const fecha = esMesActual ? hoy : new Date(anioVisibleMensual, mesVisibleMensual, 1);
  return urlAgendaDiaMensual(fechaISO(fecha));
}

function irADiaDesdeMesMensual() {
  window.location.href = urlDiaDesdeMesMensual();
}

// --- Carga de turnos del mes (con caché en memoria por sede + mes) ---

async function obtenerMesMensual(forzar) {
  const { desde, hasta } = rangoMesMensual(anioVisibleMensual, mesVisibleMensual);
  const clave = `${sedeSeleccionadaMensual}|${desde}|${hasta}`;

  if (!forzar && cacheMesesMensual.has(clave)) return cacheMesesMensual.get(clave);

  const snapshot = await db.collection("turnos")
    .where("sedeId", "==", sedeSeleccionadaMensual)
    .where("estado", "==", "activo")
    .where("fecha", ">=", desde)
    .where("fecha", "<=", hasta)
    .get();

  // Igual que la semana, solo entran los turnos que se pueden ubicar (horarios como
  // texto); los de las primeras etapas, sin esos campos, no se listan ni se cuentan.
  const turnos = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(t => typeof t.horarioInicio === "string" && typeof t.horarioFin === "string");

  const entrada = { turnos, leidoEn: new Date() };
  cacheMesesMensual.set(clave, entrada);
  return entrada;
}

async function cargarYRenderizarMensual(forzar) {
  const contenedor = document.getElementById("grilla-mensual-contenedor");
  const miVersion = ++versionCargaMensual;

  // Solo se muestra "Cargando..." si de verdad hay que ir a la base.
  const { desde, hasta } = rangoMesMensual(anioVisibleMensual, mesVisibleMensual);
  const yaEnCache = cacheMesesMensual.has(`${sedeSeleccionadaMensual}|${desde}|${hasta}`);
  if (forzar || !yaEnCache) {
    contenedor.innerHTML = `<p style="color:var(--color-muted);padding:20px;">Cargando...</p>`;
  }

  try {
    const [entrada] = await Promise.all([
      obtenerMesMensual(forzar),
      forzar ? cargarBloqueosMensual() : Promise.resolve()
    ]);
    if (miVersion !== versionCargaMensual) return;
    turnosMesMensual = entrada.turnos;
    leidoEnMesMensual = entrada.leidoEn;
    poblarFiltroMedicoMensual();
    renderizarMensual();
  } catch (error) {
    if (miVersion !== versionCargaMensual) return;
    console.error("Error al cargar la agenda mensual:", error);
    contenedor.innerHTML = `<p style="color:var(--color-danger);padding:20px;">No se pudo cargar el mes. Reintentá con "Actualizar".</p>`;
  }
}

// --- Filtro por médico ---

function poblarFiltroMedicoMensual() {
  const nombres = Array.from(new Set(
    turnosMesMensual.map(t => t.medicoNombre).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "es"));

  // Si el médico filtrado no aparece en esta sede/mes, se vuelve a "Todos".
  if (medicoFiltroMensual && !nombres.includes(medicoFiltroMensual)) {
    medicoFiltroMensual = null;
  }

  const select = document.getElementById("filtro-medico-mensual");
  select.innerHTML = `<option value="">Todos los médicos</option>` +
    nombres.map(nombre => `<option value="${escaparHtmlMensual(nombre)}" ${nombre === medicoFiltroMensual ? "selected" : ""}>${escaparHtmlMensual(nombre)}</option>`).join("");
}

function cambiarFiltroMedicoMensual(valor) {
  medicoFiltroMensual = valor || null;
  renderizarMensual(); // todo está en caché: no consulta la base
}

// --- Render ---

function apellidoMostradoMensual(turno) {
  const paciente = turno.paciente || {};
  return (paciente.apellido || "").trim() || (paciente.nombre || "").trim() || "Sin paciente";
}

function bloqueosTotalesEnFechaMensual(fechaISOTexto) {
  // Solo los que afectan a TODOS los sillones (día completo o franja): decisión con Elías.
  return bloqueosCacheMensual.filter(b =>
    b.sedeId === sedeSeleccionadaMensual && b.sillon == null && bloqueoVigenteEnFecha(b, fechaISOTexto)
  );
}

function armarTooltipTurnoMensual(turno, sede) {
  const paciente = turno.paciente || {};
  const infoSillon = sede && (sede.sillones || []).find(s => s.numero === turno.sillon);
  const partes = [
    `${paciente.apellido || ""}, ${paciente.nombre || ""}`.trim() || "Sin paciente",
    turno.medicoNombre || "",
    `${turno.horarioInicio}–${turno.horarioFin}`,
    turno.internado
      ? "Internado (no ocupa sillón)"
      : (turno.sillon != null ? `Sillón ${turno.sillon}${infoSillon && infoSillon.tipo === "backup" ? " (backup)" : ""}` : "Sobreturno sin sillón"),
    (turno.ciclo != null || turno.sesion != null) ? `Ciclo ${turno.ciclo ?? "-"} · Sesión ${turno.sesion ?? "-"}` : null,
    paciente.numeroDocumento ? `DNI ${paciente.numeroDocumento}` : null,
    paciente.obraSocial || null,
    turno.reacomodo ? `Sillón reasignado automáticamente (antes: sillón ${turno.reacomodo.sillonAnterior})` : null,
    turno.prioridad ? `Prioridad: ${ETIQUETAS_PRIORIDAD_TOOLTIP_MENSUAL[turno.prioridad] || turno.prioridad}` : null,
    turno.presente === true ? "Paciente presente" : null,
    (turno.cantidadNotas || 0) > 0 ? `Comentarios: ${turno.cantidadNotas}` : null
  ].filter(Boolean);
  return partes.join(" · ");
}

function renderizarLineaTurnoMensual(turno, sede) {
  return `
    <button type="button" class="turno-mensual ${turno.internado ? "internado-mensual" : ""}" data-turno-id="${escaparHtmlMensual(turno.id)}"
      title="${escaparHtmlMensual(armarTooltipTurnoMensual(turno, sede))}"
      onclick="abrirDetalleMensual('${escaparHtmlMensual(turno.id)}')">
      <span class="hora-turno-mensual">${escaparHtmlMensual(turno.horarioInicio)}</span>
      <span class="apellido-turno-mensual">${escaparHtmlMensual(apellidoMostradoMensual(turno))}</span>
    </button>`;
}

function renderizarMarcaBloqueoMensual(bloqueos) {
  if (bloqueos.length === 0) return "";
  const esDiaCompleto = (b) => !(b.horaInicio && b.horaFin);
  const texto = bloqueos.some(esDiaCompleto) ? "Día bloqueado" : "Franja bloqueada";
  const tooltip = bloqueos.map(b =>
    `${b.motivo || "Bloqueo"} · ${esDiaCompleto(b) ? "Todo el horario" : `${b.horaInicio} a ${b.horaFin}`}`
  ).join("\n");
  return `<span class="marca-bloqueo-mensual" title="${escaparHtmlMensual(tooltip)}">${texto}${bloqueos.length > 1 ? ` (${bloqueos.length})` : ""}</span>`;
}

function renderizarDiaMensual(fecha, turnosPorFecha, sede, hoyISO) {
  if (!fecha) return `<div class="dia-mensual fuera"></div>`;

  const fechaTexto = fechaISO(fecha);
  const turnosDelDia = (turnosPorFecha.get(fechaTexto) || []).slice().sort((a, b) => {
    const diferencia = minutoDesdeString(a.horarioInicio) - minutoDesdeString(b.horarioInicio);
    if (diferencia !== 0) return diferencia;
    return apellidoMostradoMensual(a).localeCompare(apellidoMostradoMensual(b), "es");
  });

  // Etapa 5, fase 2: el número del día abre la vista de día (antes abría la semana).
  return `
    <div class="dia-mensual ${fechaTexto === hoyISO ? "hoy" : ""}" data-fecha="${fechaTexto}">
      <a class="encabezado-dia-mensual" href="${escaparHtmlMensual(urlAgendaDiaMensual(fechaTexto))}" title="Ver la agenda de este día">
        <span>${fecha.getDate()}</span>
        ${turnosDelDia.length > 0 ? `<span class="cantidad-dia-mensual" title="${turnosDelDia.length} ${turnosDelDia.length === 1 ? "turno" : "turnos"}">${turnosDelDia.length}</span>` : ""}
      </a>
      ${renderizarMarcaBloqueoMensual(bloqueosTotalesEnFechaMensual(fechaTexto))}
      <div class="lista-turnos-mensual">${turnosDelDia.map(t => renderizarLineaTurnoMensual(t, sede)).join("")}</div>
    </div>`;
}

function renderizarMensual() {
  const sede = sedesCacheMensual.find(s => s.id === sedeSeleccionadaMensual);
  const hoyISO = fechaISO(new Date());

  document.getElementById("etiqueta-mes-mensual").textContent =
    `${MESES_LABEL_MENSUAL[mesVisibleMensual]} ${anioVisibleMensual}`;

  const turnosVisibles = medicoFiltroMensual
    ? turnosMesMensual.filter(t => t.medicoNombre === medicoFiltroMensual)
    : turnosMesMensual;

  const turnosPorFecha = new Map();
  for (const turno of turnosVisibles) {
    if (!turnosPorFecha.has(turno.fecha)) turnosPorFecha.set(turno.fecha, []);
    turnosPorFecha.get(turno.fecha).push(turno);
  }

  const semanas = armarSemanasMesMensual(anioVisibleMensual, mesVisibleMensual);
  const encabezadosHtml = DIAS_LABEL_MENSUAL
    .map(etiqueta => `<div class="encabezado-columna-mensual">${etiqueta}</div>`).join("");
  const diasHtml = semanas
    .map(semana => semana.map(fecha => renderizarDiaMensual(fecha, turnosPorFecha, sede, hoyISO)).join(""))
    .join("");

  document.getElementById("grilla-mensual-contenedor").innerHTML =
    `<div class="grilla-mensual">${encabezadosHtml}${diasHtml}</div>`;

  // La cantidad de turnos va junto al título del mes; la hora de lectura, en el tooltip del ↻
  // (antes ocupaban una línea propia debajo de la barra).
  const hora = leidoEnMesMensual
    ? `${String(leidoEnMesMensual.getHours()).padStart(2, "0")}:${String(leidoEnMesMensual.getMinutes()).padStart(2, "0")}`
    : "-";
  document.getElementById("conteo-mes-mensual").textContent =
    `· ${turnosVisibles.length} ${turnosVisibles.length === 1 ? "turno" : "turnos"}`;
  document.getElementById("boton-actualizar-mensual").title =
    `Datos leídos a las ${hora}. Clic para volver a leer este mes desde la base`;
}

// --- Detalle de solo lectura ---

function abrirDetalleMensual(turnoId) {
  const turno = turnosMesMensual.find(t => t.id === turnoId);
  if (!turno) return;

  const sede = sedesCacheMensual.find(s => s.id === sedeSeleccionadaMensual);
  const infoSillon = sede && (sede.sillones || []).find(s => s.numero === turno.sillon);
  const esBackup = infoSillon && infoSillon.tipo === "backup";
  const paciente = turno.paciente
    ? `${turno.paciente.apellido || ""}, ${turno.paciente.nombre || ""}`.trim()
    : "Sin paciente";

  // Mismas filas y mismo orden que el detalle de la agenda semanal (abrirDetalleTurnoGrilla),
  // más los datos de la Etapa 4 en texto: prioridad, presente y cantidad de comentarios.
  const filas = [
    ["Paciente", paciente],
    ["Sillón", turno.internado
      ? "No aplica (internado)"
      : (turno.sillon != null ? `${turno.sillon}${esBackup ? " (backup)" : ""}` : "Sin asignar (sobreturno)")],
    ["Horario", `${turno.horarioInicio || "-"} – ${turno.horarioFin || "-"}`],
    ["Fecha", turno.fecha || "-"],
    ["Médico", turno.medicoNombre || "-"],
    // Etapa 5C, punto 2.1 — mismo criterio que abrirDetalleTurnoGrilla.
    ...(turno.internado ? [["Internado", "Sí — no ocupa sillón, no imprime comprobante"]] : []),
    // Etapa 5C, punto 2.6 — mismo criterio que abrirDetalleTurnoGrilla: siempre
    // visibles, "-" si falta el dato, sin fila de premedicación (ver ese archivo).
    ["Protocolo(s)", (turno.protocolos || []).map((p) => (p && p.nombre) || p).join(", ") || "-"],
    ["Tiempo estimado", formatearDuracionDetalleMensual(turno.duracionTotalMinutos)]
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
  if (turno.reacomodo) {
    filas.push(["Sillón reasignado", `Automático (antes: sillón ${turno.reacomodo.sillonAnterior})`]);
  }
  filas.push(["Presente", turno.presente === true ? "Sí" : "No"]);
  filas.push(["Prioridad", turno.prioridad ? (ETIQUETAS_PRIORIDAD_DETALLE_MENSUAL[turno.prioridad] || turno.prioridad) : "Sin definir"]);
  const cantidadNotas = turno.cantidadNotas || 0;
  filas.push(["Comentarios", cantidadNotas > 0 ? `${cantidadNotas} (se leen en la semana)` : "Sin comentarios"]);

  const filasHtml = filas.map(([etiqueta, valor]) => `
    <div class="fila-detalle-turno-grilla">
      <span class="etiqueta-detalle-turno-grilla">${escaparHtmlMensual(etiqueta)}</span>
      <span>${escaparHtmlMensual(valor)}</span>
    </div>
  `).join("");

  document.getElementById("contenido-detalle-mensual").innerHTML = `
    <h2 style="margin-top:0;">Detalle del turno</h2>
    ${filasHtml}
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center;">
      <a class="boton-principal" style="width:auto;text-decoration:none;display:inline-block;"
        href="${escaparHtmlMensual(urlAgendaSemanaMensual(turno.fecha, turno.id))}"
        title="Abre la agenda semanal en este turno: desde ahí se puede modificar, reasignar, comentar o reimprimir">Abrir en la semana</a>
    </div>
  `;
  document.getElementById("overlay-detalle-mensual").style.display = "flex";
}

function cerrarDetalleMensual() {
  document.getElementById("overlay-detalle-mensual").style.display = "none";
}

function cerrarDetalleMensualSiFondo(evento) {
  if (evento.target.id === "overlay-detalle-mensual") cerrarDetalleMensual();
}

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const overlay = document.getElementById("overlay-detalle-mensual");
  if (overlay && overlay.style.display !== "none") cerrarDetalleMensual();
});

// --- Menú de cuenta (contraído por defecto: volver a Turnero / cerrar sesión) ---

function alternarMenuCuentaMensual(evento) {
  evento.stopPropagation();
  const panel = document.getElementById("panel-menu-cuenta-mensual");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

document.addEventListener("click", (evento) => {
  const panel = document.getElementById("panel-menu-cuenta-mensual");
  if (!panel || panel.style.display !== "block") return;
  const boton = document.querySelector(".boton-menu-cuenta-grilla");
  if (panel.contains(evento.target) || (boton && boton.contains(evento.target))) return;
  panel.style.display = "none";
});
