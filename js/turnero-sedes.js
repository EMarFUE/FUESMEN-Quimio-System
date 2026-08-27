// Lógica de la pantalla "Sedes y sillones" del módulo de Turnero (etapa T0).
// Colección "turneroSedes", ID de documento = slug de la sede ("emilio-civit", "entre-rios").
// Pantalla exclusiva de administrador (ver punto 16 del alcance de Turnero).

const DIAS_SEMANA = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const DIAS_LABEL = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles",
  jueves: "Jueves", viernes: "Viernes"
};

// Datos de referencia según "Alcance definitivo - Módulo de Turnero.md", punto 3.
const SEDES_INICIALES = [
  {
    id: "emilio-civit",
    nombre: "Emilio Civit",
    horaApertura: "08:00",
    horaCierre: "14:00",
    diasAtencion: DIAS_SEMANA,
    sabadosEspeciales: true,
    usaCuposPorcentaje: true,
    usaAtaduraDia: true,
    sillones: [
      { numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" },
      { numero: 3, tipo: "regular" }, { numero: 4, tipo: "regular" },
      { numero: 5, tipo: "regular" }, { numero: 6, tipo: "regular" },
      { numero: 7, tipo: "regular" }, { numero: 8, tipo: "regular" },
      { numero: 9, tipo: "regular" }, { numero: 10, tipo: "backup" }
    ]
  },
  {
    id: "entre-rios",
    nombre: "Entre Ríos",
    horaApertura: "07:30",
    horaCierre: "13:30",
    diasAtencion: DIAS_SEMANA,
    sabadosEspeciales: false,
    usaCuposPorcentaje: false,
    usaAtaduraDia: false,
    sillones: [
      { numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" },
      { numero: 3, tipo: "regular" }, { numero: 4, tipo: "regular" },
      { numero: 5, tipo: "regular" }, { numero: 6, tipo: "regular" },
      { numero: 7, tipo: "regular" }, { numero: 8, tipo: "backup" }
    ]
  }
];

let sedesCache = [];

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function mostrarMensajeSedes(texto, tipo) {
  const contenedor = document.getElementById("mensaje-sedes");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

function iniciarSedes() {
  document.getElementById("boton-cargar-seed").addEventListener("click", cargarSeedSedes);
  cargarSedes();
}

async function cargarSedes() {
  const contenedor = document.getElementById("contenedor-sedes");
  contenedor.innerHTML = `<p style="color:var(--color-muted);">Cargando...</p>`;

  try {
    const snapshot = await db.collection("turneroSedes").get();
    sedesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (sedesCache.length === 0) {
      contenedor.innerHTML = "";
      document.getElementById("bloque-seed").style.display = "block";
      return;
    }

    document.getElementById("bloque-seed").style.display = "none";
    // Orden fijo: Emilio Civit primero, después Entre Ríos, sin depender del orden de Firestore.
    sedesCache.sort((a, b) => (a.id === "emilio-civit" ? -1 : 1));
    renderizarSedes();
  } catch (error) {
    console.error("Error al cargar sedes:", error);
    contenedor.innerHTML = `<p style="color:var(--color-danger);">No se pudieron cargar las sedes.</p>`;
  }
}

async function cargarSeedSedes() {
  const boton = document.getElementById("boton-cargar-seed");
  boton.disabled = true;
  boton.textContent = "Cargando...";

  try {
    const batch = db.batch();
    SEDES_INICIALES.forEach(sede => {
      const { id, ...datos } = sede;
      batch.set(db.collection("turneroSedes").doc(id), datos);
    });
    await batch.commit();
    mostrarMensajeSedes("Sedes cargadas con los datos de referencia. Revisalas y ajustá lo que haga falta.", "exito");
    cargarSedes();
  } catch (error) {
    console.error("Error al cargar sedes iniciales:", error);
    mostrarMensajeSedes("No se pudieron cargar las sedes iniciales.", "error");
    boton.disabled = false;
    boton.textContent = "Cargar datos iniciales de referencia";
  }
}

function renderizarSedes() {
  const contenedor = document.getElementById("contenedor-sedes");
  contenedor.innerHTML = sedesCache.map(sede => renderizarTarjetaSede(sede)).join("");

  sedesCache.forEach(sede => {
    document.getElementById(`form-horario-${sede.id}`).addEventListener("submit", (e) => onGuardarHorario(e, sede.id));
    document.getElementById(`check-sabados-${sede.id}`).addEventListener("change", (e) => onCambiarSabados(e, sede.id));
    document.getElementById(`check-cupos-${sede.id}`).addEventListener("change", (e) => onCambiarUsaCupos(e, sede.id));
    document.getElementById(`check-atadura-${sede.id}`).addEventListener("change", (e) => onCambiarUsaAtaduraDia(e, sede.id));
    document.getElementById(`form-sillon-${sede.id}`).addEventListener("submit", (e) => onAgregarSillon(e, sede.id));
  });
}

function renderizarTarjetaSede(sede) {
  const sillonesOrdenados = [...(sede.sillones || [])].sort((a, b) => a.numero - b.numero);
  const chips = sillonesOrdenados.map(s => `
    <span class="chip-sillon ${s.tipo === "backup" ? "backup" : ""}">
      Sillón ${s.numero}${s.tipo === "backup" ? " (backup)" : ""}
      <button type="button" title="Quitar sillón" onclick="quitarSillon('${sede.id}', ${s.numero})">×</button>
    </span>
  `).join("");

  const totalRegulares = sillonesOrdenados.filter(s => s.tipo !== "backup").length;
  const totalBackup = sillonesOrdenados.filter(s => s.tipo === "backup").length;

  return `
    <div class="tarjeta-sede">
      <div class="tarjeta-sede-encabezado">
        <h3>${escaparHtml(sede.nombre)}</h3>
        <span class="badge">${totalRegulares} sillones + ${totalBackup} backup</span>
      </div>

      <form id="form-horario-${sede.id}">
        <div class="fila-horario">
          <div class="campo" style="margin-bottom:0;">
            <label for="apertura-${sede.id}">Hora de apertura</label>
            <input type="time" id="apertura-${sede.id}" value="${escaparHtml(sede.horaApertura)}" required />
          </div>
          <div class="campo" style="margin-bottom:0;">
            <label for="cierre-${sede.id}">Hora de cierre</label>
            <input type="time" id="cierre-${sede.id}" value="${escaparHtml(sede.horaCierre)}" required />
          </div>
          <div class="campo" style="margin-bottom:0; display:flex; align-items:flex-end;">
            <button type="submit" class="boton-secundario">Guardar horario</button>
          </div>
        </div>
      </form>

      <label class="check-linea">
        <input type="checkbox" id="check-sabados-${sede.id}" ${sede.sabadosEspeciales ? "checked" : ""} />
        Atiende algunos sábados como excepción puntual (se habilitan con bloqueos, no por defecto)
      </label>

      <label class="check-linea">
        <input type="checkbox" id="check-cupos-${sede.id}" ${sede.usaCuposPorcentaje ? "checked" : ""} />
        Usa cupo por porcentaje (día × médico) — hoy solo corresponde a Emilio Civit según el alcance, pero queda a tu criterio activarlo o desactivarlo acá
      </label>

      <label class="check-linea">
        <input type="checkbox" id="check-atadura-${sede.id}" ${sede.usaAtaduraDia ? "checked" : ""} />
        Usa atadura de día por médico (el médico solo atiende los días que tiene tildados en "Médicos" para esta sede) — hoy solo corresponde a Emilio Civit según el alcance, pero queda a tu criterio activarlo o desactivarlo acá
      </label>

      <div class="titulo-bloque" style="margin-top:16px;">Sillones</div>
      <div class="lista-sillones">${chips || '<span style="color:var(--color-muted); font-size:13px;">Sin sillones cargados.</span>'}</div>

      <form id="form-sillon-${sede.id}" class="fila-2" style="align-items:end;">
        <div class="campo" style="margin-bottom:0;">
          <label for="numero-sillon-${sede.id}">Nuevo sillón — número</label>
          <input type="number" id="numero-sillon-${sede.id}" min="1" required />
        </div>
        <div class="campo" style="margin-bottom:0;">
          <label for="tipo-sillon-${sede.id}">Tipo</label>
          <select id="tipo-sillon-${sede.id}">
            <option value="regular">Regular</option>
            <option value="backup">Backup</option>
          </select>
        </div>
        <button type="submit" class="boton-secundario" style="grid-column: 1 / -1; width:auto; justify-self:start;">+ Agregar sillón</button>
      </form>
    </div>
  `;
}

async function onGuardarHorario(evento, sedeId) {
  evento.preventDefault();
  const apertura = document.getElementById(`apertura-${sedeId}`).value;
  const cierre = document.getElementById(`cierre-${sedeId}`).value;

  if (apertura >= cierre) {
    mostrarMensajeSedes("La hora de apertura tiene que ser anterior a la de cierre.", "error");
    return;
  }

  try {
    await db.collection("turneroSedes").doc(sedeId).update({ horaApertura: apertura, horaCierre: cierre });
    mostrarMensajeSedes("Horario actualizado.", "exito");
    cargarSedes();
  } catch (error) {
    console.error("Error al guardar horario:", error);
    mostrarMensajeSedes("No se pudo guardar el horario.", "error");
  }
}

async function onCambiarSabados(evento, sedeId) {
  try {
    await db.collection("turneroSedes").doc(sedeId).update({ sabadosEspeciales: evento.target.checked });
    mostrarMensajeSedes("Actualizado.", "exito");
  } catch (error) {
    console.error("Error al actualizar sábados:", error);
    mostrarMensajeSedes("No se pudo actualizar.", "error");
    evento.target.checked = !evento.target.checked;
  }
}

async function onCambiarUsaCupos(evento, sedeId) {
  try {
    await db.collection("turneroSedes").doc(sedeId).update({ usaCuposPorcentaje: evento.target.checked });
    mostrarMensajeSedes("Actualizado.", "exito");
  } catch (error) {
    console.error("Error al actualizar uso de cupos:", error);
    mostrarMensajeSedes("No se pudo actualizar.", "error");
    evento.target.checked = !evento.target.checked;
  }
}

async function onCambiarUsaAtaduraDia(evento, sedeId) {
  try {
    await db.collection("turneroSedes").doc(sedeId).update({ usaAtaduraDia: evento.target.checked });
    mostrarMensajeSedes("Actualizado.", "exito");
  } catch (error) {
    console.error("Error al actualizar atadura de día:", error);
    mostrarMensajeSedes("No se pudo actualizar.", "error");
    evento.target.checked = !evento.target.checked;
  }
}

async function onAgregarSillon(evento, sedeId) {
  evento.preventDefault();
  const numeroInput = document.getElementById(`numero-sillon-${sedeId}`);
  const tipoInput = document.getElementById(`tipo-sillon-${sedeId}`);
  const numero = parseInt(numeroInput.value, 10);
  const tipo = tipoInput.value;

  const sede = sedesCache.find(s => s.id === sedeId);
  if (sede.sillones.some(s => s.numero === numero)) {
    mostrarMensajeSedes(`Ya existe un sillón número ${numero} en esta sede.`, "error");
    return;
  }

  try {
    await db.collection("turneroSedes").doc(sedeId).update({
      sillones: firebase.firestore.FieldValue.arrayUnion({ numero, tipo })
    });
    mostrarMensajeSedes("Sillón agregado.", "exito");
    cargarSedes();
  } catch (error) {
    console.error("Error al agregar sillón:", error);
    mostrarMensajeSedes("No se pudo agregar el sillón.", "error");
  }
}

async function quitarSillon(sedeId, numero) {
  const sede = sedesCache.find(s => s.id === sedeId);
  const sillon = sede.sillones.find(s => s.numero === numero);
  if (!sillon) return;

  if (!confirm(`¿Quitar el sillón ${numero} de ${sede.nombre}? Esto no borra turnos ya cargados, pero deja de estar disponible para nuevos turnos.`)) return;

  try {
    await db.collection("turneroSedes").doc(sedeId).update({
      sillones: firebase.firestore.FieldValue.arrayRemove(sillon)
    });
    mostrarMensajeSedes("Sillón eliminado.", "exito");
    cargarSedes();
  } catch (error) {
    console.error("Error al quitar sillón:", error);
    mostrarMensajeSedes("No se pudo quitar el sillón.", "error");
  }
}
