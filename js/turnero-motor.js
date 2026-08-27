// Motor de búsqueda de huecos — Etapa T3 del Módulo de Turnero
// Disponibilidad física pura: validación de no superposición, cálculo continuo con bloques
// normalizados (5 minutos internamente), algoritmo de mejor ajuste, respeto de horarios por sede.
// Sin reglas de médico/cupos (eso viene en T4) ni de "Otro" derivante (T5).
//
// Este archivo es completamente independiente de turnero-carga.js. Se integra en el
// formulario desde T3 en adelante, pero mantiene su propia lógica para facilitar
// testeo y reutilización.

const GRANO_MINUTOS = 5; // Grano interno de búsqueda de huecos
const TOPE_DIAS_BUSQUEDA = 10; // Máximo de días a buscar más allá de la fecha solicitada
const SEDE_OCCHIPINTI = "occhipinti";
const OBRA_SOCIAL_POP = "POP - ASOC. COOP HOSP CENTRAL PROG.ESPECIALES";

// --- Estructura de retorno del motor ---
// {
//   exito: bool,
//   huecosEncontrados?: [ // array de huecos válidos, ordenados por mejor ajuste
//     {
//       sedeId: string,
//       sedeNombre: string,
//       fecha: string (ISO),
//       fechaLegible: string,
//       horaInicio: string (HH:MM),
//       horaFin: string (HH:MM),
//       minutoInicioBloqueNormalizado: number, // para cálculos internos
//       duracionMinutos: number,
//       sillon: number,
//       tiempoDesaprovechadoMinutos: number, // métrica de mejor ajuste
//       superaTolerancia: bool // si la fecha es posterior al límite de +10 días
//     },
//     ...
//   ],
//   sinHuecosMotivo?: string, // si exito === false, explicación
//   sedesIntentadas?: [string], // debug: qué sedes se buscaron
//   diasBuscados?: number, // debug: cuántos días se recorrieron
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
  // porcentaje), que son Etapa T4 y aplican solo a Emilio Civit.
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

// --- Búsqueda de huecos por sede ---

