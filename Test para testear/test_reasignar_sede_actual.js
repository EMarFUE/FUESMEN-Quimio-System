const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");
const srcGrilla = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-grilla.js"), "utf8");

// Caso real reportado por Elías: Occhipinti + paciente OSEP (no POP) → la regla de T0
// busca primero en Entre Ríos. Turno en Emilio Civit. Al reasignar, la sede tiene que
// seguir siendo Emilio Civit en todos los caminos (decisión de Elías: para cambiar de
// sede está Modificar).
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const F = "2026-10-05"; // lunes
function sedes({ civitSoloLunes } = {}) {
  return [
    { id: "entre-rios", nombre: "Entre Ríos", horaApertura: "09:00", horaCierre: "12:00", diasAtencion: DIAS,
      usaAtaduraDia: false, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }] },
    { id: "emilio-civit", nombre: "Emilio Civit", horaApertura: "09:00", horaCierre: "10:00", diasAtencion: civitSoloLunes ? ["lunes"] : DIAS,
      usaAtaduraDia: false, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }] }
  ];
}
const MEDICOS = [{ id: "occhipinti", nombre: "Dr. Occhipinti", diasPorSede: { "Entre Ríos": DIAS, "Emilio Civit": DIAS } }];
const base = { sedeId: "emilio-civit", sedeNombre: "Emilio Civit", sedeAutomatica: true, medicoId: "occhipinti", medicoNombre: "Dr. Occhipinti",
  esMedicoOtro: false, protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }], premedicacion: false,
  duracionTotalMinutos: 60, ciclo: 1, sesion: 1, fecha: F };
const PAC = { id: "P", nombre: "Ana", apellido: "Pérez", obraSocial: "OSEP" };

