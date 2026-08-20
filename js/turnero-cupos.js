// Lógica de la pantalla "Cupos por porcentaje" del módulo de Turnero (etapa T0).
// Colección "turneroCupos", ID de documento = día de la semana ("lunes"..."viernes").
// Solo aplica a Emilio Civit (ver punto 9 del alcance). Depende de "turneroMedicos" para
// saber qué médicos atienden cada día en esa sede.
// Pantalla exclusiva de administrador (ver punto 16 del alcance de Turnero).

const DIAS_SEMANA_CUPOS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const DIAS_LABEL_CUPOS = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes"
};
const SEDE_CIVIT_CUPOS = "Emilio Civit";

// Ejemplo de referencia del punto 9 del alcance, usando los mismos IDs de médico
// que "turnero-medicos.js" (slug del nombre).
const CUPOS_INICIALES = {
  lunes: { occhipinti: 60, mamani: 40 },
  martes: { occhipinti: 85, salomon: 15 },
  miercoles: { occhipinti: 100 },
  jueves: { vega: 50, tortosa: 30, occhipinti: 20 },
  viernes: { occhipinti: 50, vega: 50 }
};

let medicosCacheCupos = [];
let cuposCache = {};

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

  const hayMedicosEnCivit = medicosCacheCupos.some(
    m => (m.diasPorSede && m.diasPorSede[SEDE_CIVIT_CUPOS] || []).length > 0
  );

  if (!hayMedicosEnCivit) {
    document.getElementById("bloque-sin-medicos").style.display = "block";
    return;
  }

  document.getElementById("boton-cargar-seed").addEventListener("click", cargarSeedCupos);
  cargarCupos();
}

async function cargarCupos() {
  try {
    const snapshot = await db.collection("turneroCupos").get();
    cuposCache = {};
    snapshot.docs.forEach(doc => { cuposCache[doc.id] = doc.data(); });

    if (snapshot.empty) {
      document.getElementById("bloque-seed").style.display = "block";
      document.getElementById("contenedor-cupos").innerHTML = "";
      return;
    }

    document.getElementById("bloque-seed").style.display = "none";
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
      batch.set(db.collection("turneroCupos").doc(dia), {
        sede: SEDE_CIVIT_CUPOS,
        cupos: CUPOS_INICIALES[dia] || {}
      });
    });
    await batch.commit();
    mostrarMensajeCupos("Cupos cargados con los porcentajes de referencia. Revisalos y ajustá lo que haga falta.", "exito");
    cargarCupos();
  } catch (error) {
    console.error("Error al cargar cupos iniciales:", error);
    mostrarMensajeCupos("No se pudieron cargar los cupos iniciales.", "error");
    boton.disabled = false;
    boton.textContent = "Cargar cupos de referencia";
  }
}

function medicosDelDia(dia) {
  return medicosCacheCupos
    .filter(m => (m.diasPorSede && m.diasPorSede[SEDE_CIVIT_CUPOS] || []).includes(dia))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

function renderizarCupos() {
  const contenedor = document.getElementById("contenedor-cupos");

  contenedor.innerHTML = DIAS_SEMANA_CUPOS.map(dia => {
    const medicos = medicosDelDia(dia);
    if (medicos.length === 0) {
      return `
        <div class="tarjeta-sede">
          <h3 style="margin:0 0 8px;">${DIAS_LABEL_CUPOS[dia]}</h3>
          <p style="color:var(--color-muted); font-size:13px; margin:0;">Ningún médico atiende Emilio Civit este día.</p>
        </div>
      `;
    }

    const valores = (cuposCache[dia] && cuposCache[dia].cupos) || {};
    const filas = medicos.map(m => `
      <div class="fila-2" style="align-items:center; margin-bottom:8px;">
        <span>${escaparHtml(m.nombre)}</span>
        <div>
          <input type="number" class="input-porcentaje" min="0" max="100"
            id="cupo-${dia}-${m.id}" value="${valores[m.id] != null ? valores[m.id] : 0}"
            oninput="actualizarSumaCupos('${dia}')" /> %
        </div>
      </div>
    `).join("");

    return `
      <div class="tarjeta-sede">
        <div class="tarjeta-sede-encabezado">
          <h3>${DIAS_LABEL_CUPOS[dia]}</h3>
          <span id="suma-${dia}" class="resumen-suma"></span>
        </div>
        ${filas}
        <button type="button" class="boton-secundario" style="margin-top:8px;" onclick="guardarCupos('${dia}')">Guardar ${DIAS_LABEL_CUPOS[dia]}</button>
      </div>
    `;
  }).join("");

  DIAS_SEMANA_CUPOS.forEach(dia => actualizarSumaCupos(dia));
}

function actualizarSumaCupos(dia) {
  const medicos = medicosDelDia(dia);
  const spanSuma = document.getElementById(`suma-${dia}`);
  if (!spanSuma) return;

  const suma = medicos.reduce((acc, m) => {
    const input = document.getElementById(`cupo-${dia}-${m.id}`);
    return acc + (input ? Number(input.value) || 0 : 0);
  }, 0);

  spanSuma.textContent = `Suma: ${suma}%`;
  spanSuma.className = "resumen-suma " + (suma === 100 ? "ok" : "error");
}

async function guardarCupos(dia) {
  const medicos = medicosDelDia(dia);
  const cupos = {};
  let suma = 0;

  medicos.forEach(m => {
    const input = document.getElementById(`cupo-${dia}-${m.id}`);
    const valor = Number(input.value) || 0;
    cupos[m.id] = valor;
    suma += valor;
  });

  if (suma !== 100) {
    mostrarMensajeCupos(`Los porcentajes de ${DIAS_LABEL_CUPOS[dia]} suman ${suma}%, tienen que sumar 100% para poder guardar.`, "error");
    return;
  }

  try {
    await db.collection("turneroCupos").doc(dia).set({ sede: SEDE_CIVIT_CUPOS, cupos });
    cuposCache[dia] = { sede: SEDE_CIVIT_CUPOS, cupos };
    mostrarMensajeCupos(`Cupos de ${DIAS_LABEL_CUPOS[dia]} guardados.`, "exito");
  } catch (error) {
    console.error("Error al guardar cupos:", error);
    mostrarMensajeCupos("No se pudieron guardar los cupos.", "error");
  }
}