async function buscarHuecosEnSede(
  sedeId,
  sedeNombre,
  fechaInicioBusqueda, // objeto Date, medianoche
  duracionMinutos,
  horaAperturaString, // "08:00"
  horaCierreString, // "14:00" (no se puede cargar turno a esta hora)
  diasAtencion, // array ["lunes", "martes", ...]
  turnosExistentesEnSede, // array de turnos ya cargados en esta sede
  sillonesDisponibles // array de números de sillones
) {
  // Retorna array de huecos válidos (de mayor a menor ajuste).
  // Busca desde la fecha solicitada hasta +TOPE_DIAS_BUSQUEDA días.

  const huecos = [];
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

    // Verificar si la sede atiende ese día
    if (!diasAtencion.includes(nombreDiaActual)) {
      continue; // No atiende ese día, pasar al siguiente
    }

    // Construir lista de turnos que impactan ese día en esa sede.
    // Se descartan turnos que no tengan horarioInicio/horarioFin como string: son
    // turnos cargados antes de la Etapa T3 (T1/T2), que todavía no tenían estos
    // campos — considerarlos rompería el cálculo de conflictos más abajo.
    const turnosDelDia = turnosExistentesEnSede.filter(turno =>
      turno.fecha === fechaISO(fechaActual) &&
      typeof turno.horarioInicio === "string" &&
      typeof turno.horarioFin === "string"
    );

    // Búsqueda continua: recorrer el horario en bloques de GRANO_MINUTOS
    for (let minutoActual = horaAperturaMinutos; minutoActual + duracionNormalizada <= horaCierreMinutos; minutoActual += GRANO_MINUTOS) {
      // Intentar colocar el bloque [minutoActual, minutoActual + duracionNormalizada)
      // en cada sillón disponible

      for (const sillon of sillonesDisponibles) {
        // Verificar si este sillón está libre en este rango horario
        const tieneConflicto = turnosDelDia.some(turno => {
          if (turno.sillon !== sillon) return false; // Diferente sillón, no hay conflicto

          const minutoInicio = minutoDesdeString(turno.horarioInicio);
          const minutoFin = minutoDesdeString(turno.horarioFin);

          // Conflicto si [minutoActual, minutoActual + duracionNormalizada) se superpone
          // con [minutoInicio, minutoFin)
          return minutoActual < minutoFin && minutoActual + duracionNormalizada > minutoInicio;
        });

        if (!tieneConflicto) {
          // Hueco encontrado. "Mejor ajuste" = cuánto tiempo libre queda entre el fin
          // de este bloque y el próximo evento en el mismo sillón ese día (el siguiente
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
            sedeId,
            sedeNombre,
            fecha: fechaISO(fechaActual),
            fechaLegible: formatearFechaLegibleMotor(fechaActual),
            horaInicio: stringDesdeMinuto(minutoActual),
            horaFin: stringDesdeMinuto(minutoActual + duracionNormalizada),
            minutoInicioBloqueNormalizado: minutoActual,
            duracionMinutos: duracionNormalizada,
            sillon: sillon,
            tiempoDesaprovechadoMinutos: tiempoDesaprovechadoMinutos,
            superaTolerancia: diasDesde > 5 // Si está más allá de 5 días, lo marcamos
          });

          // No seguir buscando más sillones en esta hora para este día
          // (la idea es devolver una opción por cada franja horaria, no múltiples sillones)
          break;
        }
      }
    }

    // Si encontramos al menos un hueco en este día, no buscar más días
    // (criterio: primera fecha posible con hueco)
    if (huecos.length > 0) break;
  }

  // Ordenar por mejor ajuste (menos tiempo desperdiciado)
  huecos.sort((a, b) => a.tiempoDesaprovechadoMinutos - b.tiempoDesaprovechadoMinutos);

  return huecos;
}

// --- Función principal del motor ---

async function buscarHuecos(
  medicoId, // sedeId del médico si es fijo, o "otro"
  obraSocialPaciente, // string, para lógica de Occhipinti
  duracionMinutos, // duración total (protocolos + premedicación)
  fechaSolicitadaISO, // "2026-09-08"
  medicosCacheLectura, // array de docs de turneroMedicos
  sedesCacheLectura, // array de docs de turneroSedes
  turnosExistentes, // array de docs de turnos ya cargados
  esRolMedico, // bool, para determinar qué tipo de sobreturno ofrecer después
  sedeIdManual // string|null — si la persona ya eligió la sede a mano (médico "Otro" o
               // médico que atiende ambas sedes), buscar SOLO ahí, sin recalcular.
) {
  // Retorna la estructura de resultado del motor.

  try {
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
      const sillones = (sedeDoc.sillones || [])
        .filter(s => s.tipo === "regular" || s.tipo === "backup")
        .map(s => s.numero);

      // Filtrar turnos de esta sede
      const turnosEnSede = turnosExistentes.filter(t => t.sedeId === sedeId);

      const huecos = await buscarHuecosEnSede(
        sedeId,
        sedeNombre,
        fechaInicioBusqueda,
        duracionMinutos,
        horaApertura,
        horaCierre,
        diasAtencion,
        turnosEnSede,
        sillones
      );

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

    // No se encontraron huecos
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

// --- Para testeo en consola ---
// Exportar funciones si estamos en Node (para testing), pero evitar errores en navegador
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buscarHuecos,
    determinarSedesABuscar,
    buscarHuecosEnSede,
    minutoDesdeString,
    stringDesdeMinuto,
    fechaDesdeISO,
    fechaISO,
    formatearFechaLegible: formatearFechaLegibleMotor,
    GRANO_MINUTOS,
    TOPE_DIAS_BUSQUEDA
  };
}