async function correr({ turnoPropio, otros, sedesCfg, accion, hora, clickCargarIgual }) {
  const propio = { ...base, id: "propio", sillon: 1, horarioInicio: "09:00", horarioFin: "10:00", paciente: PAC, ...(turnoPropio || {}) };
  const todos = [propio, ...(otros || [])];
  const setup = `
    rolActualGrilla = "administrador"; rolActualCarga = "administrador";
    datosUsuarioActualGrilla = { rol: "administrador" }; datosUsuarioActualCarga = datosUsuarioActualGrilla;
    usuarioActualGrilla = { uid: "u" }; usuarioActualCarga = usuarioActualGrilla;
    sedesCacheCarga = ${JSON.stringify(sedesCfg)}; medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = ${JSON.stringify(todos)}; turnosCacheGrilla = ${JSON.stringify(todos)};
    cuposCacheCarga = []; bloqueosCacheCarga = [];
    turnoIdReasignarActual = "propio"; window.__campos = null;
    abrirModalMotivoGrilla = function(turno, campos) { window.__campos = campos; };
    document.getElementById("campo-fecha-reasignar-grilla").value = "${F}";
    document.getElementById("campo-horario-manual-reasignar-grilla").value = ${JSON.stringify(hora || "")};
    window.__fin = false;
    ${accion}().then(() => { window.__fin = true; });
  `;
  const html = `<!DOCTYPE html><html><body><div id="mensaje-reasignar-grilla"></div><input type="date" id="campo-fecha-reasignar-grilla"/>
    <div id="bloque-horario-manual-reasignar-grilla"><input type="time" id="campo-horario-manual-reasignar-grilla"/></div>
    <button id="boton-buscar-reasignar-grilla"></button><button id="boton-horario-manual-reasignar-grilla"></button>
    <div id="overlay-reasignar-grilla"></div><div id="mensaje-general"></div><button id="boton-guardar-turno"></button>
    <script>${srcMotor}</script><script>${srcCarga}</script><script>${srcGrilla}</script><script>${setup}</script></body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  const w = dom.window;
  for (let i = 0; i < 200 && !w.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
  if (clickCargarIgual && !w.__campos) {
    const btn = Array.from(w.document.querySelectorAll("#modal-sobreturno button")).find(b => /Cargar (igual|como sobreturno)/.test(b.textContent));
    if (btn) { btn.click(); for (let i = 0; i < 200 && !w.__campos; i++) { await new Promise(r => setTimeout(r, 0)); } }
  }
  return { campos: w.__campos, msg: w.document.getElementById("mensaje-reasignar-grilla").textContent };
}

(async () => {
  // 1. Buscar disponibilidad: Entre Ríos libre (y prioritaria por la regla de T0), pero
  //    el turno está en Civit → se queda en Civit, mismo día, su propio lugar.
  {
    const r = await correr({ sedesCfg: sedes(), accion: "buscarReasignarGrilla", otros: [{ ...base, id: "x", sillon: 2, horarioInicio: "09:00", horarioFin: "10:00", paciente: { id: "Q" } }] });
    assert(r.campos && r.campos.sedeId === "emilio-civit", "[buscar] Occhipinti/OSEP en Civit: busca solo en Civit (antes: Entre Ríos primero)");
    assert(r.campos.fecha === F && r.campos.sillon === 1, "[buscar] mismo día, su propio sillón");
  }
  // 2. Buscar disponibilidad sin lugar en Civit en 10 días → sobreturno → sigue en Civit.
  {
    const lleno = [];
    for (const f of [F, "2026-10-12"]) for (const s of [1, 2]) lleno.push({ ...base, id: `l${f}${s}`, fecha: f, sillon: s, horarioInicio: "09:00", horarioFin: "10:00", paciente: { id: "q" + f + s } });
    const r = await correr({ sedesCfg: sedes({ civitSoloLunes: true }), accion: "buscarReasignarGrilla", turnoPropio: { fecha: "2026-10-06", sillon: null }, otros: lleno, clickCargarIgual: true });
    assert(r.campos && r.campos.sedeId === "emilio-civit" && r.campos.sillon === null, "[buscar, sin lugar] el sobreturno se carga en Civit (antes: la regla de Occhipinti lo mandaba a Entre Ríos)");
  }
  // 3. Horario exacto con lugar → Civit.
  {
    const r = await correr({ sedesCfg: sedes(), accion: "buscarReasignarHorarioManualGrilla", hora: "09:00" });
    assert(r.campos && r.campos.sedeId === "emilio-civit", "[horario exacto] se queda en Civit (antes: probaba Entre Ríos primero)");
  }
  // 4. Horario exacto sin sillón → "Cargar igual" → sobreturno en Civit.
  {
    const r = await correr({ sedesCfg: sedes(), accion: "buscarReasignarHorarioManualGrilla", hora: "09:00",
      otros: [1, 2].map(s => ({ ...base, id: "o" + s, sillon: s, horarioInicio: "09:00", horarioFin: "10:00", paciente: { id: "q" + s } })),
      turnoPropio: { horarioInicio: "11:00", horarioFin: "12:00", sillon: null, fecha: "2026-10-06" }, clickCargarIgual: true });
    assert(r.campos && r.campos.sedeId === "emilio-civit" && r.campos.sillon === null, "[horario exacto, sin sillón] el sobreturno se carga en Civit");
  }
  // 5. Internado (solo se reasigna con horario exacto) → Civit.
  {
    const r = await correr({ sedesCfg: sedes(), accion: "buscarReasignarHorarioManualGrilla", hora: "09:30", turnoPropio: { internado: true, sillon: null } });
    assert(r.campos && r.campos.sedeId === "emilio-civit", "[internado] reasignar un internado mantiene la sede Civit");
  }

  // 6. Regresión: "+ nuevo turno" de Occhipinti/OSEP sigue con la regla de T0 (Entre Ríos primero).
  {
    const setup = `
      rolActualCarga = "administrador"; datosUsuarioActualCarga = { rol: "administrador" }; usuarioActualCarga = { uid: "u" };
      sedesCacheCarga = ${JSON.stringify(sedes())}; medicosCacheCarga = ${JSON.stringify(MEDICOS)};
      turnosExistentes = []; cuposCacheCarga = []; bloqueosCacheCarga = [];
      window.__h = null; guardarTurnoConHueco = async function(d, h) { window.__h = h; };
      window.__fin = false;
      buscarYMostrarHuecos(${JSON.stringify({ ...base, sedeId: null, sedeNombre: null })}, ${JSON.stringify({ id: "P", obraSocial: "OSEP" })}).then(() => { window.__fin = true; });
    `;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div><button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 200 && !dom.window.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
    assert(dom.window.__h && dom.window.__h.sedeId === "entre-rios", "[regresión, + nuevo turno] Occhipinti/OSEP sigue buscando primero en Entre Ríos");
  }
  // 7. Regresión: las funciones de sede de "+ nuevo turno" no cambiaron.
  {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><script>${srcMotor}</script><script>${srcCarga}</script><script>
      window.__a = sedeIdManualParaMotor({ sedeAutomatica: true, sedeId: "x" });
      window.__b = sedeIdManualParaMotor({ sedeAutomatica: false, sedeId: "x" });
      window.__c = recalcularSedeOcchipinti({ medicoId: "occhipinti" });
    </script></body></html>`, { runScripts: "dangerously" });
    assert(dom.window.__a === null && dom.window.__b === "x" && dom.window.__c === true, "[regresión] fuera de Reasignar: sede automática → null, manual → la elegida, Occhipinti se recalcula como siempre");
  }

  console.log("\nTODAS LAS PRUEBAS DE \"REASIGNAR EN LA SEDE ACTUAL\" PASARON\n");
})();
