// Etapa 5, fase 2 — vista de día de la agenda (modo "Día" dentro de turnero/agenda.html).
//
// Qué es: una lista por hora con TODOS los turnos de un día (una fila por turno, sin dibujar
// la duración) y, a la izquierda, una lateral angosta con un mini calendario solo de
// navegación y, debajo, los controles que en semana/mes están en la barra de arriba (sede,
// médico, "+ Nuevo turno", "Disponibilidad" y el selector de vista Día | Semana | Mes).
// Arriba de la lista van la fecha grande, ‹ Hoy › ↻ y el menú ☰. Cada fila lleva lo mismo
// que la tarjeta semanal (checkbox de presente, borde/etiqueta de prioridad, color de
// presente, badge 💬, ↻ de reacomodo) más horario completo, nombre completo, médico y
// ciclo/sesión. No hay arrastre: cambiar un turno se hace con Reasignar / Modificar /
// Eliminar del detalle, que es el mismo modal de siempre.
//
// Vive en agenda.html (no en una pantalla aparte) porque todos los modales —detalle,
// comentarios, nuevo turno, reasignar, modificar, eliminar— están ahí y se reutilizan tal
// cual: este archivo solo dibuja la lista y le pasa el id del turno a esas funciones.
// Para que funcionen, turnosCacheGrilla se llena con los turnos del día mostrado.
//
// Cómo carga (decisión con Elías: calendario con marca en los días con turnos):
// - Al entrar a un día de un mes que todavía no se leyó: UNA consulta del mes entero
//   (sede + estado activo + rango de fecha, la misma forma que ya usan la semana y la vista
//   mensual). De ahí salen las marcas del calendario, la lista de médicos del filtro y, en
//   esa primera entrada, el propio día (sin consulta extra).
// - El mes queda en memoria (cacheMesesDia). Al pasar a otro día de un mes ya leído, o al
//   volver a un día, el día se relee SOLO (una consulta de ese día) en vez de creerle a la
//   caché: es la vista operativa (presente, comentarios) y los turnos de un día pueden haber
//   cambiado por movimientos hechos en otro lado o por otra persona.
// - Toda acción del día (tildar presente, cambiar prioridad, comentar, guardar/reasignar/
//   modificar/eliminar un turno) termina en cargarYRenderizarGrilla(), que en modo día está
//   desviada a cargarYRenderizarDia(): relee solo el día visible y actualiza ese día en la
//   caché del mes. Nada de esto relee el mes.
// - Las marcas de OTROS días pueden quedar viejas (p. ej. un turno reasignado a mañana);
//   se corrigen al visitar ese día, o con "↻ Actualizar marcas" (relee el mes).
// - Bloqueos y médicos se refrescan al entrar/cambiar de día y con "Actualizar", igual que
//   la semana los refresca al navegar — no en cada acción del día.
//
// Este archivo se carga después de turnero-grilla.js y usa sus globals (modoVistaGrilla,
// sedeSeleccionadaGrilla, medicoFiltroGrilla, turnosCacheGrilla, rolActualGrilla,
// semanaOffsetGrilla, bloqueosCacheGrilla y varias funciones). Todos sus nombres llevan el
// sufijo "Dia" para no chocar con los de turnero-motor.js / turnero-carga.js / turnero-grilla.js.

const MESES_LABEL_DIA = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const DIAS_LABEL_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const INICIALES_DIAS_CALENDARIO_DIA = ["L", "M", "M", "J", "V", "S"];
const ETIQUETAS_PRIORIDAD_DIA = {
  rojo: "Rojo — hay que verlo obligatoriamente",
  amarillo: "Amarillo — trae análisis/consulta corta",
  verde: "Verde — pasa directo a hospital de día"
};
const TEXTO_PRIORIDAD_DIA = { rojo: "Rojo", amarillo: "Amarillo", verde: "Verde" };

