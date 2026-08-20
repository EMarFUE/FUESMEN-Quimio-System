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
