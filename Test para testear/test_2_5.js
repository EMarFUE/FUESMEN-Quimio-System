const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");

// --- Prueba 1: visibilidad del campo (actualizarVisibilidadCamposEspeciales) ---
function correrVisibilidad(rol) {
  const setupJs = `
    rolActualCarga = ${JSON.stringify(rol)};
    document.getElementById("campo-horario-manual").value = "10:00";
    actualizarVisibilidadCamposEspeciales();
    window.__display = document.getElementById("bloque-horario-manual").style.display;
    window.__valorTrasOcultar = document.getElementById("campo-horario-manual").value;
  `;
  const html = `<!DOCTYPE html><html><body>
    <div id="bloque-horario-manual" style="display:none;"><input id="campo-horario-manual" type="time"/></div>
    <div id="bloque-sillon-backup" style="display:none;"><input id="campo-sillon-backup" type="checkbox"/></div>
    <div id="bloque-prioridad-turno" style="display:none;"><select id="campo-prioridad-turno"></select></div>
    <select id="campo-medico"></select>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${setupJs}</script>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return { display: dom.window.__display, valor: dom.window.__valorTrasOcultar };
}

for (const [rol, esperado] of [["administrador", "block"], ["enfermeria", "block"], ["medico", "none"], ["administrativo", "none"]]) {
  const r = correrVisibilidad(rol);
  assert(r.display === esperado, `[visibilidad] rol ${rol} → bloque-horario-manual = "${esperado}"`);
  if (esperado === "none") {
    assert(r.valor === "", `[visibilidad] rol ${rol} → el valor cargado se limpia al ocultar`);
  }
}

// --- Prueba 2: intentarGuardarTurno, qué camino toma según el rol ---
function correrGuardado(rol) {
  const setupJs = `
    window.__spy = { horarioManualLlamado: null, busquedaAutomaticaLlamada: false };
    // Se pisan las funciones reales de guardado/búsqueda (top-level function, reasignable)
    // para no tocar Firestore ni el motor real — acá solo importa qué camino se toma y
    // con qué valor de horarioManual.
    buscarYGuardarConHorarioManual = function(datosBasicos, horarioManual, soloBackup) {
      window.__spy.horarioManualLlamado = horarioManual;
    };
    buscarYMostrarHuecos = function(datosBasicos) {
      window.__spy.busquedaAutomaticaLlamada = true;
    };

    rolActualCarga = ${JSON.stringify(rol)};
    pacienteSeleccionadoCarga = { nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" };
    medicosCacheCarga = [{ id: "med1", nombre: "Dr. Gómez", diasPorSede: { "Emilio Civit": ["lunes"] } }];
    sedesCacheCarga = [{ id: "sede1", nombre: "Emilio Civit" }];
    protocolosSeleccionados = { fila1: { protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 } };
    modoFechaTurno = "manual";

    document.getElementById("campo-medico").value = "med1";
    document.getElementById("campo-ciclo").value = "2";
    document.getElementById("campo-sesion").value = "3";
    document.getElementById("campo-fecha").value = "2026-10-10";
    document.getElementById("campo-premedicacion").checked = false;
    document.getElementById("campo-horario-manual").value = "14:30";

    intentarGuardarTurno(); // async, pero todo lo que nos importa corre sincrónico antes del primer await real
  `;
  const html = `<!DOCTYPE html><html><body>
    <div id="mensaje-general"></div>
    <select id="campo-medico"><option value="med1">Dr. Gómez</option></select>
    <input id="campo-medico-otro-nombre"/>
    <select id="campo-sede-manual"></select>
    <input id="campo-ciclo" type="number"/>
    <input id="campo-sesion" type="number"/>
    <input id="campo-fecha" type="date"/>
    <input id="campo-premedicacion" type="checkbox"/>
    <div id="bloque-horario-manual"><input id="campo-horario-manual" type="time"/></div>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${setupJs}</script>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return dom.window.__spy;
}

for (const rol of ["administrador", "enfermeria"]) {
  const r = correrGuardado(rol);
  assert(r.horarioManualLlamado === "14:30", `[guardado] rol ${rol} → toma el camino de horario manual, con el valor cargado`);
  assert(r.busquedaAutomaticaLlamada === false, `[guardado] rol ${rol} → NO dispara la búsqueda automática`);
}

for (const rol of ["medico", "administrativo"]) {
  const r = correrGuardado(rol);
  assert(r.horarioManualLlamado === null, `[guardado] rol ${rol} → NO toma el camino de horario manual (aunque el campo tenga valor en el DOM)`);
  assert(r.busquedaAutomaticaLlamada === true, `[guardado] rol ${rol} → cae a la búsqueda automática de siempre`);
}

console.log("\nTODAS LAS PRUEBAS PASARON");
