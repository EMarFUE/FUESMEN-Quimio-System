// Lógica de la pantalla "Cupos por porcentaje" del módulo de Turnero (etapa T0).
// Colección "turneroCupos", ID de documento = "<slug-sede>-<dia>" (ej. "emilio-civit-lunes").
// Depende de "turneroMedicos" para saber qué médicos atienden cada sede/día.
// Pantalla exclusiva de administrador (ver punto 16 del alcance de Turnero).
//
// Nota de alcance: el motor de turnos (etapas T3/T4) hoy solo va a leer y aplicar cupos
// de Emilio Civit, porque el alcance del módulo dice explícitamente que Entre Ríos no
// tiene atadura de día ni cupo por porcentaje. Esta pantalla permite igual cargar una
// configuración de cupos para Entre Ríos, por si en el futuro se decide usarla — hasta
// que esa decisión se tome explícitamente, cualquier cupo de Entre Ríos queda guardado
// pero sin efecto real sobre la carga de turnos.

const DIAS_SEMANA_CUPOS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const DIAS_LABEL_CUPOS = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes"
};
const SEDES_CUPOS = [
  { id: "emilio-civit", nombre: "Emilio Civit" },
  { id: "entre-rios", nombre: "Entre Ríos" }
];
const SEDE_ID_CIVIT = "emilio-civit";

function nombreSede(sedeId) {
  const sede = SEDES_CUPOS.find(s => s.id === sedeId);
  return sede ? sede.nombre : sedeId;
}

function idCupo(sedeId, dia) {
  return `${sedeId}-${dia}`;
}

// Ejemplo de referencia del punto 9 del alcance (Emilio Civit únicamente), usando los
// mismos IDs de médico que "turnero-medicos.js" (slug del nombre).
const CUPOS_INICIALES_CIVIT = {
  lunes: { occhipinti: 60, mamani: 40 },
  martes: { occhipinti: 85, salomon: 15 },
  miercoles: { occhipinti: 100 },
  jueves: { vega: 50, tortosa: 30, occhipinti: 20 },
  viernes: { occhipinti: 50, vega: 50 }
};