let fechaSeleccionadaDia = null; // "YYYY-MM-DD" del día que se está mostrando
let mesCalendarioDia = null;     // { anio, mes } que muestra el mini calendario (mes: 0-11)
const cacheMesesDia = new Map(); // "sede|desde|hasta" -> { turnos, leidoEn }
let turnosDelDiaDia = [];        // turnos del día mostrado (todos los médicos)
let leidoEnDiaDia = null;        // Date de la última lectura del día mostrado
let versionCargaDia = 0;         // descarta respuestas viejas si se navega más rápido que la red

// Controles de la barra superior que en modo día viven en la lateral (o en la cabecera, el
// menú ☰). Se MUEVEN de lugar —son los mismos elementos, con sus ids y sus onclick—; en la
// barra queda un marcador (comentario) para devolverlos exactamente a su sitio.
const CONTROLES_MOVIBLES_DIA = [
  { selector: "#selector-sede-grilla", slot: "slot-sede-dia" },
  { selector: "#filtro-medico-grilla", slot: "slot-medico-dia" },
  { selector: "#boton-nuevo-turno-grilla", slot: "slot-nuevo-turno-dia" },
  { selector: "#boton-consultar-disponibilidad-grilla", slot: "slot-consultar-dia" },
  { selector: ".menu-cuenta-grilla", slot: "slot-menu-cuenta-dia" }
];
const marcadoresControlesDia = new Map(); // selector -> comentario que marca su lugar en la barra

// --- Fechas ---

// La agenda no tiene domingos: un domingo se lleva al lunes siguiente.
function normalizarFechaLaboralDia(fechaTexto) {
  const fecha = fechaDesdeISO(fechaTexto);
  if (fecha.getDay() === 0) fecha.setDate(fecha.getDate() + 1);
  return fechaISO(fecha);
}

// Día anterior/siguiente saltando domingos (sábado → lunes y lunes → sábado).
function sumarDiaLaboralDia(fechaTexto, delta) {
  const fecha = fechaDesdeISO(fechaTexto);
  do { fecha.setDate(fecha.getDate() + delta); } while (fecha.getDay() === 0);
  return fechaISO(fecha);
}

function rangoMesDia(anio, mes) {
  return {
    desde: fechaISO(new Date(anio, mes, 1)),
    hasta: fechaISO(new Date(anio, mes + 1, 0))
  };
}

function claveMesDia(anio, mes) {
  const { desde, hasta } = rangoMesDia(anio, mes);
  return `${sedeSeleccionadaGrilla}|${desde}|${hasta}`;
}

// Semanas (lunes a sábado) que tocan el mes, de 6 posiciones: Date si el día es del mes,
// null si es de un mes vecino (queda en blanco: no se lee ni se dibuja).
function armarSemanasCalendarioDia(anio, mes) {
  const ultimoDia = new Date(anio, mes + 1, 0).getDate();
  const semanas = [];
  let semanaActual = null;
  let claveLunesActual = null;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const fecha = new Date(anio, mes, dia);
    const diaSemana = fecha.getDay();
    if (diaSemana === 0) continue;
    const claveLunes = fechaISO(new Date(anio, mes, dia - (diaSemana - 1)));
    if (claveLunes !== claveLunesActual) {
      semanaActual = new Array(6).fill(null);
      semanas.push(semanaActual);
      claveLunesActual = claveLunes;
    }
    semanaActual[diaSemana - 1] = fecha;
  }
  return semanas;
}

function esTurnoUbicableDia(turno) {
  // Igual que la semana: los turnos sin horarios como texto (etapas viejas) no se listan.
  return typeof turno.horarioInicio === "string" && typeof turno.horarioFin === "string";
}

// --- Lecturas a Firestore ---

