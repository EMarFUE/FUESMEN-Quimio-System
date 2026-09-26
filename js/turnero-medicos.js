// Lógica de la pantalla "Médicos" del módulo de Turnero (etapa T0).
// Colección "turneroMedicos", ID de documento = slug del nombre ("occhipinti", "albornoz", etc.).
// Pantalla exclusiva de administrador (ver punto 16 del alcance de Turnero).
//
// Lista fija de médicos (mismos seis nombres del selector de la etapa T1, más "Otro"
// como opción aparte que no es un médico cargado acá). El campo diasPorSede guarda,
// para cada sede, en qué días de la semana atiende ese médico.

const DIAS_SEMANA_MEDICOS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const SEDE_CIVIT = "Emilio Civit";
const SEDE_ENTRE_RIOS = "Entre Ríos";
// Etapa 1 del plan post-integración: único médico cuyo orden de sedes lo decide el
// sistema, y por lo tanto el único que tiene excepción temporal de sede.
const MEDICO_EXCEPCION_SEDE_ID = "occhipinti";

// Días de referencia según el ejemplo del punto 9 del alcance (Emilio Civit) y la
// mención de que Albornoz y Occhipinti atienden Entre Ríos los cinco días.
const MEDICOS_INICIALES = [
  { id: "occhipinti", nombre: "Occhipinti", diasPorSede: { [SEDE_CIVIT]: [...DIAS_SEMANA_MEDICOS], [SEDE_ENTRE_RIOS]: [...DIAS_SEMANA_MEDICOS] } },
  { id: "albornoz", nombre: "Albornoz", diasPorSede: { [SEDE_CIVIT]: [], [SEDE_ENTRE_RIOS]: [...DIAS_SEMANA_MEDICOS] } },
  { id: "mamani", nombre: "Mamani", diasPorSede: { [SEDE_CIVIT]: ["lunes"], [SEDE_ENTRE_RIOS]: [] } },
  { id: "salomon", nombre: "Salomón", diasPorSede: { [SEDE_CIVIT]: ["martes"], [SEDE_ENTRE_RIOS]: [] } },
  { id: "vega", nombre: "Vega", diasPorSede: { [SEDE_CIVIT]: ["jueves", "viernes"], [SEDE_ENTRE_RIOS]: [] } },
  { id: "tortosa", nombre: "Tortosa", diasPorSede: { [SEDE_CIVIT]: ["jueves"], [SEDE_ENTRE_RIOS]: [] } }
];

