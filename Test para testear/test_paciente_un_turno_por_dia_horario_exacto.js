const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");
const srcGrilla = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-grilla.js"), "utf8");

const SEDES = [
  { id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "18:00", usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }, { numero: 3, tipo: "backup" }] },
  { id: "sede2", nombre: "Entre Ríos", horaApertura: "08:00", horaCierre: "18:00", usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }] }
];
const MEDICO = { id: "med1", nombre: "Dr. Gómez", diasPorSede: {} };
const FECHA = "2026-10-05";

function t(id, pacId, sedeId, sillon, ini, fin, extra) {
  return { id, sedeId, fecha: FECHA, sillon, horarioInicio: ini, horarioFin: fin, paciente: { id: pacId, nombre: "N", apellido: "A", obraSocial: "OSDE" },
    medicoId: "med1", medicoNombre: "Dr. Gómez", protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
    duracionTotalMinutos: 60, ciclo: 1, sesion: 1, sedeNombre: "Emilio Civit", sedeAutomatica: false, esMedicoOtro: false, premedicacion: false, ...(extra || {}) };
}

function cargarMotor() { const c = { console }; vm.createContext(c); vm.runInContext(srcMotor, c); return c; }
function horarioFijo(ctx, turnos, pacienteId, turnoIdExcluir, hora, fecha) {
  return ctx.buscarSillonHorarioFijo("med1", "", 60, fecha || FECHA, hora || "11:00", [MEDICO], SEDES, turnos, "sede1", [], false, turnoIdExcluir, pacienteId);
}