async function leerMesDia(anio, mes) {
  const { desde, hasta } = rangoMesDia(anio, mes);
  const snapshot = await db.collection("turnos")
    .where("sedeId", "==", sedeSeleccionadaGrilla)
    .where("estado", "==", "activo")
    .where("fecha", ">=", desde)
    .where("fecha", "<=", hasta)
    .get();
  const entrada = {
    turnos: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(esTurnoUbicableDia),
    leidoEn: new Date()
  };
  cacheMesesDia.set(claveMesDia(anio, mes), entrada);
  return entrada;
}

// Un solo día. Se usa el par >= / <= (y no ==) para que la consulta tenga exactamente la
// misma forma que la del mes y la semana, o sea el mismo índice compuesto ya existente.
async function leerDiaDia(fechaTexto) {
  const snapshot = await db.collection("turnos")
    .where("sedeId", "==", sedeSeleccionadaGrilla)
    .where("estado", "==", "activo")
    .where("fecha", ">=", fechaTexto)
    .where("fecha", "<=", fechaTexto)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(esTurnoUbicableDia);
}

// Deja en la caché del mes la versión recién leída de un día, para que las marcas y el
// filtro de médicos reflejen lo que se acaba de guardar/anular.
function actualizarDiaEnCacheMesDia(fechaTexto, turnosDelDia) {
  const fecha = fechaDesdeISO(fechaTexto);
  const entrada = cacheMesesDia.get(claveMesDia(fecha.getFullYear(), fecha.getMonth()));
  if (!entrada) return;
  entrada.turnos = entrada.turnos.filter(t => t.fecha !== fechaTexto).concat(turnosDelDia);
}

function aplicarDiaLeidoDia(turnosDelDia) {
  turnosDelDiaDia = turnosDelDia;
  turnosCacheGrilla = turnosDelDia; // los modales de la agenda buscan el turno acá
  leidoEnDiaDia = new Date();
}

// --- Cambio de modo semana <-> día ---

function moverControlesDia(haciaLateral) {
  for (const { selector, slot } of CONTROLES_MOVIBLES_DIA) {
    const elemento = document.querySelector(selector);
    if (haciaLateral) {
      if (!elemento || marcadoresControlesDia.has(selector)) continue;
      const marcador = document.createComment(selector);
      elemento.replaceWith(marcador);
      marcadoresControlesDia.set(selector, marcador);
      document.getElementById(slot).appendChild(elemento);
    } else {
      const marcador = marcadoresControlesDia.get(selector);
      if (!marcador || !elemento) continue;
      marcador.replaceWith(elemento);
      marcadoresControlesDia.delete(selector);
    }
  }
}

function mostrarModoDia(activo) {
  modoVistaGrilla = activo ? "dia" : "semana";
  moverControlesDia(activo);
  // Con todos sus controles movidos, la barra superior queda vacía: se oculta entera. La
  // pantalla de día scrollea con la página (la de semana/mes, por dentro; ver .pantalla-grilla).
  document.querySelector(".barra-controles-grilla").style.display = activo ? "none" : "";
  document.querySelector(".contenedor-ancho").classList.toggle("pantalla-grilla", !activo);
  document.querySelector(".grilla-scroll-grilla").style.display = activo ? "none" : "";
  document.getElementById("vista-dia").style.display = activo ? "grid" : "none";
}

// Punto de entrada: encabezado de un día de la semana, número de día del mes, o la URL
// (?vista=dia&fecha=...).
async function abrirVistaDia(fechaTexto) {
  mostrarModoDia(true);
  await cargarDiaCompletoDia(normalizarFechaLaboralDia(fechaTexto));
}