let medicosCache = [];

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// Quita tildes, espacios extra y pasa a minúscula. Mismo criterio que medicamentos.js
// y turnero-protocolos.js, usado acá para generar el ID de documento del médico nuevo.
function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function slugMedico(nombre) {
  return normalizarTexto(nombre).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function mostrarMensajeMedicos(texto, tipo) {
  const contenedor = document.getElementById("mensaje-medicos");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

function iniciarMedicos() {
  document.getElementById("boton-cargar-seed").addEventListener("click", cargarSeedMedicos);
  document.getElementById("form-nuevo-medico").addEventListener("submit", onAgregarMedico);
  cargarMedicos();
}

async function onAgregarMedico(evento) {
  evento.preventDefault();
  const input = document.getElementById("input-nombre-medico");
  const nombre = input.value.trim();

  if (!nombre) {
    mostrarMensajeMedicos("El nombre del médico es obligatorio.", "error");
    return;
  }

  const id = slugMedico(nombre);
  if (!id) {
    mostrarMensajeMedicos("Ese nombre no es válido.", "error");
    return;
  }
  if (medicosCache.some(m => m.id === id)) {
    mostrarMensajeMedicos("Ya existe un médico con ese nombre.", "error");
    return;
  }

  try {
    await db.collection("turneroMedicos").doc(id).set({
      nombre,
      diasPorSede: { [SEDE_CIVIT]: [], [SEDE_ENTRE_RIOS]: [] }
    });
    input.value = "";
    mostrarMensajeMedicos(`Médico agregado. Tildá sus días en las tablas de abajo.`, "exito");
    cargarMedicos();
  } catch (error) {
    console.error("Error al agregar médico:", error);
    mostrarMensajeMedicos("No se pudo agregar el médico.", "error");
  }
}

async function cargarMedicos() {
  try {
    const snapshot = await db.collection("turneroMedicos").get();
    medicosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (medicosCache.length === 0) {
      document.getElementById("bloque-seed").style.display = "block";
      document.getElementById("bloque-tabla").style.display = "none";
      return;
    }

    medicosCache.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    document.getElementById("bloque-seed").style.display = "none";
    document.getElementById("bloque-tabla").style.display = "block";
    renderizarTablas();
  } catch (error) {
    console.error("Error al cargar médicos:", error);
    mostrarMensajeMedicos("No se pudieron cargar los médicos.", "error");
  }
}

async function cargarSeedMedicos() {
  const boton = document.getElementById("boton-cargar-seed");
  boton.disabled = true;
  boton.textContent = "Cargando...";

  try {
    const batch = db.batch();
    MEDICOS_INICIALES.forEach(medico => {
      const { id, ...datos } = medico;
      batch.set(db.collection("turneroMedicos").doc(id), datos);
    });
    await batch.commit();
    mostrarMensajeMedicos("Médicos cargados con los días de referencia. Revisalos y ajustá lo que haga falta.", "exito");
    cargarMedicos();
  } catch (error) {
    console.error("Error al cargar médicos iniciales:", error);
    mostrarMensajeMedicos("No se pudieron cargar los médicos iniciales.", "error");
    boton.disabled = false;
    boton.textContent = "Cargar médicos de referencia";
  }
}

function renderizarTablas() {
  renderizarTablaSede(SEDE_CIVIT, "cuerpo-tabla-medicos-civit");
  renderizarTablaSede(SEDE_ENTRE_RIOS, "cuerpo-tabla-medicos-entrerios");
  renderizarTablaHabilitados();
  renderizarTablaFranjaHoraria();
  renderizarBloqueExcepcionSede();
}

// Etapa 1 del plan post-integración: excepción temporal de sede para Occhipinti. Es el
// único médico con orden de sedes calculado por el sistema (Entre Ríos primero, Emilio
// Civit como segunda opción — ver determinarSedesABuscar() en turnero-motor.js), así que
// el bloque se muestra solo para él y no como columna de la tabla general.
// Prendida: la búsqueda automática va directo a Emilio Civit y Entre Ríos queda afuera
// por completo. Los pacientes con obra social POP no se ven afectados (ya iban siempre a
// Emilio Civit). Ausente en el documento = apagada.
function renderizarBloqueExcepcionSede() {
  const contenedor = document.getElementById("bloque-excepcion-sede-occhipinti");
  if (!contenedor) return;

  const occhipinti = medicosCache.find(m => m.id === MEDICO_EXCEPCION_SEDE_ID);
  if (!occhipinti) {
    contenedor.innerHTML = `<p style="color:var(--color-muted);font-size:13px;">
      El médico Occhipinti no está cargado en el catálogo.</p>`;
    return;
  }

  const activa = occhipinti.excepcionSedeDirectaCivit === true;
  contenedor.innerHTML = `
    <label class="check-linea">
      <input type="checkbox" ${activa ? "checked" : ""}
        onchange="onCambiarExcepcionSede(this.checked)" />
      <span>Buscar directo en Emilio Civit (saltear Entre Ríos)</span>
    </label>
    <p style="color:var(--color-muted); font-size:13px; margin:6px 0 0;">
      ${activa
        ? "Excepción ACTIVA. Acordate de apagarla cuando deje de hacer falta."
        : "Excepción apagada: se usa el orden de siempre (Entre Ríos y, si no hay lugar, Emilio Civit)."}
    </p>`;
}

async function onCambiarExcepcionSede(activa) {
  const occhipinti = medicosCache.find(m => m.id === MEDICO_EXCEPCION_SEDE_ID);
  if (!occhipinti) return;

  try {
    await db.collection("turneroMedicos").doc(MEDICO_EXCEPCION_SEDE_ID)
      .update({ excepcionSedeDirectaCivit: activa });
    occhipinti.excepcionSedeDirectaCivit = activa;
    mostrarMensajeMedicos(
      activa
        ? "Excepción activada: los turnos de Occhipinti se buscan directo en Emilio Civit."
        : "Excepción desactivada: vuelve el orden de siempre (Entre Ríos primero).",
      "exito"
    );
  } catch (error) {
    console.error("Error al actualizar la excepción de sede:", error);
    mostrarMensajeMedicos("No se pudo guardar el cambio.", "error");
  }
  // Se re-renderiza siempre: si falló, revierte el checkbox visualmente; si salió bien,
  // actualiza la leyenda de abajo.
  renderizarBloqueExcepcionSede();
}

// Permiso nuevo (feedback post-Fase 3 del Turnero): habilita o deshabilita que ESE
// médico, con su propio usuario de rol médico, pueda cargar turnos nuevos o arrastrar
// los suyos en la agenda. No afecta a enfermería/administrador, que siempre pueden
// cargar y mover turnos de cualquier médico — es una restricción sobre el login del
// médico puntual, no sobre el médico como entidad del catálogo. Ausente en el
// documento = habilitado (no hace falta migrar a los médicos ya cargados).
function renderizarTablaHabilitados() {
  const tbody = document.getElementById("cuerpo-tabla-medicos-habilitado");
  if (!tbody) return;
  tbody.innerHTML = medicosCache.map(medico => {
    const habilitado = medico.habilitadoParaCargar !== false;
    return `<tr>
      <td>${escaparHtml(medico.nombre)}</td>
      <td>
        <input type="checkbox" ${habilitado ? "checked" : ""}
          onchange="onCambiarHabilitado('${medico.id}', this.checked)" />
      </td>
    </tr>`;
  }).join("");
}

async function onCambiarHabilitado(medicoId, habilitado) {
  const medico = medicosCache.find(m => m.id === medicoId);
  if (!medico) return;

  try {
    await db.collection("turneroMedicos").doc(medicoId).update({ habilitadoParaCargar: habilitado });
    medico.habilitadoParaCargar = habilitado;
    mostrarMensajeMedicos(
      habilitado ? "Médico habilitado para cargar y modificar turnos." : "Médico deshabilitado. Sus turnos ya cargados quedan congelados salvo que enfermería o un administrador los mueva.",
      "exito"
    );
  } catch (error) {
    console.error("Error al actualizar el permiso del médico:", error);
    mostrarMensajeMedicos("No se pudo guardar el cambio.", "error");
    renderizarTablaHabilitados(); // revertir el checkbox visualmente si falló el guardado
  }
}

// Ronda "mejoras motor" (post T12), Frente 1: franja horaria propia — restringe la
// búsqueda automática a un rango horario del médico (Vega, Tortosa, Salomón, aunque no
// es exclusiva de ellos). Solo acota dónde puede EMPEZAR el turno, nunca dónde debe
// terminar (ver evaluarDiaEnSede() en turnero-motor.js). Ausente = sin restricción, no
// afecta a ningún médico existente.
function renderizarTablaFranjaHoraria() {
  const tbody = document.getElementById("cuerpo-tabla-medicos-franja");
  if (!tbody) return;
  tbody.innerHTML = medicosCache.map(medico => {
    const franja = medico.franjaHoraria || {};
    return `<tr>
      <td>${escaparHtml(medico.nombre)}</td>
      <td><input type="time" id="franja-inicio-${medico.id}" value="${franja.horaInicio || ""}"
            onchange="onCambiarFranjaHoraria('${medico.id}')" /></td>
      <td><input type="time" id="franja-fin-${medico.id}" value="${franja.horaFin || ""}"
            onchange="onCambiarFranjaHoraria('${medico.id}')" /></td>
      <td>${franja.horaInicio && franja.horaFin
        ? `<button type="button" class="enlace-accion peligro" onclick="onQuitarFranjaHoraria('${medico.id}')">quitar</button>`
        : ""}</td>
    </tr>`;
  }).join("");
}

async function onCambiarFranjaHoraria(medicoId) {
  const medico = medicosCache.find(m => m.id === medicoId);
  if (!medico) return;

  const inputInicio = document.getElementById(`franja-inicio-${medicoId}`);
  const inputFin = document.getElementById(`franja-fin-${medicoId}`);
  const horaInicio = inputInicio ? inputInicio.value : "";
  const horaFin = inputFin ? inputFin.value : "";

  // Se espera a que los dos campos estén completos antes de guardar nada — si se tocó
  // solo uno, no hay franja válida todavía (y si se vació uno de los dos habiendo
  // franja previa, se interpreta como "quitar", más abajo).
  if (!horaInicio && !horaFin) return;
  if (!horaInicio || !horaFin) {
    if (medico.franjaHoraria) await quitarFranjaHoraria(medicoId);
    return;
  }

  if (horaInicio >= horaFin) {
    mostrarMensajeMedicos("La hora de inicio tiene que ser anterior a la de fin.", "error");
    renderizarTablaFranjaHoraria();
    return;
  }

  try {
    await db.collection("turneroMedicos").doc(medicoId).update({
      franjaHoraria: { horaInicio, horaFin }
    });
    medico.franjaHoraria = { horaInicio, horaFin };
    mostrarMensajeMedicos("Franja horaria actualizada.", "exito");
    renderizarTablaFranjaHoraria();
  } catch (error) {
    console.error("Error al actualizar la franja horaria:", error);
    mostrarMensajeMedicos("No se pudo guardar el cambio.", "error");
    renderizarTablaFranjaHoraria();
  }
}

async function onQuitarFranjaHoraria(medicoId) {
  await quitarFranjaHoraria(medicoId);
}

async function quitarFranjaHoraria(medicoId) {
  const medico = medicosCache.find(m => m.id === medicoId);
  if (!medico) return;

  try {
    await db.collection("turneroMedicos").doc(medicoId).update({
      franjaHoraria: firebase.firestore.FieldValue.delete()
    });
    delete medico.franjaHoraria;
    mostrarMensajeMedicos("Franja horaria quitada: el médico vuelve a no tener restricción de horario.", "exito");
    renderizarTablaFranjaHoraria();
  } catch (error) {
    console.error("Error al quitar la franja horaria:", error);
    mostrarMensajeMedicos("No se pudo guardar el cambio.", "error");
    renderizarTablaFranjaHoraria();
  }
}

function renderizarTablaSede(sede, idTbody) {
  const tbody = document.getElementById(idTbody);

  tbody.innerHTML = medicosCache.map(medico => {
    const dias = (medico.diasPorSede && medico.diasPorSede[sede]) || [];
    const celdas = DIAS_SEMANA_MEDICOS.map(dia => `
      <td>
        <input type="checkbox" ${dias.includes(dia) ? "checked" : ""}
          onchange="onCambiarDia('${medico.id}', '${sede}', '${dia}', this.checked)" />
      </td>
    `).join("");
    return `<tr><td>${escaparHtml(medico.nombre)}</td>${celdas}</tr>`;
  }).join("");
}

async function onCambiarDia(medicoId, sede, dia, marcado) {
  const medico = medicosCache.find(m => m.id === medicoId);
  if (!medico) return;

  const diasActuales = new Set((medico.diasPorSede && medico.diasPorSede[sede]) || []);
  if (marcado) {
    diasActuales.add(dia);
  } else {
    diasActuales.delete(dia);
  }

  const nuevosDiasPorSede = { ...(medico.diasPorSede || {}), [sede]: Array.from(diasActuales) };

  try {
    await db.collection("turneroMedicos").doc(medicoId).update({ diasPorSede: nuevosDiasPorSede });
    medico.diasPorSede = nuevosDiasPorSede;
    mostrarMensajeMedicos("Actualizado.", "exito");
  } catch (error) {
    console.error("Error al actualizar días del médico:", error);
    mostrarMensajeMedicos("No se pudo guardar el cambio.", "error");
    cargarMedicos();
  }
}
