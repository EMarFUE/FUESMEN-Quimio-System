const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
function cargarMotor() { const c = { console: { log() {}, warn() {}, error() {} } }; vm.createContext(c); vm.runInContext(srcMotor, c); return c; }

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const F = "2026-10-05"; // lunes
const sede = (ap, ci, sillones, extra) => ({ id: "s1", nombre: "Emilio Civit", horaApertura: ap, horaCierre: ci, diasAtencion: DIAS,
  usaAtaduraDia: false, usaCuposPorcentaje: false, sillones, ...(extra || {}) });
const R = n => ({ numero: n, tipo: "regular" }), B = n => ({ numero: n, tipo: "backup" });
const MED = { id: "m1", nombre: "Dr", diasPorSede: { "Emilio Civit": DIAS } };
const T = (id, sillon, ini, fin, extra) => ({ id, sedeId: "s1", fecha: F, sillon, horarioInicio: ini, horarioFin: fin,
  medicoId: "m1", duracionTotalMinutos: 0, paciente: { id: "p" + id }, ...(extra || {}) });

(async () => {
  // ===== Arreglo 1: Reasignar → Buscar disponibilidad excluye el turno propio =====
  {
    const m = cargarMotor();
    const turnos = [T("propio", 1, "09:00", "10:00", { paciente: { id: "P" } }), T("otro", 2, "09:00", "10:00")];
    const r = await m.buscarHuecos("m1", "", 60, F, [MED], [sede("09:00", "10:00", [R(1), R(2)])], turnos, false, "s1", [], "P", "propio", [], null);
    assert(r.exito && r.huecosEncontrados[0].fecha === F && r.huecosEncontrados[0].sillon === 1,
      "[1] el único hueco del día es el del propio turno → lo encuentra el mismo día, en su sillón (antes: lo mandaba a otro día)");
  }
  {
    const m = cargarMotor();
    const s = sede("09:00", "19:00", [R(1)], { usaCuposPorcentaje: true }); // 600 min, 50% → techo 300
    const cupos = [{ sedeId: "s1", dia: "lunes", cupos: { m1: 50 } }];
    const turnos = [T("propio", 1, "09:00", "12:00", { paciente: { id: "P" }, duracionTotalMinutos: 180 })];
    const r = await m.buscarHuecos("m1", "", 180, F, [MED], [s], turnos, true, "s1", cupos, "P", "propio", [], null);
    assert(r.exito && r.huecosEncontrados[0].fecha === F, "[1] cupo: los minutos del propio turno no se cuentan dos veces (180 + 180 ≤ 300 era falso; 0 + 180 ≤ 300 es lo real)");
  }
  {
    const m = cargarMotor();
    const turnos = [T("propio", 1, "09:00", "10:00", { paciente: { id: "P" } }), T("otro", 2, "09:00", "10:00")];
    const r = await m.buscarHuecos("m1", "", 60, F, [MED], [sede("09:00", "10:00", [R(1), R(2)])], turnos, false, "s1", [], "Pnuevo", undefined, [], null);
    assert(r.exito && r.huecosEncontrados[0].fecha !== F, "[1, regresión] alta nueva (sin turnoIdExcluir): el día lleno sigue lleno, igual que antes");
  }

  // ===== Arreglo 2: el reacomodo nunca toca turnos sin sillón ni turnos de otro tipo de sillón =====
  // Sede que solo atiende los lunes, con el lunes siguiente lleno, para que la búsqueda
  // normal falle y el reacomodo se dispare.
  const sedeLunes = (sillones) => ({ ...sede("08:00", "10:00", sillones), diasAtencion: ["lunes"] });
  const lleno12 = [T("L1", 1, "08:00", "10:00", { fecha: "2026-10-12" }), T("L2", 2, "08:00", "10:00", { fecha: "2026-10-12" }), T("L3", 3, "08:00", "10:00", { fecha: "2026-10-12" })];
  const base = [T("A", 1, "08:00", "09:00"), T("B", 1, "09:30", "10:00"), T("C", 2, "08:30", "09:30"), ...lleno12];
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, F, [MED], [sedeLunes([R(1), R(2)])], base, false, "s1", [], "pN", undefined, [], null, [], false);
    assert(r.exito && r.reacomodo && r.reacomodo.cambios.length === 1 && r.reacomodo.cambios[0].turnoId === "B", "[2, control] sin turnos sin sillón, el reacomodo funciona como siempre (mueve solo a B)");
  }
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, F, [MED], [sedeLunes([R(1), R(2)])], [...base, T("SOB", null, "08:00", "08:30")], false, "s1", [], "pN", undefined, [], null, [], false);
    assert(r.exito && r.reacomodo && !r.reacomodo.cambios.some(c => c.turnoId === "SOB"), "[2] un sobreturno sin sillón NUNCA recibe sillón en un reacomodo (antes: se le asignaba y se escribía en Firestore)");
    assert(r.reacomodo.cambios.length === 1, "[2] y no mueve a otros pacientes para hacerle lugar al sobreturno");
  }
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, F, [MED], [sedeLunes([R(1), R(2)])], [...base, T("INT", null, "09:30", "10:00", { internado: true })], false, "s1", [], "pN", undefined, [], null, [], false);
    assert(r.exito && r.reacomodo && !r.reacomodo.cambios.some(c => c.turnoId === "INT"), "[2] un internado no ocupa sillón: no le resta lugar al reacomodo (antes: 'no entra') ni se lo mueve");
  }
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, F, [MED], [sedeLunes([R(1), R(2), B(3)])], [...base, T("BK", 3, "08:00", "10:00")], false, "s1", [], "pN", undefined, [], null, [], false);
    assert(r.exito && r.reacomodo && !r.reacomodo.cambios.some(c => c.turnoId === "BK") && r.huecosEncontrados[0].sillon !== 3, "[2] un turno en el backup queda fijo en una búsqueda regular, y el candidato nunca cae en backup");
  }
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, F, [MED], [sedeLunes([R(1), R(2)])], base, false, "s1", [], "pB", "B", [], null, [], false);
    assert(r.exito && r.reacomodo === null && r.huecosEncontrados[0].horaInicio === "09:00", "[2] el turno propio (turnoIdExcluir) tampoco participa del reacomodo: sin él, el hueco existe sin mover a nadie");
  }

  // ===== Arreglo 4: médico sin diasPorSede =====
  {
    const m = cargarMotor();
    const r = await m.buscarHuecos("mX", "", 60, F, [{ id: "mX", nombre: "X" }], [sede("08:00", "12:00", [R(1)]), { ...sede("08:00", "12:00", [R(1)]), id: "entre-rios", nombre: "Entre Ríos" }], [], false, null, [], "p", undefined, [], null);
    assert(!(r.sinHuecosMotivo || "").startsWith("Error interno"), "[4] un médico sin diasPorSede ya no hace fallar la búsqueda con 'Error interno'");
  }

  console.log("\nTODAS LAS PRUEBAS DE LA AUDITORÍA DEL MOTOR (GRUPO A) PASARON\n");
})();