let medicosCacheCupos = [];
let cuposCache = {};        // id -> { sedeId, dia, cupos: {medicoId: porcentaje} }, ya guardados en Firestore
let combosPendientes = [];  // [{sedeId, dia}] agregados en esta sesión y todavía no guardados

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function mostrarMensajeCupos(texto, tipo) {
  const contenedor = document.getElementById("mensaje-cupos");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

async function iniciarCupos() {
  try {
    const snapshotMedicos = await db.collection("turneroMedicos").get();
    medicosCacheCupos = snapshotMedicos.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error al cargar médicos:", error);
    mostrarMensajeCupos("No se pudieron cargar los médicos.", "error");
    return;
  }

  const hayMedicosConDias = medicosCacheCupos.some(m =>
    SEDES_CUPOS.some(s => ((m.diasPorSede && m.diasPorSede[s.nombre]) || []).length > 0)
  );

  if (!hayMedicosConDias) {
    document.getElementById("bloque-sin-medicos").style.display = "block";
    return;
  }

  document.getElementById("bloque-agregar").style.display = "block";
  document.getElementById("boton-cargar-seed").addEventListener("click", cargarSeedCupos);
  document.getElementById("form-agregar-cupo").addEventListener("submit", onAgregarCupo);
  cargarCupos();
}

async function cargarCupos() {
  try {
    const snapshot = await db.collection("turneroCupos").get();
    cuposCache = {};
    snapshot.docs.forEach(doc => { cuposCache[doc.id] = doc.data(); });

    // El botón de datos de referencia solo tiene sentido si todavía no hay ningún cupo
    // guardado en ninguna sede (para no pisar configuraciones ya cargadas).
    document.getElementById("bloque-seed").style.display = Object.keys(cuposCache).length === 0 ? "block" : "none";

    renderizarCupos();
  } catch (error) {
    console.error("Error al cargar cupos:", error);
    mostrarMensajeCupos("No se pudieron cargar los cupos.", "error");
  }
}

async function cargarSeedCupos() {
  const boton = document.getElementById("boton-cargar-seed");
  boton.disabled = true;
  boton.textContent = "Cargando...";

  try {
    const batch = db.batch();
    DIAS_SEMANA_CUPOS.forEach(dia => {
      batch.set(db.collection("turneroCupos").doc(idCupo(SEDE_ID_CIVIT, dia)), {
        sedeId: SEDE_ID_CIVIT,
        dia,
        cupos: CUPOS_INICIALES_CIVIT[dia] || {}
      });
    });
    await batch.commit();
    mostrarMensajeCupos("Cupos de Emilio Civit cargados con los porcentajes de referencia. Revisalos y ajustá lo que haga falta.", "exito");
    cargarCupos();
  } catch (error) {
    console.error("Error al cargar cupos iniciales:", error);
    mostrarMensajeCupos("No se pudieron cargar los cupos iniciales.", "error");
    boton.disabled = false;
    boton.textContent = "Cargar cupos de referencia (Emilio Civit)";
  }
}

function onAgregarCupo(evento) {
  evento.preventDefault();
  const sedeId = document.getElementById("select-sede-cupo").value;
  const dia = document.getElementById("select-dia-cupo").value;
  const id = idCupo(sedeId, dia);

  if (cuposCache[id]) {
    mostrarMensajeCupos(`Ya existe una configuración de cupos para ${nombreSede(sedeId)} · ${DIAS_LABEL_CUPOS[dia]}. La tenés más abajo.`, "info");
    return;
  }
  if (combosPendientes.some(c => idCupo(c.sedeId, c.dia) === id)) {
    mostrarMensajeCupos("Esa combinación de sede y día ya está agregada más abajo.", "info");
    return;
  }

  combosPendientes.push({ sedeId, dia });
  renderizarCupos();
}

function medicosDeCombo(sedeId, dia) {
  const sede = nombreSede(sedeId);
  return medicosCacheCupos
    .filter(m => (m.diasPorSede && m.diasPorSede[sede] || []).includes(dia))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

function renderizarCupos() {
  const contenedor = document.getElementById("contenedor-cupos");

  // Combos a mostrar: todos los ya guardados, más los agregados en esta sesión que
  // todavía no se guardaron (sin duplicar si ya coinciden).
  const combos = Object.keys(cuposCache).map(id => ({ sedeId: cuposCache[id].sedeId, dia: cuposCache[id].dia }));
  combosPendientes.forEach(c => {
    if (!combos.some(existente => idCupo(existente.sedeId, existente.dia) === idCupo(c.sedeId, c.dia))) {
      combos.push(c);
    }
  });

  // Orden: sede (Emilio Civit primero), después día de la semana.
  combos.sort((a, b) => {
    if (a.sedeId !== b.sedeId) return a.sedeId === SEDE_ID_CIVIT ? -1 : 1;
    return DIAS_SEMANA_CUPOS.indexOf(a.dia) - DIAS_SEMANA_CUPOS.indexOf(b.dia);
  });

  if (combos.length === 0) {
    contenedor.innerHTML = `<p style="color:var(--color-muted); font-size:13px;">Todavía no hay ninguna configuración de cupos. Usá "Agregar cupo" para empezar.</p>`;
    return;
  }

  contenedor.innerHTML = combos.map(({ sedeId, dia }) => {
    const id = idCupo(sedeId, dia);
    const medicos = medicosDeCombo(sedeId, dia);
    const titulo = `${nombreSede(sedeId)} · ${DIAS_LABEL_CUPOS[dia]}`;

    if (medicos.length === 0) {
      return `
        <div class="tarjeta-sede">
          <h3 style="margin:0 0 8px;">${titulo}</h3>
          <p style="color:var(--color-muted); font-size:13px; margin:0;">Ningún médico tiene ese día cargado en esta sede todavía.</p>
        </div>
      `;
    }

    const valores = (cuposCache[id] && cuposCache[id].cupos) || {};
    const filas = medicos.map(m => `
      <div class="fila-2" style="align-items:center; margin-bottom:8px;">
        <span>${escaparHtml(m.nombre)}</span>
        <div>
          <input type="number" class="input-porcentaje" min="0" max="100"
            id="cupo-${id}-${m.id}" value="${valores[m.id] != null ? valores[m.id] : 0}"
            oninput="actualizarSumaCupos('${sedeId}', '${dia}')" /> %
        </div>
      </div>
    `).join("");

    return `
      <div class="tarjeta-sede">
        <div class="tarjeta-sede-encabezado">
          <h3>${titulo}</h3>
          <span id="suma-${id}" class="resumen-suma"></span>
        </div>
        ${filas}
        <button type="button" class="boton-secundario" style="margin-top:8px;" onclick="guardarCupos('${sedeId}', '${dia}')">Guardar ${titulo}</button>
      </div>
    `;
  }).join("");

  combos.forEach(({ sedeId, dia }) => actualizarSumaCupos(sedeId, dia));
}

function actualizarSumaCupos(sedeId, dia) {
  const id = idCupo(sedeId, dia);
  const medicos = medicosDeCombo(sedeId, dia);
  const spanSuma = document.getElementById(`suma-${id}`);
  if (!spanSuma) return;

  const suma = medicos.reduce((acc, m) => {
    const input = document.getElementById(`cupo-${id}-${m.id}`);
    return acc + (input ? Number(input.value) || 0 : 0);
  }, 0);

  spanSuma.textContent = `Suma: ${suma}%`;
  spanSuma.className = "resumen-suma " + (suma === 100 ? "ok" : "error");
}

async function guardarCupos(sedeId, dia) {
  const id = idCupo(sedeId, dia);
  const medicos = medicosDeCombo(sedeId, dia);
  const cupos = {};
  let suma = 0;

  medicos.forEach(m => {
    const input = document.getElementById(`cupo-${id}-${m.id}`);
    const valor = Number(input.value) || 0;
    cupos[m.id] = valor;
    suma += valor;
  });

  if (suma !== 100) {
    mostrarMensajeCupos(`Los porcentajes de ${nombreSede(sedeId)} · ${DIAS_LABEL_CUPOS[dia]} suman ${suma}%, tienen que sumar 100% para poder guardar.`, "error");
    return;
  }

  try {
    await db.collection("turneroCupos").doc(id).set({ sedeId, dia, cupos });
    cuposCache[id] = { sedeId, dia, cupos };
    combosPendientes = combosPendientes.filter(c => idCupo(c.sedeId, c.dia) !== id);
    mostrarMensajeCupos(`Cupos de ${nombreSede(sedeId)} · ${DIAS_LABEL_CUPOS[dia]} guardados.`, "exito");
  } catch (error) {
    console.error("Error al guardar cupos:", error);
    mostrarMensajeCupos("No se pudieron guardar los cupos.", "error");
  }
}
