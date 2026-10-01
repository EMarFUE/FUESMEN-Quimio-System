const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");

function cargarMotor() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(srcMotor, context);
  return context;
}

const SEDE = {
  id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "20:00",
  usaAtaduraDia: false, usaCuposPorcentaje: false,
  sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }, { numero: 3, tipo: "backup" }]
};
const MEDICO = { id: "med1", nombre: "Dr. Gómez", diasPorSede: {} };
const FECHA = "2026-10-05";

function turno(id, sillon, ini, fin) {
  return { id, sedeId: "sede1", fecha: FECHA, sillon, horarioInicio: ini, horarioFin: fin };
}

async function buscar(ctx, turnos, hora, turnoIdExcluir, soloBackup) {
  return ctx.buscarSillonHorarioFijo(
    "med1", "", 60, FECHA, hora, [MEDICO], [SEDE], turnos, "sede1", [], !!soloBackup, turnoIdExcluir
  );
}

(async () => {
  // --- 1 (el bug reportado): ambos sillones regulares ocupados, uno es el propio turno
  // que se reasigna. Con el id excluido, el propio sillón queda libre. ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 1, "09:00", "10:00"), turno("otro", 2, "09:00", "10:00")];
    const r = await buscar(ctx, turnos, "09:30", "elTurno");
    assert(r.exito === true && r.hueco.sillon === 1, "[bug reportado] el propio turno no se cuenta a sí mismo: queda libre su sillón (1)");
  }

  // --- 2 (regresión — sin el id, el comportamiento de una carga nueva NO cambia) ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 1, "09:00", "10:00"), turno("otro", 2, "09:00", "10:00")];
    const r = await buscar(ctx, turnos, "09:30", undefined);
    assert(r.exito === false && r.motivo === "sinSillon", "[regresión, alta nueva] sin turnoIdExcluir, los dos sillones ocupados siguen dando sinSillon");
  }

  // --- 3 (regresión — el resto de los turnos SÍ siguen contando) ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 1, "08:00", "09:00"), turno("otro1", 1, "09:30", "10:30"), turno("otro2", 2, "09:30", "10:30")];
    const r = await buscar(ctx, turnos, "09:30", "elTurno");
    assert(r.exito === false && r.motivo === "sinSillon", "[regresión] excluir el propio turno no libera sillones ocupados por OTROS turnos");
  }

  // --- 4: el propio turno en el mismo horario exacto que pide (caso "reasignar a la misma hora") ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 2, "09:00", "10:00"), turno("otro", 1, "09:00", "10:00")];
    const r = await buscar(ctx, turnos, "09:00", "elTurno");
    assert(r.exito === true && r.hueco.sillon === 2, "[misma hora] reasignar a la misma hora cae en su propio sillón, no en sobreturno");
  }

  // --- 5: backup — turno propio en el backup, horario exacto con soloBackup ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 3, "09:00", "10:00")];
    const sin = await buscar(ctx, turnos, "09:30", undefined, true);
    const con = await buscar(ctx, turnos, "09:30", "elTurno", true);
    assert(sin.exito === false && sin.motivo === "sinSillon", "[backup, sin id] el turno propio ocupa el backup (comportamiento viejo, alta nueva)");
    assert(con.exito === true && con.hueco.sillon === 3, "[backup, con id] el propio turno no bloquea su propio sillón backup");
  }

  // --- 6: el regular NUNCA cae en backup cuando no se pidió soloBackup, ni con el id excluido ---
  {
    const ctx = cargarMotor();
    const turnos = [turno("elTurno", 1, "09:00", "10:00"), turno("o1", 2, "09:30", "10:30")];
    const r = await buscar(ctx, turnos, "09:30", "elTurno", false);
    assert(r.exito === true && r.hueco.sillon === 1, "[sin backup] con el id excluido elige un sillón regular, nunca el backup");
    const turnosLlenos = [turno("o1", 1, "09:00", "10:00"), turno("o2", 2, "09:00", "10:00"), turno("elTurno", 3, "09:00", "10:00")];
    const r2 = await buscar(ctx, turnosLlenos, "09:30", "elTurno", false);
    assert(r2.exito === false && r2.motivo === "sinSillon", "[sin backup] regulares llenos por otros → sinSillon aunque el backup esté libre (no cae en backup solo)");
  }

  // --- 7: el cableado real: buscarYGuardarConHorarioManual le pasa datosBasicos.turnoIdParaReasignar ---
  {
    const idx = srcCarga.indexOf("async function buscarYGuardarConHorarioManual");
    const fin = srcCarga.indexOf("function mostrarSobreturnoHorarioFijo");
    const cuerpo = srcCarga.slice(idx, fin);
    const llamada = cuerpo.slice(cuerpo.indexOf("buscarSillonHorarioFijo("), cuerpo.indexOf("if (resultado.exito)"));
    assert(/soloBackup,[\s\S]*datosBasicos\.turnoIdParaReasignar,[\s\S]*datosBasicos\.pacienteId\s*\)/.test(llamada), "[cableado] buscarYGuardarConHorarioManual pasa datosBasicos.turnoIdParaReasignar (y luego pacienteId) al motor");
  }

  console.log("\nTODAS LAS PRUEBAS DEL BUG DE REASIGNAR CON HORARIO EXACTO PASARON\n");
})();