// Carga de un día "de cero" (entrar, cambiar de día, cambiar de sede, Actualizar).
async function cargarDiaCompletoDia(fechaTexto, opciones = {}) {
  const miVersion = ++versionCargaDia;
  const fecha = fechaDesdeISO(fechaTexto);
  fechaSeleccionadaDia = fechaTexto;
  mesCalendarioDia = { anio: fecha.getFullYear(), mes: fecha.getMonth() };

  if (!opciones.silencioso) {
    document.getElementById("panel-dia").innerHTML =
      `<p style="color:var(--color-muted);padding:20px;">Cargando...</p>`;
  }
  renderizarBarraDia();
  renderizarCalendarioDia(); // con lo que haya en caché; si el mes es nuevo, las marcas llegan después

  try {
    const claveMes = claveMesDia(fecha.getFullYear(), fecha.getMonth());
    const leerPrincipal = async () => {
      if (!cacheMesesDia.has(claveMes)) {
        // Mes nuevo: una sola consulta trae el mes; el día sale de ahí sin otra lectura.
        const entrada = await leerMesDia(fecha.getFullYear(), fecha.getMonth());
        return entrada.turnos.filter(t => t.fecha === fechaTexto);
      }
      const turnosDelDia = await leerDiaDia(fechaTexto);
      actualizarDiaEnCacheMesDia(fechaTexto, turnosDelDia);
      return turnosDelDia;
    };
    // Bloqueos y médicos: mismas lecturas chicas que hace la semana al navegar.
    const [, turnosDelDia] = await Promise.all([
      Promise.all([cargarBloqueosGrilla(), cargarMedicosGrilla()]),
      leerPrincipal()
    ]);
    if (miVersion !== versionCargaDia) return;
    aplicarDiaLeidoDia(turnosDelDia);
    poblarFiltroMedicoDia();
    renderizarDia();
  } catch (error) {
    if (miVersion !== versionCargaDia) return;
    console.error("Error al cargar el día:", error);
    document.getElementById("panel-dia").innerHTML =
      `<p style="color:var(--color-danger);padding:20px;">No se pudo cargar el día. Reintentá con "Actualizar".</p>`;
  }
}

// Desvío de cargarYRenderizarGrilla() en modo día (ver turnero-grilla.js): es lo que corre
// después de cada acción sobre un turno. Relee solo el día visible, sin "Cargando..." (para
// que tildar un presente no haga parpadear la lista).
async function cargarYRenderizarDia() {
  if (!fechaSeleccionadaDia) return;
  const miVersion = ++versionCargaDia;
  try {
    const turnosDelDia = await leerDiaDia(fechaSeleccionadaDia);
    if (miVersion !== versionCargaDia) return;
    actualizarDiaEnCacheMesDia(fechaSeleccionadaDia, turnosDelDia);
    aplicarDiaLeidoDia(turnosDelDia);
    poblarFiltroMedicoDia();
    renderizarDia();
  } catch (error) {
    if (miVersion !== versionCargaDia) return;
    console.error("Error al actualizar el día:", error);
    document.getElementById("panel-dia").innerHTML =
      `<p style="color:var(--color-danger);padding:20px;">No se pudo actualizar el día. Reintentá con "Actualizar".</p>`;
  }
}

// --- Navegación ---

async function cambiarDiaDia(delta) {
  await cargarDiaCompletoDia(sumarDiaLaboralDia(fechaSeleccionadaDia, delta));
}

async function irAHoyDia() {
  await cargarDiaCompletoDia(normalizarFechaLaboralDia(fechaISO(new Date())));
}

async function seleccionarDiaDia(fechaTexto) {
  await cargarDiaCompletoDia(fechaTexto);
}

async function actualizarDiaDia() {
  await cargarDiaCompletoDia(fechaSeleccionadaDia, { silencioso: true });
}

// Solo el calendario cambia de mes; el día mostrado no se toca. Leer un mes nuevo es una
// consulta (y queda en caché: volver a un mes ya visto no lee nada).
async function cambiarMesCalendarioDia(delta) {
  const nuevo = new Date(mesCalendarioDia.anio, mesCalendarioDia.mes + delta, 1);
  mesCalendarioDia = { anio: nuevo.getFullYear(), mes: nuevo.getMonth() };
  renderizarCalendarioDia();
  await asegurarMesCalendarioDia();
}

