// Motor de búsqueda de huecos — Etapas T3 (disponibilidad física) y T4 (reglas de médico)
// del Módulo de Turnero.
//
// T3: validación de no superposición, cálculo continuo con bloques normalizados (5 minutos
// internamente), algoritmo de mejor ajuste, respeto de horarios por sede, sede automática
// de Occhipinti según obra social.
//
// T4 (nuevo): atadura de día y cupo por porcentaje del médico tratante. Ninguna de las dos
// reglas está fija en el código — ambas dependen de flags por sede (`usaAtaduraDia` y
// `usaCuposPorcentaje` en turneroSedes), igual criterio que ya se usó para cupos en T0.
// Hoy están activadas solo en Emilio Civit, pero se pueden activar en cualquier sede desde
// la pantalla "Sedes y sillones" sin tocar código. No aplican al médico "Otro" (eso es T5).
//
// Este archivo es completamente independiente de turnero-carga.js. Se integra en el
// formulario desde T3 en adelante, pero mantiene su propia lógica para facilitar
// testeo y reutilización.

const GRANO_MINUTOS = 5; // Grano interno de búsqueda de huecos
const TOPE_DIAS_BUSQUEDA = 10; // Máximo de días a buscar más allá de la fecha solicitada
const SEDE_OCCHIPINTI = "occhipinti";
const OBRA_SOCIAL_POP = "POP - ASOC. COOP HOSP CENTRAL PROG.ESPECIALES";
// Sobreturno: una única acción manual y deliberada (nunca una elección entre variantes —
// el motor ya intentó automáticamente todo lo que podía respetando disponibilidad, atadura
// y cupo; el sobreturno es lo que se ofrece recién cuando eso se agotó). tipoSobreturno
// guarda POR QUÉ hizo falta, no quién lo cargó, para que el reporte de la Etapa T11 pueda
// distinguir causas:
const TIPO_SOBRETURNO_SIN_DISPONIBILIDAD = "sinDisponibilidadFisica"; // no había sillón en 10 días
const TIPO_SOBRETURNO_CUPO = "cupoExcedido"; // había sillón, pero excedía el cupo del médico
const TIPO_SOBRETURNO_ATADURA = "ataduraDia"; // había sillón, pero el médico no atiende ese día ahí
// Ronda "mejoras motor" (post T12): franja horaria por médico — había sillón, pero fuera
// del rango horario configurado para ese médico (campo franjaHoraria en turneroMedicos).
const TIPO_SOBRETURNO_FRANJA = "franjaHoraria";

// --- Estructura de retorno del motor ---
// {
//   exito: bool,
//   huecosEncontrados?: [ // array de huecos válidos, ordenados por mejor ajuste
//     {
//       sedeId, sedeNombre, fecha (ISO), fechaLegible, horaInicio, horaFin,
//       minutoInicioBloqueNormalizado, duracionMinutos, sillon,
//       tiempoDesaprovechadoMinutos, superaTolerancia
//     },
//     ...
//   ],
//   sinHuecosMotivo?: string, // si exito === false, explicación
//   sedesIntentadas?: [string],
//   diasBuscados?: number,
//   bloqueoCupo?: { // T4: solo si la razón de no encontrar hueco es el cupo del médico
//                   // en la fecha originalmente solicitada (no disponibilidad física)
//     tipo: "bloqueoTotal" | "confirmable",
//     medicoId, porcentaje, sedeNombre, fechaLegible,
//     minutosUsados?, techoMinutos?, // solo si tipo === "confirmable"
//     huecoDisponible?: { sedeId, sedeNombre, fecha, fechaLegible, horaInicio, horaFin }
//     // huecoDisponible solo si tipo === "confirmable": el bloque físico real que existía,
//     // para poder cargarlo como sobreturno (tipoSobreturno: "cupoExcedido") si se confirma.
//   },
//   bloqueoAtadura?: { // T4 (31/8): igual que bloqueoCupo, pero la causa es que el médico
//                      // no atiende ese día en esa sede (había sillón físico libre).
//                      // A diferencia del cupo, el motor NO sigue buscando otros días
//                      // solo cuando la causa es esta — se corta en el día pedido.
//     tipo: "bloqueoTotal" | "confirmable",
//     medicoId, sedeNombre, fechaLegible,
//     nombreDiaSolicitado, // "lunes", etc. — para el mensaje específico del rol médico
//     diasAtencionMedico, // ["jueves", "viernes"] — días que sí le corresponden en esta sede
//     huecoDisponible?: { sedeId, sedeNombre, fecha, fechaLegible, horaInicio, horaFin }
//     // huecoDisponible solo si tipo === "confirmable", para cargarlo como sobreturno
//     // (tipoSobreturno: "ataduraDia") si se confirma.
//   }
// }

// --- Helpers de tiempo ---

function minutoDesdeString(horaStr) {
  // Convierte "14:30" a minutos desde las 00:00
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
}