(async () => {
  // ================= PARTE A: motor puro =================
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("otro", "pac1", "sede1", 1, "09:00", "10:00")], "pac1", undefined);
    assert(r.exito === false && r.motivo === "pacienteMismoDia", "[motor] paciente con otro turno ese día (misma sede) → pacienteMismoDia, aunque haya sillones libres");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("otro", "pac1", "sede2", 1, "09:00", "10:00")], "pac1", undefined);
    assert(r.exito === false && r.motivo === "pacienteMismoDia", "[motor] otro turno del paciente en LA OTRA sede el mismo día → también bloquea (transversal a sedes)");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("otro", "pac1", "sede1", 1, "09:00", "10:00")], "pac2", undefined);
    assert(r.exito === true, "[motor] el turno es de OTRO paciente → no bloquea");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("otro", "pac1", "sede1", 1, "09:00", "10:00")], "pac1", undefined, "11:00", "2026-10-06");
    assert(r.exito === true, "[motor] el paciente tiene turno otro día, no el pedido → no bloquea");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("elTurno", "pac1", "sede1", 1, "09:00", "10:00")], "pac1", "elTurno");
    assert(r.exito === true, "[motor, Reasignar] su único turno del día es el propio (turnoIdExcluir) → no se bloquea a sí mismo");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("elTurno", "pac1", "sede1", 1, "09:00", "10:00"), t("otro", "pac1", "sede2", 1, "14:00", "15:00")], "pac1", "elTurno");
    assert(r.exito === false && r.motivo === "pacienteMismoDia", "[motor, Reasignar] tiene OTRO turno ese día además del propio → bloquea");
  }
  {
    const ctx = cargarMotor();
    const r = await horarioFijo(ctx, [t("otro", "pac1", "sede1", 1, "09:00", "10:00")], undefined, undefined);
    assert(r.exito === true, "[motor, retrocompat] sin pacienteId la regla no se evalúa (llamados viejos no cambian)");
  }

  // ================= PARTE B: flujo real de carga (buscarYGuardarConHorarioManual) =================
  async function correrHorarioManual({ datosBasicosExtra, turnos, hora }) {
    const setup = `
      rolActualCarga = "administrador";
      medicosCacheCarga = ${JSON.stringify([MEDICO])};
      sedesCacheCarga = ${JSON.stringify(SEDES)};
      turnosExistentes = ${JSON.stringify(turnos)};
      bloqueosCacheCarga = [];
      window.__guardado = null;
      guardarTurnoConHueco = async function(d, hueco, tipo) { window.__guardado = { hueco, tipo }; };
      window.__fin = false;
      buscarYGuardarConHorarioManual(${JSON.stringify({
        medicoId: "med1", medicoNombre: "Dr. Gómez", fecha: FECHA, duracionTotalMinutos: 60,
        sedeAutomatica: false, sedeId: "sede1", pacienteObraSocial: "OSDE", ...datosBasicosExtra
      })}, ${JSON.stringify(hora)}, false).then(() => { window.__fin = true; });
    `;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div><button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 100 && !dom.window.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
    return {
      guardado: dom.window.__guardado,
      mensaje: dom.window.document.getElementById("mensaje-general").textContent,
      hayCartelSobreturno: !!(dom.window.document.getElementById("modal-sobreturno") && dom.window.document.getElementById("modal-sobreturno").style.display === "block"),
      botonHabilitado: dom.window.document.getElementById("boton-guardar-turno").disabled === false
    };
  }

  {
    const r = await correrHorarioManual({ datosBasicosExtra: { pacienteId: "pac1" }, turnos: [t("otro", "pac1", "sede1", 1, "09:00", "10:00")], hora: "11:00" });
    assert(r.guardado === null, "[carga nueva] paciente con turno ese día → NO guarda");
    assert(r.mensaje.includes("ya tiene un turno cargado") && r.mensaje.includes("No se puede agendar otro el mismo día"), "[carga nueva] muestra el mismo mensaje que la búsqueda automática");
    assert(r.hayCartelSobreturno === false, "[carga nueva] NO ofrece sobreturno (bloqueo total)");
    assert(r.botonHabilitado === true, "[carga nueva] el botón queda habilitado para reintentar");
  }
  {
    const r = await correrHorarioManual({ datosBasicosExtra: { pacienteId: "pac1" }, turnos: [t("otro", "pac9", "sede1", 1, "09:00", "10:00")], hora: "11:00" });
    assert(r.guardado && r.guardado.hueco.sillon != null, "[carga nueva] sin turno previo del paciente → guarda normal");
  }
  {
    // Reasignar: datosBasicos.modoReasignar + turnoIdParaReasignar, pacienteId explícito
    const r = await correrHorarioManual({ datosBasicosExtra: { pacienteId: "pac1", modoReasignar: true, turnoIdParaReasignar: "elTurno" }, turnos: [t("elTurno", "pac1", "sede1", 1, "09:00", "10:00")], hora: "09:30" });
    assert(r.guardado && r.guardado.hueco.sillon === 1, "[reasignar] su único turno del día es el propio → no se bloquea y conserva su sillón 1");
  }

  // ================= PARTE C: cableado — Reasignar horario exacto de punta a punta =================
  async function correrReasignar({ turnoPropio, otros, hora }) {
    const T = { ...t("t1", "pac1", "sede1", 1, "09:00", "10:00"), ...turnoPropio };
    const todos = [T, ...otros];
    const setup = `
      rolActualGrilla = "administrador"; rolActualCarga = "administrador";
      datosUsuarioActualGrilla = { rol: "administrador" }; datosUsuarioActualCarga = datosUsuarioActualGrilla;
      usuarioActualGrilla = { uid: "u" }; usuarioActualCarga = usuarioActualGrilla;
      // Paciente VIEJO en memoria de un "+ nuevo turno" anterior: Reasignar no debe usarlo.
      pacienteSeleccionadoCarga = { id: "pacVIEJO", obraSocial: "OSDE" };
      sedesCacheCarga = ${JSON.stringify(SEDES)}; medicosCacheCarga = ${JSON.stringify([MEDICO])};
      turnosExistentes = ${JSON.stringify(todos)}; turnosCacheGrilla = ${JSON.stringify(todos)};
      cuposCacheCarga = []; bloqueosCacheCarga = [];
      turnoIdReasignarActual = "t1"; window.__motivo = null;
      abrirModalMotivoGrilla = function(turno, campos) { window.__motivo = campos; };
      document.getElementById("campo-fecha-reasignar-grilla").value = ${JSON.stringify(FECHA)};
      document.getElementById("campo-horario-manual-reasignar-grilla").value = ${JSON.stringify(hora)};
      window.__fin = false;
      buscarReasignarHorarioManualGrilla().then(() => { window.__fin = true; });
    `;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-reasignar-grilla"></div><input type="date" id="campo-fecha-reasignar-grilla"/>
      <div id="bloque-horario-manual-reasignar-grilla"><input type="time" id="campo-horario-manual-reasignar-grilla"/></div>
      <button id="boton-horario-manual-reasignar-grilla"></button><button id="boton-buscar-reasignar-grilla"></button>
      <div id="overlay-reasignar-grilla"></div><div id="mensaje-general"></div><button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${srcGrilla}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 100 && !dom.window.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
    const w = dom.window;
    const res = {
      motivo: w.__motivo,
      msg: w.document.getElementById("mensaje-reasignar-grilla").textContent,
      cartel: !!(w.document.getElementById("modal-sobreturno") && w.document.getElementById("modal-sobreturno").style.display === "block")
    };
    if (res.cartel) {
      const btn = Array.from(w.document.querySelectorAll("#modal-sobreturno button")).find(b => /Cargar igual/.test(b.textContent));
      if (btn) {
        btn.click();
        for (let i = 0; i < 100 && !w.__motivo; i++) { await new Promise(r => setTimeout(r, 0)); }
        res.trasCargarIgual = w.__motivo;
      }
    }
    return res;
  }

  {
    const r = await correrReasignar({ turnoPropio: {}, otros: [t("x", "pac1", "sede2", 1, "15:00", "16:00")], hora: "11:00" });
    assert(r.motivo === null && r.msg.includes("ya tiene un turno cargado"), "[reasignar e2e] el paciente tiene otro turno ese día en la otra sede → bloquea y avisa en el modal de Reasignar");
  }
  {
    const r = await correrReasignar({ turnoPropio: {}, otros: [t("x", "pacOtro", "sede1", 2, "09:00", "10:00")], hora: "09:30" });
    assert(r.motivo && r.motivo.sillon === 1, "[reasignar e2e] usa el paciente del TURNO (no el viejo en memoria) y no se autobloquea: pasa al modal de motivo en su sillón");
  }

  // ================= PARTE D: regresión del backup (prueba 3 reportada) =================
  // Documenta lo que hace el código vigente: un turno que hoy es sobreturno (sillon null),
  // reasignado con horario exacto sin lugar, y aceptando "Cargar igual", queda SIN sillón
  // — nunca en el backup. Solo un turno que YA estaba en backup se mantiene en backup.
  {
    const llenos = [t("a", "pA", "sede1", 1, "09:00", "10:00"), t("b", "pB", "sede1", 2, "09:00", "10:00")];
    const r = await correrReasignar({ turnoPropio: { sillon: null, tipoSobreturno: "sinDisponibilidadFisica" }, otros: llenos, hora: "09:30" });
    assert(r.cartel === true, "[backup] origen sobreturno, regulares llenos → ofrece cartel de sobreturno");
    assert(r.trasCargarIgual && r.trasCargarIgual.sillon === null, "[backup] origen sobreturno + \"Cargar igual\" → queda sillon null (Sin asignar), NO en el backup");
  }
  {
    const llenos = [t("a", "pA", "sede1", 1, "09:00", "10:00"), t("b", "pB", "sede1", 2, "09:00", "10:00"), t("c", "pC", "sede1", 3, "09:00", "10:00")];
    const r = await correrReasignar({ turnoPropio: { sillon: null }, otros: llenos, hora: "09:30" });
    assert(r.trasCargarIgual && r.trasCargarIgual.sillon === null, "[backup] aunque el backup también esté ocupado → sigue en null");
  }
  {
    const r = await correrReasignar({ turnoPropio: { sillon: null }, otros: [t("a", "pA", "sede1", 1, "09:00", "10:00")], hora: "09:30" });
    assert(r.motivo && r.motivo.sillon === 2, "[backup] origen sobreturno con un regular libre → toma el regular 2, nunca el backup (3)");
  }

  // ================= PARTE E: cableado de "+ nuevo turno" (intentarGuardarTurno) =================
  {
    const setup = `
      window.__spy = null;
      buscarYGuardarConHorarioManual = async function(datosBasicos, horario, soloBackup) { window.__spy = { datosBasicos, horario }; };
      buscarYMostrarHuecos = async function() {};
      rolActualCarga = "administrador";
      pacienteSeleccionadoCarga = { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" };
      medicosCacheCarga = ${JSON.stringify([{ id: "med1", nombre: "Dr. Gómez", diasPorSede: { "Emilio Civit": ["lunes"] } }])};
      sedesCacheCarga = ${JSON.stringify(SEDES)};
      protocolosSeleccionados = { fila1: { protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 } };
      modoFechaTurno = "manual";
      document.getElementById("campo-medico").value = "med1";
      document.getElementById("campo-ciclo").value = "1";
      document.getElementById("campo-sesion").value = "1";
      document.getElementById("campo-fecha").value = "2026-10-05";
      document.getElementById("campo-horario-manual").value = "11:00";
      intentarGuardarTurno();
    `;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div>
      <select id="campo-medico"><option value="med1">Dr. Gómez</option></select><input id="campo-medico-otro-nombre"/><select id="campo-sede-manual"></select>
      <input id="campo-ciclo" type="number"/><input id="campo-sesion" type="number"/><input id="campo-fecha" type="date"/><input id="campo-premedicacion" type="checkbox"/>
      <div id="bloque-horario-manual"><input id="campo-horario-manual" type="time"/></div>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__spy; i++) { await new Promise(r => setTimeout(r, 0)); }
    assert(dom.window.__spy && dom.window.__spy.datosBasicos.pacienteId === "pac1", "[cableado] intentarGuardarTurno le pasa el id del paciente elegido a buscarYGuardarConHorarioManual");
  }

  console.log("\nTODAS LAS PRUEBAS DE \"UN TURNO POR DÍA\" EN HORARIO EXACTO PASARON\n");
})();