async function asegurarMesCalendarioDia() {
  const { anio, mes } = mesCalendarioDia;
  if (cacheMesesDia.has(claveMesDia(anio, mes))) return;
  const sedeAlPedir = sedeSeleccionadaGrilla;
  try {
    await leerMesDia(anio, mes);
    // Si mientras tanto se cambió de sede o de mes, esta respuesta ya no corresponde.
    if (sedeAlPedir !== sedeSeleccionadaGrilla || mesCalendarioDia.anio !== anio || mesCalendarioDia.mes !== mes) return;
    renderizarCalendarioDia();
  } catch (error) {
    console.error("Error al leer el mes del calendario:", error);
    mostrarMensajeAgenda("No se pudieron leer las marcas de ese mes. Reintentá.", "error");
  }
}

// Vuelve a leer el mes que muestra el calendario (marcas + lista de médicos).
async function actualizarMarcasDia() {
  const { anio, mes } = mesCalendarioDia;
  cacheMesesDia.delete(claveMesDia(anio, mes));
  await asegurarMesCalendarioDia();
  poblarFiltroMedicoDia();
}

async function irASemanaDesdeDiaDia() {
  const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000;
  semanaOffsetGrilla = Math.round(
    (calcularLunesGrilla(fechaDesdeISO(fechaSeleccionadaDia)) - calcularLunesGrilla(new Date())) / MS_POR_SEMANA
  );
  mostrarModoDia(false);
  await cargarYRenderizarGrilla();
}

function irAMesDesdeDiaDia() {
  const params = new URLSearchParams();
  params.set("sede", sedeSeleccionadaGrilla);
  if (medicoFiltroGrilla) params.set("medico", medicoFiltroGrilla);
  params.set("fecha", fechaSeleccionadaDia);
  window.location.href = `agenda-mensual.html?${params.toString()}`;
}

// --- Filtro por médico ---

// En modo día la lista sale de todo el mes leído (no solo del día), para que el filtro no se
// resetee cada vez que se pasa a un día en el que ese médico no atiende.
function poblarFiltroMedicoDia() {
  const fecha = fechaDesdeISO(fechaSeleccionadaDia);
  const entrada = cacheMesesDia.get(claveMesDia(fecha.getFullYear(), fecha.getMonth()));
  const fuente = entrada ? entrada.turnos : turnosDelDiaDia;
  const nombres = Array.from(new Set(fuente.map(t => t.medicoNombre).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "es"));

  if (medicoFiltroGrilla && !nombres.includes(medicoFiltroGrilla)) medicoFiltroGrilla = null;

  const select = document.getElementById("filtro-medico-grilla");
  select.innerHTML = `<option value="">Todos los médicos</option>` +
    nombres.map(nombre => `<option value="${escaparHtmlGrilla(nombre)}" ${nombre === medicoFiltroGrilla ? "selected" : ""}>${escaparHtmlGrilla(nombre)}</option>`).join("");
}

// --- Render ---

function formatearHoraLecturaDia(fecha) {
  return fecha ? `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}` : "-";
}