function stringDesdeMinuto(minuto) {
  // Convierte minutos desde 00:00 a "14:30"
  const h = Math.floor(minuto / 60);
  const m = minuto % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fechaDesdeISO(isoString) {
  // Parsea "2026-09-08" a objeto Date (medianoche, zona local)
  const [y, m, d] = isoString.split("-").map(Number);
  const fecha = new Date(y, m - 1, d, 0, 0, 0, 0);
  return fecha;
}

function fechaISO(objetoDate) {
  // Convierte objeto Date a "2026-09-08"
  const y = objetoDate.getFullYear();
  const m = String(objetoDate.getMonth() + 1).padStart(2, "0");
  const d = String(objetoDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatearFechaLegibleMotor(fechaObjeto) {
  // "martes 8 de septiembre de 2026"
  const formateador = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  const texto = formateador.format(fechaObjeto);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// --- Determinación de sedes a buscar (lógica de Occhipinti) ---

async function determinarSedesABuscar(medicoId, obraSocial, medicosCacheLectura) {
  // Retorna array de sedeIds en el orden en que deben buscarse.
  // Para Occhipinti: lógica según obra social (Handoff_etapa_T0.md, decisión 4).
  // - POP → únicamente Emilio Civit, sin opción de Entre Ríos.
  // - Cualquier otra obra social → busca primero en Entre Ríos, solo si no hay
  //   hueco ahí busca en Emilio Civit (nunca al revés, nunca en paralelo).
  // Esto es independiente de las limitaciones por médico (atadura de día, cupo por
  // porcentaje) de T4, que dependen de flags por sede, no de este médico en particular.
  // Para otros médicos: la(s) sede(s) donde atiende, sin esta lógica especial.

  if (medicoId === SEDE_OCCHIPINTI) {
    if (obraSocial === OBRA_SOCIAL_POP) {
      return ["emilio-civit"];
    }
    return ["entre-rios", "emilio-civit"];
  }

  // Para otros médicos: leer sus sedes del caché y retornarlas en el orden
  // que tienen en el catálogo (Entre Ríos primero por convención)
  const medicoDoc = medicosCacheLectura.find(m => m.id === medicoId);
  if (!medicoDoc) {
    // Médico no encontrado: retornar ambas sedes como fallback
    console.warn(`Médico ${medicoId} no encontrado en caché. Buscando en ambas sedes.`);
    return ["entre-rios", "emilio-civit"];
  }

  const sedesDelMedico = [];
  if (medicoDoc.diasPorSede["Entre Ríos"] && medicoDoc.diasPorSede["Entre Ríos"].length > 0) {
    sedesDelMedico.push("entre-rios");
  }
  if (medicoDoc.diasPorSede["Emilio Civit"] && medicoDoc.diasPorSede["Emilio Civit"].length > 0) {
    sedesDelMedico.push("emilio-civit");
  }

  return sedesDelMedico.length > 0 ? sedesDelMedico : ["entre-rios", "emilio-civit"];
}

// --- Helper T4: primer hueco físico posible ese día, ignorando el cupo ---
// Se usa únicamente para poder ofrecer "cargar como sobreturno este día" cuando el cupo
// del médico bloquea la fecha originalmente solicitada pero sí había sillón disponible.
// No calcula mejor ajuste (no hace falta: es un candidato de respaldo, no una oferta normal).

function encontrarPrimerHuecoFisico(horaAperturaMinutos, horaCierreMinutos, duracionNormalizada, sillonesDisponibles, turnosDelDia) {
  for (let minutoActual = horaAperturaMinutos; minutoActual + duracionNormalizada <= horaCierreMinutos; minutoActual += GRANO_MINUTOS) {
    for (const sillon of sillonesDisponibles) {
      const tieneConflicto = turnosDelDia.some(turno => {
        if (turno.sillon !== sillon) return false;
        const minutoInicio = minutoDesdeString(turno.horarioInicio);
        const minutoFin = minutoDesdeString(turno.horarioFin);
        return minutoActual < minutoFin && minutoActual + duracionNormalizada > minutoInicio;
      });
      if (!tieneConflicto) {
        return { horaInicio: stringDesdeMinuto(minutoActual), horaFin: stringDesdeMinuto(minutoActual + duracionNormalizada), sillon };
      }
    }
  }
  return null;
}

// --- Regla nueva (post-Fase 3, feedback de Elías): un mismo paciente no puede tener
// más de un turno activo el mismo día, en ninguna de las dos sedes. Bloqueo total, sin
// excepción de rol (a diferencia de atadura/cupo, acá no hay variante "confirmable" para
// enfermería/administrador). Se calcula una sola vez por búsqueda, con la lista COMPLETA
// de turnos (todas las sedes, no la ya filtrada por sede que usa el resto del motor) —
// por eso es un parámetro aparte en vez de derivarse de turnosExistentesEnSede.
function diasBloqueadosPorPaciente(pacienteId, turnosExistentesTodasSedes, turnoIdExcluir) {
  const fechas = new Set();
  if (!pacienteId) return fechas;
  for (const turno of (turnosExistentesTodasSedes || [])) {
    if (turnoIdExcluir && turno.id === turnoIdExcluir) continue; // el propio turno arrastrado, si aplica
    if (turno.paciente && turno.paciente.id === pacienteId && typeof turno.fecha === "string") {
      fechas.add(turno.fecha);
    }
  }
  return fechas;
}

// --- Etapa T9, Fase 2: bloqueos administrativos ---
//
// Un bloqueo nunca se trata como un caso especial dentro del loop físico de
// evaluarDiaEnSede: se lo convierte en una o más entradas con la misma forma mínima que
// ya usan turnosDelDia/turnosDelDiaEnSede en todo este archivo (sillon, horarioInicio,
// horarioFin) y se las suma a esa lista ANTES de que el loop corra. Para el loop de
// conflictos, encontrarPrimerHuecoFisico() y calcularBloqueSobreturno(), un bloqueo es
// indistinguible de un turno real ya ocupando ese sillón en esa franja — así que el
// orden "primero decide el horario, después el sillón" y el cálculo de "mejor ajuste"
// (que mira el próximo evento en el mismo sillón) siguen funcionando sin ningún cambio,
// tanto para bloqueos como para lo que ya existía.
//
// A propósito, estas entradas jamás se agregan a turnosExistentesEnSede (la lista cruda
// que usa el cupo por porcentaje y la atadura de día para sumar minutos por médico) —
// solo se mezclan en turnosDelDia/turnosDelDiaEnSede. Un bloqueo no tiene medicoId, así
// que si por error terminara en ese cálculo no rompería nada por sí solo, pero para no
// depender de esa casualidad, nunca se lo mezcla ahí.
function bloqueoVigenteEnFecha(bloqueo, fechaActualISO) {
  if (bloqueo.tipo === "recurrente") {
    const diasEnEspanol = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const nombreDiaActual = diasEnEspanol[fechaDesdeISO(fechaActualISO).getDay()];
    return bloqueo.diaSemana === nombreDiaActual &&
      !(bloqueo.fechasExceptuadas || []).includes(fechaActualISO);
  }
  return fechaActualISO >= bloqueo.fechaInicio && fechaActualISO <= bloqueo.fechaFin;
}

function pseudoTurnosBloqueoEnFecha(bloqueosCacheLectura, sedeId, fechaActualISO, sillonesDisponibles, horaAperturaString, horaCierreString) {
  const pseudoTurnos = [];
  for (const bloqueo of (bloqueosCacheLectura || [])) {
    if (bloqueo.activo === false) continue; // defensivo: lo normal es que ya venga filtrado
    if (bloqueo.sedeId !== sedeId) continue;
    if (!bloqueoVigenteEnFecha(bloqueo, fechaActualISO)) continue;

    const horarioInicio = bloqueo.horaInicio || horaAperturaString;
    const horarioFin = bloqueo.horaFin || horaCierreString;
    const sillonesAfectados = bloqueo.sillon != null ? [bloqueo.sillon] : sillonesDisponibles;

    for (const sillon of sillonesAfectados) {
      pseudoTurnos.push({ sillon, horarioInicio, horarioFin, esBloqueo: true, motivoBloqueo: bloqueo.motivo });
    }
  }
  return pseudoTurnos;
}

// --- Evaluación de un solo día (T6 Fase 3: extraído de buscarHuecosEnSede) ---
//
// Contiene, sin cambios de comportamiento respecto de la versión anterior, la atadura
// de día, el cupo por porcentaje, y el barrido de bloques con mejor ajuste — todo lo
// que hace falta para saber si UN día puntual tiene huecos válidos. No decide qué
// hacer con el resultado (no hace `return` ni `continue` de ningún loop externo): eso
// queda en cada función que llama a esta, porque cada una necesita un control de flujo
// distinto (buscarHuecosEnSede corta en la atadura del día pedido y para en el primer
// día con huecos; buscarHuecosSemanaEnSede evalúa todos los días sin cortar nunca).
//
// Recibe un único objeto (en vez de la lista larga de parámetros posicionales que usa
// el resto del archivo) porque son 15 datos distintos — con parámetros posicionales el
// riesgo de invertir dos por error sin que ningún error de sintaxis lo delate es alto,
// y ya tuvimos ese tipo de bug silencioso antes (duracionMinutos vs duracionTotalMinutos
// en T3). Es una función interna, no la llama nada fuera de este archivo.
function evaluarDiaEnSede({
  sedeId, sedeNombre, fechaActual, fechaActualISO, nombreDiaActual,
  horaAperturaMinutos, horaCierreMinutos, duracionMinutos, duracionNormalizada,
  turnosDelDia, turnosExistentesEnSede, sillonesDisponibles,
  medicoId, medicoDoc, usaAtaduraDia, usaCuposPorcentaje, cuposCacheLectura,
  diasBloqueadosPaciente, // Set de fechas ISO donde el paciente ya tiene otro turno (o undefined/vacío)
  capturarCandidato // bool: true solo cuando corresponde buscar el candidato físico de
                     // respaldo para ofrecer como sobreturno (diasDesde === 0 en la
                     // búsqueda secuencial); la búsqueda semanal siempre pasa false,
                     // no ofrece sobreturno por ahora.
}) {
  // Retorna:
  // {
  //   bloqueadoPorPaciente: bool,           // el paciente ya tiene otro turno ese día (cualquier sede)
  //   bloqueadoPorAtadura: bool,
  //   candidatoAtadura: {...} | null,      // solo si bloqueadoPorAtadura && capturarCandidato
  //   nombreDiaSolicitado, diasAtencionMedico, // metadata de atadura, solo si bloqueadoPorAtadura
  //   bloqueadoPorCupo: bool,
  //   candidatoCupo: {...} | null,         // solo si bloqueadoPorCupo && capturarCandidato
  //   huecos: [...]                        // vacío si bloqueado por paciente, atadura o cupo;
  //                                         // si no, huecos físicos válidos de ese día
  //                                         // (sin ordenar todavía — ordenar por mejor
  //                                         // ajuste queda a cargo de quien llama)
  // }

  // El bloqueo por paciente es el más básico de los tres: si el paciente ya tiene otro
  // turno ese día, no importa qué médico o qué cupo esté en juego, el día no sirve.
  // Nunca hay candidato de sobreturno para esto — es bloqueo total, sin excepción de rol.
  if (diasBloqueadosPaciente && diasBloqueadosPaciente.has(fechaActualISO)) {
    return {
      bloqueadoPorPaciente: true,
      bloqueadoPorAtadura: false, candidatoAtadura: null,
      bloqueadoPorCupo: false, candidatoCupo: null,
      bloqueadoPorFranja: false, candidatoFranja: null,
      huecos: []
    };
  }

  // --- T4: atadura de día del médico tratante ---
  // Si la sede tiene activada la atadura (usaAtaduraDia) y el médico es uno con ficha
  // propia (no "Otro" — eso es T5), se exige que atienda ESE día puntual en ESTA sede,
  // según turneroMedicos.diasPorSede.
  if (usaAtaduraDia && medicoDoc) {
    const diasDelMedicoEnSede = (medicoDoc.diasPorSede && medicoDoc.diasPorSede[sedeNombre]) || [];
    if (!diasDelMedicoEnSede.includes(nombreDiaActual)) {
      let candidatoAtadura = null;
      if (capturarCandidato) {
        const probeHueco = encontrarPrimerHuecoFisico(
          horaAperturaMinutos, horaCierreMinutos, duracionNormalizada, sillonesDisponibles, turnosDelDia
        );
        if (probeHueco) {
          candidatoAtadura = {
            sedeId, sedeNombre, fecha: fechaActualISO,
            fechaLegible: formatearFechaLegibleMotor(fechaActual),
            horaInicio: probeHueco.horaInicio, horaFin: probeHueco.horaFin, medicoId,
            nombreDiaSolicitado: nombreDiaActual,
            diasAtencionMedico: diasDelMedicoEnSede
          };
        }
      }
      return {
        bloqueadoPorPaciente: false,
        bloqueadoPorAtadura: true, candidatoAtadura,
        nombreDiaSolicitado: nombreDiaActual, diasAtencionMedico: diasDelMedicoEnSede,
        bloqueadoPorCupo: false, candidatoCupo: null,
        bloqueadoPorFranja: false, candidatoFranja: null,
        huecos: []
      };
    }
  }

  // --- T4: cupo por porcentaje del médico tratante ---
  // Igual que la atadura, depende de un flag por sede (usaCuposPorcentaje) y no aplica
  // a "Otro" (sin medicoDoc). El techo se calcula sobre el tiempo TOTAL de sillones de
  // ese día en esa sede (regular + backup), no sobre un sillón puntual — así lo define
  // el punto 9 del alcance, confirmado con Elías. Si la sede tiene el cupo activo pero
  // no hay un porcentaje cargado para este médico ese día, no se aplica tope (se avisa
  // por consola para poder detectar el catálogo incompleto).
  if (usaCuposPorcentaje && medicoDoc) {
    const cupoDoc = (cuposCacheLectura || []).find(c => c.sedeId === sedeId && c.dia === nombreDiaActual);
    const porcentaje = cupoDoc && cupoDoc.cupos && cupoDoc.cupos[medicoId] != null ? cupoDoc.cupos[medicoId] : null;

    if (porcentaje != null) {
      const totalMinutosSede = (horaCierreMinutos - horaAperturaMinutos) * sillonesDisponibles.length;
      const techoMinutos = totalMinutosSede * porcentaje / 100;
      const minutosUsadosMedico = turnosExistentesEnSede
        .filter(t => t.medicoId === medicoId && t.fecha === fechaActualISO)
        .reduce((acc, t) => acc + (Number(t.duracionTotalMinutos) || 0), 0);

      if (minutosUsadosMedico + duracionMinutos > techoMinutos) {
        let candidatoCupo = null;
        if (capturarCandidato) {
          const probeHueco = encontrarPrimerHuecoFisico(
            horaAperturaMinutos, horaCierreMinutos, duracionNormalizada, sillonesDisponibles, turnosDelDia
          );
          if (probeHueco) {
            candidatoCupo = {
              sedeId, sedeNombre, fecha: fechaActualISO,
              fechaLegible: formatearFechaLegibleMotor(fechaActual),
              horaInicio: probeHueco.horaInicio, horaFin: probeHueco.horaFin, medicoId,
              porcentaje, minutosUsados: minutosUsadosMedico, techoMinutos
            };
          }
        }
        return {
          bloqueadoPorPaciente: false,
          bloqueadoPorAtadura: false, candidatoAtadura: null,
          bloqueadoPorCupo: true, candidatoCupo,
          bloqueadoPorFranja: false, candidatoFranja: null,
          huecos: []
        };
      }
    } else {
      console.warn(`Cupo activo en ${sedeNombre} pero sin porcentaje configurado para "${medicoId}" el ${nombreDiaActual}. No se aplica tope ese día.`);
    }
  }

  // --- Ronda "mejoras motor": franja horaria por médico ---
  // A diferencia de la atadura (corta la búsqueda entera de ese día) y siguiendo el
  // mismo criterio que el cupo (nunca corta, solo acota), si el médico tiene un rango
  // horario propio configurado (franjaHoraria en turneroMedicos), la búsqueda de ESTE
  // día se acota a la intersección entre el horario de la sede y esa franja. Si dentro
  // de esa ventana angosta no hay hueco, el día completo se descarta (bloqueadoPorFranja)
  // y quien llama sigue probando los próximos días — no aplica a "Otro" (sin medicoDoc).
  let horaAperturaBusqueda = horaAperturaMinutos;
  let horaCierreBusqueda = horaCierreMinutos;
  let franjaRestringeEsteDia = false;
  if (medicoDoc && medicoDoc.franjaHoraria &&
      medicoDoc.franjaHoraria.horaInicio && medicoDoc.franjaHoraria.horaFin) {
    const inicioFranjaMinutos = minutoDesdeString(medicoDoc.franjaHoraria.horaInicio);
    const finFranjaMinutos = minutoDesdeString(medicoDoc.franjaHoraria.horaFin);
    const aperturaEfectiva = Math.max(horaAperturaMinutos, inicioFranjaMinutos);
    const cierreEfectiva = Math.min(horaCierreMinutos, finFranjaMinutos);
    if (aperturaEfectiva !== horaAperturaMinutos || cierreEfectiva !== horaCierreMinutos) {
      franjaRestringeEsteDia = true;
      horaAperturaBusqueda = aperturaEfectiva;
      horaCierreBusqueda = cierreEfectiva;
    }
  }

  // --- Búsqueda continua: recorrer el horario (acotado por franja, si aplica) en
  // bloques de GRANO_MINUTOS. Nota: horaCierreMinutos (el cierre REAL de la sede) se
  // sigue usando más abajo para el cálculo de "mejor ajuste" — la franja acota DÓNDE se
  // puede colocar el turno, no cómo se mide el desaprovechamiento del sillón.
  const huecos = [];
  for (let minutoActual = horaAperturaBusqueda; minutoActual + duracionNormalizada <= horaCierreBusqueda; minutoActual += GRANO_MINUTOS) {
    // Intentar colocar el bloque [minutoActual, minutoActual + duracionNormalizada)
    // en cada sillón disponible
    for (const sillon of sillonesDisponibles) {
      const tieneConflicto = turnosDelDia.some(turno => {
        if (turno.sillon !== sillon) return false; // Diferente sillón, no hay conflicto
        const minutoInicio = minutoDesdeString(turno.horarioInicio);
        const minutoFin = minutoDesdeString(turno.horarioFin);
        // Conflicto si [minutoActual, minutoActual + duracionNormalizada) se superpone
        // con [minutoInicio, minutoFin)
        return minutoActual < minutoFin && minutoActual + duracionNormalizada > minutoInicio;
      });

      if (!tieneConflicto) {
        // Hueco encontrado. "Mejor ajuste" = cuánto tiempo libre queda entre el fin de
        // este bloque y el próximo evento en el mismo sillón ese día (el siguiente
        // turno ya agendado, o el cierre de la sede si no hay ninguno después). Cuanto
        // menor ese resto, mejor aprovechado queda el sillón.
        const finBloque = minutoActual + duracionNormalizada;
        const proximosInicioEnEsteSillon = turnosDelDia
          .filter(t => t.sillon === sillon)
          .map(t => minutoDesdeString(t.horarioInicio))
          .filter(inicio => inicio >= finBloque);
        const proximoEvento = proximosInicioEnEsteSillon.length > 0
          ? Math.min(...proximosInicioEnEsteSillon)
          : horaCierreMinutos;
        const tiempoDesaprovechadoMinutos = proximoEvento - finBloque;

        huecos.push({
          sedeId, sedeNombre, fecha: fechaActualISO,
          fechaLegible: formatearFechaLegibleMotor(fechaActual),
          horaInicio: stringDesdeMinuto(minutoActual),
          horaFin: stringDesdeMinuto(minutoActual + duracionNormalizada),
          minutoInicioBloqueNormalizado: minutoActual,
          duracionMinutos: duracionNormalizada,
          sillon: sillon,
          tiempoDesaprovechadoMinutos: tiempoDesaprovechadoMinutos
        });

        // No seguir buscando más sillones en esta hora para este día (la idea es
        // devolver una opción por cada franja horaria, no múltiples sillones)
        break;
      }
    }
  }

  // Si la franja restringió este día y no apareció ningún hueco dentro de ella, el día
  // se descarta (mismo criterio que el cupo: quien llama sigue con el próximo día). El
  // candidato de sobreturno, cuando corresponde capturarlo, se busca en el horario REAL
  // de la sede (ignorando la franja a propósito, es lo que se ofrece como excepción).
  if (franjaRestringeEsteDia && huecos.length === 0) {
    let candidatoFranja = null;
    if (capturarCandidato) {
      const probeHueco = encontrarPrimerHuecoFisico(
        horaAperturaMinutos, horaCierreMinutos, duracionNormalizada, sillonesDisponibles, turnosDelDia
      );
      if (probeHueco) {
        candidatoFranja = {
          sedeId, sedeNombre, fecha: fechaActualISO,
          fechaLegible: formatearFechaLegibleMotor(fechaActual),
          horaInicio: probeHueco.horaInicio, horaFin: probeHueco.horaFin, medicoId,
          franjaHorario: { horaInicio: medicoDoc.franjaHoraria.horaInicio, horaFin: medicoDoc.franjaHoraria.horaFin }
        };
      }
    }
    return {
      bloqueadoPorPaciente: false,
      bloqueadoPorAtadura: false, candidatoAtadura: null,
      bloqueadoPorCupo: false, candidatoCupo: null,
      bloqueadoPorFranja: true, candidatoFranja,
      huecos: []
    };
  }

  return {
    bloqueadoPorPaciente: false,
    bloqueadoPorAtadura: false, candidatoAtadura: null,
    bloqueadoPorCupo: false, candidatoCupo: null,
    bloqueadoPorFranja: false, candidatoFranja: null,
    huecos
  };
}

// --- Búsqueda secuencial de huecos por sede (T3/T4, sin cambios de comportamiento) ---

async function buscarHuecosEnSede(
  sedeId,
  sedeNombre,
  fechaInicioBusqueda, // objeto Date, medianoche
  duracionMinutos,
  horaAperturaString, // "08:00"
  horaCierreString, // "14:00" (no se puede cargar turno a esta hora)
  diasAtencion, // array ["lunes", "martes", ...]
  turnosExistentesEnSede, // array de turnos ya cargados en esta sede
  sillonesDisponibles, // array de números de sillones
  medicoId, // T4: id del médico (slug) o null/nombre libre si es "Otro"
  medicoDoc, // T4: doc de turneroMedicos del médico, o undefined si no aplica (p. ej. "Otro")
  usaAtaduraDia, // T4: bool, de turneroSedes.usaAtaduraDia
  usaCuposPorcentaje, // T4: bool, de turneroSedes.usaCuposPorcentaje
  cuposCacheLectura, // T4: array de docs de turneroCupos
  diasBloqueadosPaciente, // opcional: Set de fechas ISO donde el paciente ya tiene otro turno
  bloqueosCacheLectura // T9: array de docs de turneroBloqueos, activos, cualquier sede
                        // (se filtra por sedeId acá adentro) — opcional, un llamador que
                        // no lo pasa se comporta exactamente igual que antes de esta etapa.
) {
  // Retorna { huecos, candidatoCupoExcedido, candidatoAtaduraExcedida, bloqueadoPorPacienteMismoDia }.
  // huecos: array de huecos válidos (de mayor a menor ajuste), ya filtrados por paciente/atadura/cupo.
  // candidatoCupoExcedido / candidatoAtaduraExcedida: solo si en la fecha originalmente
  // solicitada (diasDesde === 0) había un hueco físico real pero esa regla lo bloqueó —
  // para ofrecerlo después como sobreturno. bloqueadoPorPacienteMismoDia: true si el día
  // puntualmente pedido está bloqueado porque el paciente ya tiene otro turno ese día —
  // nunca ofrece sobreturno, es bloqueo total sin excepción de rol.

  const huecos = [];
  let candidatoCupoExcedido = null;
  let candidatoAtaduraExcedida = null;
  let candidatoFranjaExcedida = null;
  let bloqueadoPorPacienteMismoDia = false;
  const horaAperturaMinutos = minutoDesdeString(horaAperturaString);
  const horaCierreMinutos = minutoDesdeString(horaCierreString);

  // Normalizar duración a bloques de GRANO_MINUTOS
  // (aunque T3 no recorta, sí respeta la normalización para no dejar sueltos)
  const duracionNormalizada = Math.ceil(duracionMinutos / GRANO_MINUTOS) * GRANO_MINUTOS;

  // Iterar sobre los días dentro del rango de búsqueda
  for (let diasDesde = 0; diasDesde <= TOPE_DIAS_BUSQUEDA; diasDesde++) {
    const fechaActual = new Date(fechaInicioBusqueda);
    fechaActual.setDate(fechaActual.getDate() + diasDesde);

    // Obtener el nombre del día en español. IMPORTANTE: "miercoles" va sin tilde acá
    // a propósito — así es como turnero-sedes.js guarda diasAtencion en Firestore
    // (DIAS_SEMANA en turnero-sedes.js/turnero-medicos.js/turnero-cupos.js, sin acento).
    // Si se le pone tilde, la comparación de más abajo nunca coincide y el motor
    // saltea todos los miércoles pensando que la sede no atiende ese día.
    const dayIndex = fechaActual.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
    const diasEnEspanol = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const nombreDiaActual = diasEnEspanol[dayIndex];
    const fechaActualISO = fechaISO(fechaActual);

    // Verificar si la sede atiende ese día
    if (!diasAtencion.includes(nombreDiaActual)) {
      continue; // No atiende ese día, pasar al siguiente
    }

    // Construir lista de turnos que impactan ese día en esa sede.
    // Se descartan turnos que no tengan horarioInicio/horarioFin como string: son
    // turnos cargados antes de la Etapa T3 (T1/T2), que todavía no tenían estos
    // campos — considerarlos rompería el cálculo de conflictos más abajo.
    const turnosDelDiaReales = turnosExistentesEnSede.filter(turno =>
      turno.fecha === fechaActualISO &&
      typeof turno.horarioInicio === "string" &&
      typeof turno.horarioFin === "string"
    );
    // T9: los bloqueos se suman acá, nunca a turnosExistentesEnSede (ver comentario en
    // pseudoTurnosBloqueoEnFecha) — así el cupo por porcentaje y la atadura de día,
    // que usan turnosExistentesEnSede tal cual, no se enteran de que existen.
    const turnosDelDia = bloqueosCacheLectura
      ? [...turnosDelDiaReales, ...pseudoTurnosBloqueoEnFecha(
          bloqueosCacheLectura, sedeId, fechaActualISO, sillonesDisponibles, horaAperturaString, horaCierreString
        )]
      : turnosDelDiaReales;

    const resultadoDia = evaluarDiaEnSede({
      sedeId, sedeNombre, fechaActual, fechaActualISO, nombreDiaActual,
      horaAperturaMinutos, horaCierreMinutos, duracionMinutos, duracionNormalizada,
      turnosDelDia, turnosExistentesEnSede, sillonesDisponibles,
      medicoId, medicoDoc, usaAtaduraDia, usaCuposPorcentaje, cuposCacheLectura,
      diasBloqueadosPaciente,
      capturarCandidato: diasDesde === 0
    });

    // Paciente: mismo criterio que la atadura — corta la búsqueda entera en esta sede
    // si el día PUNTUALMENTE PEDIDO ya tiene otro turno de este paciente (sin importar
    // sede). Nunca ofrece sobreturno, es bloqueo total. En días posteriores (probados
    // por la búsqueda automática), se saltea en silencio.
    if (resultadoDia.bloqueadoPorPaciente) {
      if (diasDesde === 0) {
        bloqueadoPorPacienteMismoDia = true;
        return { huecos, candidatoCupoExcedido, candidatoAtaduraExcedida, candidatoFranjaExcedida, bloqueadoPorPacienteMismoDia };
      }
      continue;
    }

    // Atadura: corta la búsqueda entera en esta sede si el día PUNTUALMENTE PEDIDO
    // (diasDesde === 0) no corresponde al médico — no se prueban más días acá dentro.
    // Si el bloqueo ocurre en un día posterior (probado por la búsqueda automática de
    // disponibilidad), se saltea en silencio y se sigue con el día siguiente.
    if (resultadoDia.bloqueadoPorAtadura) {
      if (diasDesde === 0) {
        if (resultadoDia.candidatoAtadura) candidatoAtaduraExcedida = resultadoDia.candidatoAtadura;
        return { huecos, candidatoCupoExcedido, candidatoAtaduraExcedida, candidatoFranjaExcedida, bloqueadoPorPacienteMismoDia };
      }
      continue;
    }

    // Cupo: nunca corta la búsqueda entera, solo saltea este día puntual y sigue
    // probando los siguientes dentro de la ventana de TOPE_DIAS_BUSQUEDA.
    if (resultadoDia.bloqueadoPorCupo) {
      if (diasDesde === 0 && resultadoDia.candidatoCupo) candidatoCupoExcedido = resultadoDia.candidatoCupo;
      continue;
    }

    // Franja horaria del médico (ronda "mejoras motor"): mismo criterio que el cupo,
    // nunca corta la búsqueda entera, solo saltea este día puntual.
    if (resultadoDia.bloqueadoPorFranja) {
      if (diasDesde === 0 && resultadoDia.candidatoFranja) candidatoFranjaExcedida = resultadoDia.candidatoFranja;
      continue;
    }

    // Agregar "superaTolerancia" acá (depende de diasDesde, un concepto que solo existe
    // en esta búsqueda secuencial — evaluarDiaEnSede no lo calcula).
    for (const hueco of resultadoDia.huecos) {
      huecos.push({ ...hueco, superaTolerancia: diasDesde > 5 });
    }

    // Si encontramos al menos un hueco en este día, no buscar más días
    // (criterio: primera fecha posible con hueco)
    if (huecos.length > 0) break;
  }

  // Ordenar por mejor ajuste (menos tiempo desperdiciado)
  huecos.sort((a, b) => a.tiempoDesaprovechadoMinutos - b.tiempoDesaprovechadoMinutos);

  return { huecos, candidatoCupoExcedido, candidatoAtaduraExcedida, candidatoFranjaExcedida, bloqueadoPorPacienteMismoDia };
}

// --- Búsqueda semanal de huecos por sede (T6 Fase 3: grilla con arrastre) ---
//
// A diferencia de buscarHuecosEnSede (que busca secuencialmente desde una fecha y
// corta en el primer día con huecos, o en la atadura del día pedido), esta evalúa
// TODOS los días que recibe en `fechasVisibles` de forma independiente, sin cortar
// nunca — porque para saber qué celdas de la grilla semanal son huecos válidos hace
// falta el resultado de cada día, no solo el primero. No ofrece candidato de
// sobreturno (capturarCandidato siempre false): el arrastre de esta fase solo permite
// soltar en huecos válidos reales, no ofrece sobreturno.
async function buscarHuecosSemanaEnSede(
  sedeId,
  sedeNombre,
  fechasVisibles, // array de objetos Date (los días de la semana visible en la grilla)
  duracionMinutos,
  horaAperturaString,
  horaCierreString,
  diasAtencion,
  turnosExistentesEnSede, // ya debe venir sin el turno que se está arrastrando, si aplica
  sillonesDisponibles,
  medicoId,
  medicoDoc,
  usaAtaduraDia,
  usaCuposPorcentaje,
  cuposCacheLectura,
  diasBloqueadosPaciente, // opcional: Set de fechas ISO donde el paciente ya tiene otro turno
  bloqueosCacheLectura // T9: array de docs de turneroBloqueos, activos, cualquier sede
) {
  // Retorna un objeto { "2026-09-08": resultadoDelDia, ... } con una entrada por cada
  // fecha de fechasVisibles. resultadoDelDia:
  // {
  //   atiende: bool,              // false si la sede no atiende ese día (huecos siempre [])
  //   bloqueadoPorPaciente: bool, // el paciente ya tiene otro turno ese día (cualquier sede)
  //   bloqueadoPorAtadura: bool,  // solo tiene sentido si atiende === true
  //   bloqueadoPorCupo: bool,
  //   huecos: [...]               // huecos físicos válidos, sin ordenar (cada uno con su
  //                                // propio tiempoDesaprovechadoMinutos para comparar)
  // }

  const horaAperturaMinutos = minutoDesdeString(horaAperturaString);
  const horaCierreMinutos = minutoDesdeString(horaCierreString);
  const duracionNormalizada = Math.ceil(duracionMinutos / GRANO_MINUTOS) * GRANO_MINUTOS;
  const diasEnEspanol = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

  const resultadoPorDia = {};

  for (const fechaActual of fechasVisibles) {
    const nombreDiaActual = diasEnEspanol[fechaActual.getDay()];
    const fechaActualISO = fechaISO(fechaActual);

    if (!diasAtencion.includes(nombreDiaActual)) {
      resultadoPorDia[fechaActualISO] = {
        atiende: false, bloqueadoPorPaciente: false, bloqueadoPorAtadura: false, bloqueadoPorCupo: false,
        bloqueadoPorFranja: false, huecos: []
      };
      continue;
    }

    const turnosDelDiaReales = turnosExistentesEnSede.filter(turno =>
      turno.fecha === fechaActualISO &&
      typeof turno.horarioInicio === "string" &&
      typeof turno.horarioFin === "string"
    );
    const turnosDelDia = bloqueosCacheLectura
      ? [...turnosDelDiaReales, ...pseudoTurnosBloqueoEnFecha(
          bloqueosCacheLectura, sedeId, fechaActualISO, sillonesDisponibles, horaAperturaString, horaCierreString
        )]
      : turnosDelDiaReales;

    const resultadoDia = evaluarDiaEnSede({
      sedeId, sedeNombre, fechaActual, fechaActualISO, nombreDiaActual,
      horaAperturaMinutos, horaCierreMinutos, duracionMinutos, duracionNormalizada,
      turnosDelDia, turnosExistentesEnSede, sillonesDisponibles,
      medicoId, medicoDoc, usaAtaduraDia, usaCuposPorcentaje, cuposCacheLectura,
      diasBloqueadosPaciente,
      capturarCandidato: false
    });

    resultadoPorDia[fechaActualISO] = {
      atiende: true,
      bloqueadoPorPaciente: resultadoDia.bloqueadoPorPaciente,
      bloqueadoPorAtadura: resultadoDia.bloqueadoPorAtadura,
      bloqueadoPorCupo: resultadoDia.bloqueadoPorCupo,
      bloqueadoPorFranja: resultadoDia.bloqueadoPorFranja,
      huecos: resultadoDia.huecos
    };
  }

  return resultadoPorDia;
}

// --- Helper T4 (feedback post-entrega, 31/8): horario real del sobreturno por falta de
// disponibilidad física ---
// Antes se guardaba siempre un horario fijo "09:00"-"10:00" (placeholder sin relación con
// la duración real pedida). A pedido de Elías: si queda lugar en la agenda de ese día/sede
// después del último turno ya cargado (cualquier sillón, incluyendo otros sobreturnos),
// ocupa el tiempo que corresponde (la duración pedida completa); si no entra completa, se
// acomoda en lo que quede; si no queda nada de lugar, se carga con 1 minuto de duración
// (una marca administrativa, no un horario real utilizable).
// Solo hace falta para el sobreturno por falta de disponibilidad física: el sobreturno por
// cupo y el sobreturno por atadura de día ya se construyen sobre un hueco físico real
// (encontrarPrimerHuecoFisico encuentra el bloque completo o no encuentra nada), así que
// nunca necesitan este ajuste.
function calcularBloqueSobreturno(horaAperturaString, horaCierreString, turnosDelDiaEnSede, duracionSolicitadaMinutos) {
  const horaAperturaMinutos = minutoDesdeString(horaAperturaString);
  const horaCierreMinutos = minutoDesdeString(horaCierreString);

  const finesDeTurnos = (turnosDelDiaEnSede || [])
    .filter(t => typeof t.horarioFin === "string")
    .map(t => minutoDesdeString(t.horarioFin));
  const ultimoFin = finesDeTurnos.length > 0 ? Math.max(...finesDeTurnos) : horaAperturaMinutos;
  const inicioAsignado = Math.max(horaAperturaMinutos, ultimoFin);

  const espacioDisponible = horaCierreMinutos - inicioAsignado;
  let duracionAsignada;
  if (espacioDisponible >= duracionSolicitadaMinutos) {
    duracionAsignada = duracionSolicitadaMinutos;
  } else if (espacioDisponible > 0) {
    duracionAsignada = espacioDisponible;
  } else {
    duracionAsignada = 1;
  }

  return {
    horaInicio: stringDesdeMinuto(inicioAsignado),
    horaFin: stringDesdeMinuto(inicioAsignado + duracionAsignada),
    duracionAsignada
  };
}

// --- Función principal del motor ---

async function buscarHuecos(
  medicoId, // sedeId del médico si es fijo, o "otro"
  obraSocialPaciente, // string, para lógica de Occhipinti
  duracionMinutos, // duración total (protocolos + premedicación)
  fechaSolicitadaISO, // "2026-09-08"
  medicosCacheLectura, // array de docs de turneroMedicos
  sedesCacheLectura, // array de docs de turneroSedes
  turnosExistentes, // array de docs de turnos ya cargados (TODAS las sedes: hace falta
                     // para poder chequear el bloqueo por paciente, que es transversal)
  esRolMedico, // bool, para determinar qué tipo de sobreturno/bloqueo ofrecer después
  sedeIdManual, // string|null — si la persona ya eligió la sede a mano (médico "Otro" o
                // médico que atiende ambas sedes), buscar SOLO ahí, sin recalcular.
  cuposCacheLectura, // T4: array de docs de turneroCupos (opcional; si no se pasa, sin cupo)
  pacienteId, // opcional: id del paciente, para la regla "un turno por día" (transversal a sedes)
  turnoIdExcluir, // opcional: id del propio turno a excluir del chequeo (uso: reasignación)
  bloqueosCacheLectura, // T9: array de docs de turneroBloqueos, activos, cualquier sede (opcional)
  soloSillonTipo // Ronda "mejoras motor", Frente 3: null/undefined (default, búsqueda
                 // normal, solo sillones "regular") o "backup" — restringe la búsqueda a
                 // ese único tipo de sillón e IGNORA atadura/cupo/franja a propósito
                 // (se fuerza medicoDoc a null más abajo, que es lo que ya hace que esas
                 // tres reglas nunca se evalúen — mismo mecanismo que ya usa "Otro").
) {
  // Retorna la estructura de resultado del motor.

  try {
    // 0. T4: resolver el doc del médico (si existe una ficha propia — "Otro" no tiene).
    // Frente 3 (backup): se fuerza a null a propósito — atadura, cupo y franja horaria
    // están todas gateadas en `medicoDoc` truthy dentro de evaluarDiaEnSede, así que
    // esto alcanza para que ninguna de las tres se evalúe en este modo, sin duplicar
    // esa lógica acá.
    const medicoDoc = soloSillonTipo ? null : (medicosCacheLectura || []).find(m => m.id === medicoId);

    // 0.5: regla nueva — un mismo paciente no puede tener más de un turno activo el
    // mismo día, en ninguna sede. Se calcula una sola vez con TODOS los turnos
    // existentes (no filtrados por sede), y se le pasa a cada sede que se intente.
    const diasBloqueadosPaciente = diasBloqueadosPorPaciente(pacienteId, turnosExistentes, turnoIdExcluir);

    // 1. Determinar sedes a buscar. Si la persona ya eligió una sede a mano, se
    // respeta esa elección tal cual — no se vuelve a calcular por médico/obra social.
    const sedesABuscar = sedeIdManual
      ? [sedeIdManual]
      : await determinarSedesABuscar(medicoId, obraSocialPaciente, medicosCacheLectura);

    if (sedesABuscar.length === 0) {
      return {
        exito: false,
        sinHuecosMotivo: "El médico no tiene sedes configuradas.",
        sedesIntentadas: []
      };
    }

    // 2. Parsear fecha solicitada
    const fechaInicioBusqueda = fechaDesdeISO(fechaSolicitadaISO);

    // 3. Buscar en cada sede en orden
    const todosLosHuecos = [];
    let candidatoCupoExcedidoGlobal = null;
    let candidatoAtaduraExcedidoGlobal = null;
    let candidatoFranjaExcedidoGlobal = null;
    let bloqueadoPorPacienteGlobal = false;

    for (const sedeId of sedesABuscar) {
      const sedeDoc = sedesCacheLectura.find(s => s.id === sedeId);
      if (!sedeDoc) {
        console.warn(`Sede ${sedeId} no encontrada en caché.`);
        continue;
      }

      const sedeNombre = sedeDoc.nombre;
      const horaApertura = sedeDoc.horaApertura;
      const horaCierre = sedeDoc.horaCierre;
      const diasAtencion = sedeDoc.diasAtencion || [];
      // Ronda "mejoras motor", Frente 3: el sillón backup ya NO integra el pool
      // automático por defecto (antes contaba igual que uno regular, decisión de T0
      // revertida explícitamente). soloSillonTipo restringe a un único tipo puntual —
      // hoy solo se usa con "backup" (checkbox dedicado), pero queda genérico por si
      // hace falta algún otro tipo de sillón especial más adelante.
      const sillones = (sedeDoc.sillones || [])
        .filter(s => soloSillonTipo ? s.tipo === soloSillonTipo : s.tipo === "regular")
        .map(s => s.numero);
      const usaAtaduraDia = sedeDoc.usaAtaduraDia === true;
      const usaCuposPorcentaje = sedeDoc.usaCuposPorcentaje === true;

      // Filtrar turnos de esta sede
      const turnosEnSede = turnosExistentes.filter(t => t.sedeId === sedeId);

      const resultadoSede = await buscarHuecosEnSede(
        sedeId,
        sedeNombre,
        fechaInicioBusqueda,
        duracionMinutos,
        horaApertura,
        horaCierre,
        diasAtencion,
        turnosEnSede,
        sillones,
        medicoId,
        medicoDoc,
        usaAtaduraDia,
        usaCuposPorcentaje,
        cuposCacheLectura,
        diasBloqueadosPaciente,
        bloqueosCacheLectura
      );

      const huecos = resultadoSede.huecos;
      if (resultadoSede.bloqueadoPorPacienteMismoDia) {
        bloqueadoPorPacienteGlobal = true;
      }
      if (!candidatoCupoExcedidoGlobal && resultadoSede.candidatoCupoExcedido) {
        candidatoCupoExcedidoGlobal = resultadoSede.candidatoCupoExcedido;
      }
      if (!candidatoAtaduraExcedidoGlobal && resultadoSede.candidatoAtaduraExcedida) {
        candidatoAtaduraExcedidoGlobal = resultadoSede.candidatoAtaduraExcedida;
      }
      if (!candidatoFranjaExcedidoGlobal && resultadoSede.candidatoFranjaExcedida) {
        candidatoFranjaExcedidoGlobal = resultadoSede.candidatoFranjaExcedida;
      }

      todosLosHuecos.push(...huecos);

      // Si encontramos huecos en esta sede, no seguimos buscando en las siguientes
      // de la lista (se respeta el orden de prioridad: primero la primera sede de
      // la lista, solo si no hay lugar ahí se pasa a la próxima).
      const esUltimaSedeDeLaLista = sedesABuscar.indexOf(sedeId) === sedesABuscar.length - 1;
      if (huecos.length > 0 && !esUltimaSedeDeLaLista) {
        break;
      }
    }

    if (todosLosHuecos.length > 0) {
      // Ordenar todos los huecos por mejor ajuste (global, no por sede)
      todosLosHuecos.sort((a, b) => a.tiempoDesaprovechadoMinutos - b.tiempoDesaprovechadoMinutos);

      return {
        exito: true,
        huecosEncontrados: todosLosHuecos,
        sedesIntentadas: sedesABuscar,
        diasBuscados: TOPE_DIAS_BUSQUEDA
      };
    }

    // No se encontraron huecos dentro de las reglas normales.
    // Regla nueva: si el paciente ya tiene otro turno la fecha originalmente pedida
    // (en cualquier sede), es el motivo más básico — se prioriza sobre cupo/atadura.
    // Bloqueo total, mismo mensaje para cualquier rol, nunca ofrece sobreturno.
    if (bloqueadoPorPacienteGlobal) {
      return {
        exito: false,
        sinHuecosMotivo: `Este paciente ya tiene un turno cargado el ${formatearFechaLegibleMotor(fechaInicioBusqueda)}. No se puede agendar otro el mismo día.`,
        bloqueoPaciente: true,
        sedesIntentadas: sedesABuscar,
        diasBuscados: TOPE_DIAS_BUSQUEDA
      };
    }

    // T4: si la causa concreta es el cupo del médico en la fecha originalmente pedida
    // (no la falta de sillón físico en general), se distingue del sobreturno genérico.
    if (candidatoCupoExcedidoGlobal) {
      if (esRolMedico) {
        return {
          exito: false,
          bloqueoCupo: {
            tipo: "bloqueoTotal",
            medicoId: candidatoCupoExcedidoGlobal.medicoId,
            porcentaje: candidatoCupoExcedidoGlobal.porcentaje,
            sedeNombre: candidatoCupoExcedidoGlobal.sedeNombre,
            fechaLegible: candidatoCupoExcedidoGlobal.fechaLegible
          },
          sinHuecosMotivo: "Ha alcanzado el límite máximo de pacientes para este día.",
          sedesIntentadas: sedesABuscar,
          diasBuscados: TOPE_DIAS_BUSQUEDA
        };
      }

      return {
        exito: false,
        bloqueoCupo: {
          tipo: "confirmable",
          medicoId: candidatoCupoExcedidoGlobal.medicoId,
          porcentaje: candidatoCupoExcedidoGlobal.porcentaje,
          minutosUsados: candidatoCupoExcedidoGlobal.minutosUsados,
          techoMinutos: candidatoCupoExcedidoGlobal.techoMinutos,
          sedeNombre: candidatoCupoExcedidoGlobal.sedeNombre,
          fechaLegible: candidatoCupoExcedidoGlobal.fechaLegible,
          huecoDisponible: {
            sedeId: candidatoCupoExcedidoGlobal.sedeId,
            sedeNombre: candidatoCupoExcedidoGlobal.sedeNombre,
            fecha: candidatoCupoExcedidoGlobal.fecha,
            fechaLegible: candidatoCupoExcedidoGlobal.fechaLegible,
            horaInicio: candidatoCupoExcedidoGlobal.horaInicio,
            horaFin: candidatoCupoExcedidoGlobal.horaFin
          }
        },
        sinHuecosMotivo: `Está por superar el porcentaje límite de ocupación de este médico (${candidatoCupoExcedidoGlobal.porcentaje}%) para el ${candidatoCupoExcedidoGlobal.fechaLegible}.`,
        sedesIntentadas: sedesABuscar,
        diasBuscados: TOPE_DIAS_BUSQUEDA
      };
    }

    // T4 (agregado 31/8): si la causa concreta es la atadura de día (el médico no
    // atiende ese día en esa sede, pero sí había sillón físico libre), se distingue
    // también del sobreturno genérico — mismo patrón que el cupo, arriba.
    if (candidatoAtaduraExcedidoGlobal) {
      if (esRolMedico) {
        return {
          exito: false,
          bloqueoAtadura: {
            tipo: "bloqueoTotal",
            medicoId: candidatoAtaduraExcedidoGlobal.medicoId,
            sedeNombre: candidatoAtaduraExcedidoGlobal.sedeNombre,
            fechaLegible: candidatoAtaduraExcedidoGlobal.fechaLegible,
            nombreDiaSolicitado: candidatoAtaduraExcedidoGlobal.nombreDiaSolicitado,
            diasAtencionMedico: candidatoAtaduraExcedidoGlobal.diasAtencionMedico
          },
          sinHuecosMotivo: "Ha alcanzado el límite máximo de pacientes para este día.",
          sedesIntentadas: sedesABuscar,
          diasBuscados: TOPE_DIAS_BUSQUEDA
        };
      }

      return {
        exito: false,
        bloqueoAtadura: {
          tipo: "confirmable",
          medicoId: candidatoAtaduraExcedidoGlobal.medicoId,
          sedeNombre: candidatoAtaduraExcedidoGlobal.sedeNombre,
          fechaLegible: candidatoAtaduraExcedidoGlobal.fechaLegible,
          nombreDiaSolicitado: candidatoAtaduraExcedidoGlobal.nombreDiaSolicitado,
          diasAtencionMedico: candidatoAtaduraExcedidoGlobal.diasAtencionMedico,
          huecoDisponible: {
            sedeId: candidatoAtaduraExcedidoGlobal.sedeId,
            sedeNombre: candidatoAtaduraExcedidoGlobal.sedeNombre,
            fecha: candidatoAtaduraExcedidoGlobal.fecha,
            fechaLegible: candidatoAtaduraExcedidoGlobal.fechaLegible,
            horaInicio: candidatoAtaduraExcedidoGlobal.horaInicio,
            horaFin: candidatoAtaduraExcedidoGlobal.horaFin
          }
        },
        sinHuecosMotivo: `El médico no atiende en ${candidatoAtaduraExcedidoGlobal.sedeNombre} el ${candidatoAtaduraExcedidoGlobal.fechaLegible}.`,
        sedesIntentadas: sedesABuscar,
        diasBuscados: TOPE_DIAS_BUSQUEDA
      };
    }

    // Ronda "mejoras motor", Frente 1: franja horaria del médico — había sillón, pero
    // fuera del rango horario configurado para él. Mismo patrón que cupo/atadura arriba:
    // bloqueoTotal sin opción de forzar para el rol médico, confirmable con sobreturno
    // para enfermería/administrador.
    if (candidatoFranjaExcedidoGlobal) {
      if (esRolMedico) {
        return {
          exito: false,
          bloqueoFranja: {
            tipo: "bloqueoTotal",
            medicoId: candidatoFranjaExcedidoGlobal.medicoId,
            sedeNombre: candidatoFranjaExcedidoGlobal.sedeNombre,
            fechaLegible: candidatoFranjaExcedidoGlobal.fechaLegible,
            franjaHorario: candidatoFranjaExcedidoGlobal.franjaHorario
          },
          sinHuecosMotivo: "Ha alcanzado el límite máximo de pacientes para este día.",
          sedesIntentadas: sedesABuscar,
          diasBuscados: TOPE_DIAS_BUSQUEDA
        };
      }

      return {
        exito: false,
        bloqueoFranja: {
          tipo: "confirmable",
          medicoId: candidatoFranjaExcedidoGlobal.medicoId,
          sedeNombre: candidatoFranjaExcedidoGlobal.sedeNombre,
          fechaLegible: candidatoFranjaExcedidoGlobal.fechaLegible,
          franjaHorario: candidatoFranjaExcedidoGlobal.franjaHorario,
          huecoDisponible: {
            sedeId: candidatoFranjaExcedidoGlobal.sedeId,
            sedeNombre: candidatoFranjaExcedidoGlobal.sedeNombre,
            fecha: candidatoFranjaExcedidoGlobal.fecha,
            fechaLegible: candidatoFranjaExcedidoGlobal.fechaLegible,
            horaInicio: candidatoFranjaExcedidoGlobal.horaInicio,
            horaFin: candidatoFranjaExcedidoGlobal.horaFin
          }
        },
        sinHuecosMotivo: `El médico solo atiende de ${candidatoFranjaExcedidoGlobal.franjaHorario.horaInicio} a ${candidatoFranjaExcedidoGlobal.franjaHorario.horaFin} y no hay lugar dentro de ese horario el ${candidatoFranjaExcedidoGlobal.fechaLegible}.`,
        sedesIntentadas: sedesABuscar,
        diasBuscados: TOPE_DIAS_BUSQUEDA
      };
    }

    return {
      exito: false,
      sinHuecosMotivo: `No hay lugar disponible dentro de ${TOPE_DIAS_BUSQUEDA} días.`,
      sedesIntentadas: sedesABuscar,
      diasBuscados: TOPE_DIAS_BUSQUEDA
    };

  } catch (error) {
    console.error("Error en motor de búsqueda:", error);
    return {
      exito: false,
      sinHuecosMotivo: `Error interno: ${error.message}`,
      sedesIntentadas: [],
      diasBuscados: 0
    };
  }
}

// --- Etapa T7, Fase 1 (Modificar): validar un candidato puntual ---
//
// A diferencia de buscarHuecos/evaluarDiaEnSede (que barren el horario buscando huecos
// libres), acá el sillón y el horario ya están definidos de antemano — "Modificar" no
// busca, cambia sillón, protocolo/duración o médico de un turno sin tocar su fecha ni
// su horario de inicio (eso es "Reasignar"). Valida el candidato contra las mismas tres
// reglas de fondo: atadura de día, cupo por porcentaje y superposición física de
// sillón. turnoIdExcluir es el propio turno que se está modificando — nunca debe contar
// contra sí mismo, ni en el cupo ni en la superposición.
function validarHuecoEspecificoEnSede({
  sedeId, sedeNombre, nombreDiaActual, fechaActualISO,
  horaAperturaMinutos, horaCierreMinutos,
  horaInicioMinutos, horaFinMinutos, sillon,
  sillonesDisponibles,
  turnosExistentesEnSede,
  turnoIdExcluir,
  medicoId, medicoDoc, usaAtaduraDia, usaCuposPorcentaje, cuposCacheLectura,
  bloqueosCacheLectura // T9: array de docs de turneroBloqueos, activos, cualquier sede (opcional)
}) {
  if (horaInicioMinutos < horaAperturaMinutos || horaFinMinutos > horaCierreMinutos) {
    return { valido: false, motivo: "horario" };
  }

  // --- Atadura de día (igual criterio que evaluarDiaEnSede) ---
  if (usaAtaduraDia && medicoDoc) {
    const diasDelMedicoEnSede = (medicoDoc.diasPorSede && medicoDoc.diasPorSede[sedeNombre]) || [];
    if (!diasDelMedicoEnSede.includes(nombreDiaActual)) {
      return {
        valido: false, motivo: "atadura",
        nombreDiaSolicitado: nombreDiaActual, diasAtencionMedico: diasDelMedicoEnSede
      };
    }
  }

  // --- Cupo por porcentaje (igual criterio que evaluarDiaEnSede, pero excluyendo el
  // propio turno del total ya usado — si no, se contaría dos veces: como ya cargado y
  // como el candidato nuevo). ---
  if (usaCuposPorcentaje && medicoDoc) {
    const cupoDoc = (cuposCacheLectura || []).find(c => c.sedeId === sedeId && c.dia === nombreDiaActual);
    const porcentaje = cupoDoc && cupoDoc.cupos && cupoDoc.cupos[medicoId] != null ? cupoDoc.cupos[medicoId] : null;

    if (porcentaje != null) {
      const totalMinutosSede = (horaCierreMinutos - horaAperturaMinutos) * sillonesDisponibles.length;
      const techoMinutos = totalMinutosSede * porcentaje / 100;
      const minutosUsadosMedico = turnosExistentesEnSede
        .filter(t => t.medicoId === medicoId && t.fecha === fechaActualISO && t.id !== turnoIdExcluir)
        .reduce((acc, t) => acc + (Number(t.duracionTotalMinutos) || 0), 0);
      const duracionCandidato = horaFinMinutos - horaInicioMinutos;

      if (minutosUsadosMedico + duracionCandidato > techoMinutos) {
        return {
          valido: false, motivo: "cupo",
          porcentaje, minutosUsados: minutosUsadosMedico, techoMinutos
        };
      }
    } else {
      console.warn(`Cupo activo en ${sedeNombre} pero sin porcentaje configurado para "${medicoId}" el ${nombreDiaActual}. No se aplica tope ese día.`);
    }
  }

  // --- Ronda "mejoras motor", Frente 1: franja horaria del médico. A diferencia de la
  // búsqueda automática (que puede acotar la ventana y seguir probando otros huecos),
  // acá el candidato ya es puntual — si el rango [horaInicioMinutos, horaFinMinutos) no
  // entra completo dentro de la franja del médico, se rechaza sin más (Modificar no
  // busca otro horario, para eso está Reasignar). ---
  if (medicoDoc && medicoDoc.franjaHoraria && medicoDoc.franjaHoraria.horaInicio && medicoDoc.franjaHoraria.horaFin) {
    const inicioFranjaMinutos = minutoDesdeString(medicoDoc.franjaHoraria.horaInicio);
    const finFranjaMinutos = minutoDesdeString(medicoDoc.franjaHoraria.horaFin);
    if (horaInicioMinutos < inicioFranjaMinutos || horaFinMinutos > finFranjaMinutos) {
      return {
        valido: false, motivo: "franja",
        franjaHorario: { horaInicio: medicoDoc.franjaHoraria.horaInicio, horaFin: medicoDoc.franjaHoraria.horaFin }
      };
    }
  }

  // --- T9: bloqueo vigente sobre el sillón elegido. Solo aplica si se eligió un sillón
  // físico real (sillon != null) — "sin asignar (sobreturno)" no reclama ningún recurso
  // físico, así que no hay nada que un bloqueo pueda chocar acá. Se reutiliza el mismo
  // pseudoTurnosBloqueoEnFecha() del resto del motor, acotado a este único sillón, para
  // no mantener una segunda forma de leer un bloqueo. ---
  if (sillon != null && bloqueosCacheLectura) {
    const pseudoTurnosBloqueo = pseudoTurnosBloqueoEnFecha(
      bloqueosCacheLectura, sedeId, fechaActualISO, [sillon],
      stringDesdeMinuto(horaAperturaMinutos), stringDesdeMinuto(horaCierreMinutos)
    );
    const bloqueoQueChoca = pseudoTurnosBloqueo.find(pt => {
      if (pt.sillon !== sillon) return false; // un bloqueo con sillón propio ignora el
                                                // "sillonesDisponibles" que le pasamos acá
      const inicio = minutoDesdeString(pt.horarioInicio);
      const fin = minutoDesdeString(pt.horarioFin);
      return horaInicioMinutos < fin && horaFinMinutos > inicio;
    });
    if (bloqueoQueChoca) {
      return { valido: false, motivo: "bloqueado", motivoBloqueo: bloqueoQueChoca.motivoBloqueo };
    }
  }

  // --- Superposición física en el sillón elegido, excluyendo el propio turno ---
  const conflicto = turnosExistentesEnSede.some(t => {
    if (t.id === turnoIdExcluir) return false;
    if (t.fecha !== fechaActualISO || t.sillon !== sillon) return false;
    if (typeof t.horarioInicio !== "string" || typeof t.horarioFin !== "string") return false;
    const inicio = minutoDesdeString(t.horarioInicio);
    const fin = minutoDesdeString(t.horarioFin);
    return horaInicioMinutos < fin && horaFinMinutos > inicio;
  });
  if (conflicto) {
    return { valido: false, motivo: "sillonOcupado" };
  }

  return { valido: true };
}

// Envoltorio de alto nivel, mismo estilo que buscarHuecos: resuelve medicoDoc/sedeDoc/
// día de la semana a partir de ids y caches, y llama a validarHuecoEspecificoEnSede.
function validarModificacionTurno(
  medicoId, sedeId, fechaISOCandidato, horaInicioString, horaFinString, sillon,
  medicosCacheLectura, sedesCacheLectura, turnosExistentes, cuposCacheLectura, turnoIdExcluir,
  bloqueosCacheLectura // T9: array de docs de turneroBloqueos, activos, cualquier sede (opcional)
) {
  const medicoDoc = (medicosCacheLectura || []).find(m => m.id === medicoId);
  const sedeDoc = (sedesCacheLectura || []).find(s => s.id === sedeId);
  if (!sedeDoc) {
    return { valido: false, motivo: "sedeNoEncontrada" };
  }

  const fechaObjeto = fechaDesdeISO(fechaISOCandidato);
  const dayIndex = fechaObjeto.getDay();
  const diasEnEspanol = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const nombreDiaActual = diasEnEspanol[dayIndex];

  // Ronda "mejoras motor", Frente 3: sillonesDisponibles acá solo alimenta el cálculo
  // del cupo por porcentaje (totalMinutosSede, dentro de validarHuecoEspecificoEnSede) —
  // el sillón backup ya no cuenta ahí, mismo criterio que en buscarHuecos(). Esto NO
  // decide qué sillón se puede elegir en "Modificar" (eso sigue siendo
  // poblarSelectSillonModificar, en turnero-grilla.js, que a propósito sigue ofreciendo
  // el backup como elección manual — precedente ya existente desde T7).
  const sillonesDisponibles = (sedeDoc.sillones || [])
    .filter(s => s.tipo === "regular")
    .map(s => s.numero);
  const turnosExistentesEnSede = (turnosExistentes || []).filter(t => t.sedeId === sedeId);

  return validarHuecoEspecificoEnSede({
    sedeId, sedeNombre: sedeDoc.nombre, nombreDiaActual, fechaActualISO: fechaISOCandidato,
    horaAperturaMinutos: minutoDesdeString(sedeDoc.horaApertura),
    horaCierreMinutos: minutoDesdeString(sedeDoc.horaCierre),
    horaInicioMinutos: minutoDesdeString(horaInicioString),
    horaFinMinutos: minutoDesdeString(horaFinString),
    sillon,
    sillonesDisponibles,
    turnosExistentesEnSede,
    turnoIdExcluir,
    medicoId, medicoDoc,
    usaAtaduraDia: sedeDoc.usaAtaduraDia === true,
    usaCuposPorcentaje: sedeDoc.usaCuposPorcentaje === true,
    cuposCacheLectura,
    bloqueosCacheLectura
  });
}

// --- Ronda "mejoras motor", Frente 2: horario manual (exclusivo administrador) ---
//
// A diferencia de buscarHuecos (que recorre hasta 10 días buscando el mejor ajuste),
// esta función valida UN horario fijo, elegido a mano, y solo decide qué sillón
// conviene usar a esa hora exacta (mismo criterio de "mejor ajuste" que la búsqueda
// normal, pero acotado a un único instante en vez de barrer el día entero). Pasa por
// encima de atadura, cupo y franja horaria a propósito — nunca pasa por encima de:
// sillón físicamente libre a esa hora, bloqueos vigentes, ni el horario de
// apertura/cierre de la sede (eso se valida ANTES de intentar nada, sede por sede).
//
// soloBackup (Frente 3 combinado con Frente 2): si viene en true, restringe la
// búsqueda de sillón al tipo "backup" en vez del pool regular — mismo criterio que
// soloSillonTipo en buscarHuecos().
async function buscarSillonHorarioFijo(
  medicoId, obraSocialPaciente, duracionMinutos, fechaISOFija, horaInicioString,
  medicosCacheLectura, sedesCacheLectura, turnosExistentes, sedeIdManual,
  bloqueosCacheLectura, soloBackup
) {
  try {
    const sedesABuscar = sedeIdManual
      ? [sedeIdManual]
      : await determinarSedesABuscar(medicoId, obraSocialPaciente, medicosCacheLectura);

    if (sedesABuscar.length === 0) {
      return { exito: false, motivo: "sinSede" };
    }

    const horaInicioMinutos = minutoDesdeString(horaInicioString);
    const horaFinMinutos = horaInicioMinutos + duracionMinutos;
    let huboSedeConHorarioValido = false;
    let primeraSedeConHorarioValido = null;

    // Se prueban TODAS las sedes candidatas (no se corta en la primera): con horario
    // manual, quien carga ya sabe qué sede quiere — esto solo importa para el caso
    // Occhipinti/médicos con más de una sede posible.
    for (const sedeId of sedesABuscar) {
      const sedeDoc = sedesCacheLectura.find(s => s.id === sedeId);
      if (!sedeDoc) continue;

      const horaAperturaMinutos = minutoDesdeString(sedeDoc.horaApertura);
      const horaCierreMinutos = minutoDesdeString(sedeDoc.horaCierre);

      if (horaInicioMinutos < horaAperturaMinutos || horaFinMinutos > horaCierreMinutos) {
        continue; // fuera del horario de esta sede — probar la siguiente candidata, si hay
      }
      huboSedeConHorarioValido = true;
      if (!primeraSedeConHorarioValido) primeraSedeConHorarioValido = sedeId;

      const sillones = (sedeDoc.sillones || [])
        .filter(s => soloBackup ? s.tipo === "backup" : s.tipo === "regular")
        .map(s => s.numero);

      const turnosDelDiaReales = turnosExistentes.filter(t =>
        t.sedeId === sedeId && t.fecha === fechaISOFija &&
        typeof t.horarioInicio === "string" && typeof t.horarioFin === "string"
      );
      const turnosDelDia = bloqueosCacheLectura
        ? [...turnosDelDiaReales, ...pseudoTurnosBloqueoEnFecha(
            bloqueosCacheLectura, sedeId, fechaISOFija, sillones, sedeDoc.horaApertura, sedeDoc.horaCierre
          )]
        : turnosDelDiaReales;

      // "Mejor ajuste" para un único instante: mismo criterio que la búsqueda continua
      // de evaluarDiaEnSede, pero probando solo este minuto en cada sillón en vez de
      // recorrer todo el día.
      let mejorSillon = null;
      let mejorTiempoDesaprovechado = Infinity;
      for (const sillon of sillones) {
        const tieneConflicto = turnosDelDia.some(t => {
          if (t.sillon !== sillon) return false;
          const inicio = minutoDesdeString(t.horarioInicio);
          const fin = minutoDesdeString(t.horarioFin);
          return horaInicioMinutos < fin && horaFinMinutos > inicio;
        });
        if (tieneConflicto) continue;

        const proximosInicioEnEsteSillon = turnosDelDia
          .filter(t => t.sillon === sillon)
          .map(t => minutoDesdeString(t.horarioInicio))
          .filter(inicio => inicio >= horaFinMinutos);
        const proximoEvento = proximosInicioEnEsteSillon.length > 0
          ? Math.min(...proximosInicioEnEsteSillon)
          : horaCierreMinutos;
        const tiempoDesaprovechado = proximoEvento - horaFinMinutos;

        if (tiempoDesaprovechado < mejorTiempoDesaprovechado) {
          mejorTiempoDesaprovechado = tiempoDesaprovechado;
          mejorSillon = sillon;
        }
      }

      if (mejorSillon != null) {
        return {
          exito: true,
          hueco: {
            sedeId, sedeNombre: sedeDoc.nombre, fecha: fechaISOFija,
            fechaLegible: formatearFechaLegibleMotor(fechaDesdeISO(fechaISOFija)),
            horaInicio: horaInicioString, horaFin: stringDesdeMinuto(horaFinMinutos),
            sillon: mejorSillon
          }
        };
      }
    }

    if (!huboSedeConHorarioValido) {
      return { exito: false, motivo: "horarioFueraDeSede", sedeId: sedesABuscar[0] || null };
    }
    return { exito: false, motivo: "sinSillon", sedeId: primeraSedeConHorarioValido };
  } catch (error) {
    console.error("Error en buscarSillonHorarioFijo:", error);
    return { exito: false, motivo: "error", error: error.message };
  }
}

// --- Para testeo en consola ---
// Exportar funciones si estamos en Node (para testing), pero evitar errores en navegador
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buscarHuecos,
    determinarSedesABuscar,
    buscarHuecosEnSede,
    buscarHuecosSemanaEnSede,
    evaluarDiaEnSede,
    diasBloqueadosPorPaciente,
    encontrarPrimerHuecoFisico,
    bloqueoVigenteEnFecha,
    pseudoTurnosBloqueoEnFecha,
    validarHuecoEspecificoEnSede,
    validarModificacionTurno,
    buscarSillonHorarioFijo,
    minutoDesdeString,
    stringDesdeMinuto,
    fechaDesdeISO,
    fechaISO,
    formatearFechaLegible: formatearFechaLegibleMotor,
    calcularBloqueSobreturno,
    GRANO_MINUTOS,
    TOPE_DIAS_BUSQUEDA,
    TIPO_SOBRETURNO_CUPO,
    TIPO_SOBRETURNO_SIN_DISPONIBILIDAD,
    TIPO_SOBRETURNO_ATADURA,
    TIPO_SOBRETURNO_FRANJA
  };
}