// Fecha grande de la cabecera: número, día de la semana y mes/año.
function renderizarBarraDia() {
  const fecha = fechaDesdeISO(fechaSeleccionadaDia);
  document.getElementById("numero-dia-dia").textContent = String(fecha.getDate());
  document.getElementById("nombre-dia-dia").textContent = DIAS_LABEL_DIA[fecha.getDay()];
  document.getElementById("mes-dia-dia").textContent = `${MESES_LABEL_DIA[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

function renderizarDia() {
  renderizarBarraDia();
  renderizarCalendarioDia();
  renderizarPanelDia();
}

function renderizarCalendarioDia() {
  const { anio, mes } = mesCalendarioDia;
  const entrada = cacheMesesDia.get(claveMesDia(anio, mes));
  const hoyISO = fechaISO(new Date());

  // Marcas: cantidad de turnos por fecha, respetando el filtro de médico vigente.
  const cantidadPorFecha = new Map();
  if (entrada) {
    for (const turno of entrada.turnos) {
      if (medicoFiltroGrilla && turno.medicoNombre !== medicoFiltroGrilla) continue;
      cantidadPorFecha.set(turno.fecha, (cantidadPorFecha.get(turno.fecha) || 0) + 1);
    }
  }

  const encabezadosHtml = INICIALES_DIAS_CALENDARIO_DIA
    .map(inicial => `<span class="inicial-calendario-dia">${inicial}</span>`).join("");
  const celdasHtml = armarSemanasCalendarioDia(anio, mes).map(semana => semana.map(fecha => {
    if (!fecha) return `<span class="celda-calendario-dia vacia"></span>`;
    const fechaTexto = fechaISO(fecha);
    const cantidad = cantidadPorFecha.get(fechaTexto) || 0;
    const clases = [
      "celda-calendario-dia",
      fechaTexto === fechaSeleccionadaDia ? "seleccionado" : "",
      fechaTexto === hoyISO ? "hoy" : "",
      cantidad > 0 ? "con-turnos" : ""
    ].filter(Boolean).join(" ");
    const titulo = cantidad > 0 ? `${cantidad} ${cantidad === 1 ? "turno" : "turnos"}` : "Sin turnos";
    return `<button type="button" class="${clases}" data-fecha="${fechaTexto}" title="${titulo}"
      onclick="seleccionarDiaDia('${fechaTexto}')">${fecha.getDate()}</button>`;
  }).join("")).join("");

  document.getElementById("calendario-dia").innerHTML = `
    <div class="encabezado-calendario-dia">
      <button type="button" onclick="cambiarMesCalendarioDia(-1)" title="Mes anterior">‹</button>
      <span>${MESES_LABEL_DIA[mes]} ${anio}</span>
      <button type="button" onclick="cambiarMesCalendarioDia(1)" title="Mes siguiente">›</button>
    </div>
    <div class="grilla-calendario-dia">${encabezadosHtml}${celdasHtml}</div>
    <div class="pie-calendario-dia">
      <button type="button" class="enlace-accion" onclick="actualizarMarcasDia()" title="Volver a leer este mes para actualizar las marcas y los médicos">↻ Actualizar marcas</button>
      <span>${entrada ? `leídas a las ${formatearHoraLecturaDia(entrada.leidoEn)}` : "cargando…"}</span>
    </div>
  `;
}

function renderizarPanelDia() {
  const sede = sedesCacheGrilla.find(s => s.id === sedeSeleccionadaGrilla);
  const turnosVisibles = (medicoFiltroGrilla
    ? turnosDelDiaDia.filter(t => t.medicoNombre === medicoFiltroGrilla)
    : turnosDelDiaDia
  ).slice().sort((a, b) => {
    const porHora = minutoDesdeString(a.horarioInicio) - minutoDesdeString(b.horarioInicio);
    if (porHora !== 0) return porHora;
    const porSillon = (a.sillon ?? 999) - (b.sillon ?? 999);
    if (porSillon !== 0) return porSillon;
    return apellidoOrdenDia(a).localeCompare(apellidoOrdenDia(b), "es");
  });

  const presentes = turnosVisibles.filter(t => t.presente === true).length;
  const resumen = `${turnosVisibles.length} ${turnosVisibles.length === 1 ? "turno" : "turnos"}` +
    ` · ${presentes} ${presentes === 1 ? "presente" : "presentes"}` +
    ` · datos leídos a las ${formatearHoraLecturaDia(leidoEnDiaDia)}`;

  const bloqueosHtml = bloqueosVigentesEnFechaGrilla(fechaSeleccionadaDia).map(b => {
    const donde = b.sillon == null ? "todos los sillones" : `sillón ${b.sillon}`;
    const franja = (b.horaInicio && b.horaFin) ? `${b.horaInicio} a ${b.horaFin}` : "todo el horario";
    return `<button type="button" class="chip-bloqueo-dia" title="Ver el detalle del bloqueo"
      onclick="abrirDetalleBloqueoGrilla('${escaparHtmlGrilla(b.id)}')">Bloqueado: ${escaparHtmlGrilla(b.motivo || "sin motivo")} · ${donde} · ${franja}</button>`;
  }).join("");

  const listaHtml = turnosVisibles.length === 0
    ? `<p class="vacio-dia">${medicoFiltroGrilla ? "Este médico no tiene turnos cargados este día." : "No hay turnos cargados este día."}</p>`
    : `<div class="lista-turnos-dia">
        <div class="fila-turno-dia encabezado-lista-dia">
          <span title="Paciente presente">✓</span><span>Horario</span><span>Sillón</span><span>Paciente</span><span>Médico</span><span>Ciclo / Sesión</span><span></span>
        </div>
        ${turnosVisibles.map(t => renderizarFilaTurnoDia(t, sede)).join("")}
      </div>`;

  document.getElementById("panel-dia").innerHTML = `
    <div class="resumen-dia">${resumen}</div>
    ${bloqueosHtml ? `<div class="bloqueos-dia">${bloqueosHtml}</div>` : ""}
    ${listaHtml}
  `;
}

function apellidoOrdenDia(turno) {
  const paciente = turno.paciente || {};
  return `${paciente.apellido || ""} ${paciente.nombre || ""}`.trim();
}

function renderizarFilaTurnoDia(turno, sede) {
  const paciente = turno.paciente || {};
  const pacienteCompleto = `${paciente.apellido || ""}, ${paciente.nombre || ""}`.trim().replace(/^,\s*/, "").replace(/,\s*$/, "") || "Sin paciente";
  const infoSillon = (sede && sede.sillones || []).find(s => s.numero === turno.sillon);
  const esBackup = !!infoSillon && infoSillon.tipo === "backup";
  // Etapa 5C, ajuste del 2.1: un internado ya no aparece como "S?" (sobreturno) — "Int."
  // con su óvalo propio, mismo criterio que la tarjeta semanal.
  const textoSillon = turno.internado ? "Int." : (turno.sillon != null ? `S${turno.sillon}` : "S?");
  const estaPresente = turno.presente === true;
  const prioridad = turno.prioridad || null;
  const cantidadNotas = turno.cantidadNotas || 0;

  // Mismo criterio de rol y de ventana que el checkbox de la tarjeta semanal: tildan solo
  // enfermería y administrador, y no después de que pasó el día del turno (bloqueo solo de
  // interfaz, ya documentado en la Etapa 4). Los demás roles ven la marca, sin control.
  const puedeMarcarPresente = rolActualGrilla === "administrador" || rolActualGrilla === "enfermeria";
  const puedeEditarPresente = puedeMarcarPresente && turno.fecha >= fechaLocalHoy();
  const celdaPresenteHtml = puedeMarcarPresente
    ? `<label class="celda-presente-dia" onclick="event.stopPropagation()">
         <input type="checkbox" class="checkbox-presente-dia" ${estaPresente ? "checked" : ""} ${puedeEditarPresente ? "" : "disabled"}
           title="${puedeEditarPresente ? "Paciente presente" : "Paciente presente (no editable: ya pasó el día del turno)"}"
           onclick="event.stopPropagation(); alternarPresenteTurnoGrilla('${escaparHtmlGrilla(turno.id)}', this.checked)" />
       </label>`
    : `<span class="celda-presente-dia" title="${estaPresente ? "Paciente presente" : ""}">${estaPresente ? "✓" : ""}</span>`;

  const tooltip = [
    pacienteCompleto,
    turno.medicoNombre || "",
    `${turno.horarioInicio}–${turno.horarioFin}`,
    (turno.ciclo != null || turno.sesion != null) ? `Ciclo ${turno.ciclo ?? "-"} · Sesión ${turno.sesion ?? "-"}` : null,
    paciente.numeroDocumento ? `DNI ${paciente.numeroDocumento}` : null,
    paciente.obraSocial || null,
    turno.reacomodo ? `Sillón reasignado automáticamente (antes: sillón ${turno.reacomodo.sillonAnterior})` : null,
    turno.internado ? "Internado (no ocupa sillón)" : null,
    turno.horarioManual === true ? "Cargado con horario manual (no se reacomoda)" : null,
    prioridad ? `Prioridad: ${ETIQUETAS_PRIORIDAD_DIA[prioridad] || prioridad}` : null
  ].filter(Boolean).join(" · ");

  // La etiqueta de texto junto al color es a propósito: rojo y verde solos no se distinguen
  // para todas las personas.
  const prioridadHtml = prioridad
    ? `<span class="etiqueta-prioridad-dia prioridad-${escaparHtmlGrilla(prioridad)}" title="${escaparHtmlGrilla(ETIQUETAS_PRIORIDAD_DIA[prioridad] || prioridad)}">● ${escaparHtmlGrilla(TEXTO_PRIORIDAD_DIA[prioridad] || prioridad)}</span>`
    : "";
  const reacomodoHtml = turno.reacomodo
    ? `<span class="badge-reacomodo-grilla" title="Sillón reasignado automáticamente (antes: sillón ${escaparHtmlGrilla(turno.reacomodo.sillonAnterior)})">↻</span>`
    : "";
  // Etapa 5C (decisión de Elías): la marca de horario manual se ve SOLO en la vista
  // diaria — en la tarjeta semanal ya no entra nada más.
  const horarioManualHtml = turno.horarioManual === true
    ? `<span class="badge-horario-manual-dia" title="Cargado con horario manual (no se reacomoda de sillón)">⏱</span>`
    : "";
  const notasHtml = `<button type="button" class="boton-notas-dia" title="${cantidadNotas > 0 ? `Comentarios (${cantidadNotas})` : "Agregar un comentario"}"
      onclick="event.stopPropagation(); abrirNotasTurnoGrilla('${escaparHtmlGrilla(turno.id)}')">💬${cantidadNotas > 0 ? cantidadNotas : ""}</button>`;

  const cicloSesion = (turno.ciclo != null || turno.sesion != null)
    ? `Ciclo ${turno.ciclo ?? "-"} · Ses. ${turno.sesion ?? "-"}`
    : "—";

  return `
    <div class="fila-turno-dia ${estaPresente ? "presente-dia" : ""} ${prioridad ? `borde-prioridad-${escaparHtmlGrilla(prioridad)}-dia` : ""}"
      data-turno-id="${escaparHtmlGrilla(turno.id)}" title="${escaparHtmlGrilla(tooltip)}"
      onclick="abrirDetalleTurnoGrilla('${escaparHtmlGrilla(turno.id)}')">
      ${celdaPresenteHtml}
      <span class="horario-dia">${escaparHtmlGrilla(turno.horarioInicio)}–${escaparHtmlGrilla(turno.horarioFin)}</span>
      <span><span class="badge-sillon-grilla ${esBackup ? "backup" : ""} ${turno.internado ? "internado" : ""}">${textoSillon}</span></span>
      <span class="paciente-dia">${escaparHtmlGrilla(pacienteCompleto)}</span>
      <span class="medico-dia">${escaparHtmlGrilla(turno.medicoNombre || "-")}</span>
      <span class="ciclo-dia">${escaparHtmlGrilla(cicloSesion)}</span>
      <span class="indicadores-dia">${prioridadHtml}${reacomodoHtml}${horarioManualHtml}${notasHtml}</span>
    </div>`;
}
