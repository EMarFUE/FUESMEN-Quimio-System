const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");

function cargarMotor() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(srcMotor, context);
  return context;
}

const SEDE = {
  id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "20:00",
  usaAtaduraDia: false, usaCuposPorcentaje: false,
  sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }]
};
const MEDICO = { id: "med1", nombre: "Dr. Gómez", diasPorSede: {} };

// Escenario real reportado: un día lleno de sobreturnos "sin sillón" (sillon: null) que
// se superponen entre sí en horario — exactamente lo que genera un día completo con
// varios "cargar igual" (horario manual o sobreturno sin disponibilidad).
const OTROS_SOBRETURNOS_SIN_SILLON = [
  { id: "otro1", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:00", horarioFin: "10:00" },
  { id: "otro2", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:30", horarioFin: "10:30" },
  { id: "otro3", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:15", horarioFin: "09:45" }
];

// --- Prueba 1 (el bug reportado): modificar un turno dejándolo "Sin asignar
// (sobreturno)" en un día con OTROS sobreturnos sin sillón que se superponen en
// horario — antes del arreglo, esto daba "sillonOcupado" en falso. ---
{
  const ctx = cargarMotor();
  const turnosExistentes = [
    ...OTROS_SOBRETURNOS_SIN_SILLON,
    { id: "elTurno", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:00", horarioFin: "10:00" }
  ];
  const resultado = ctx.validarModificacionTurno(
    "med1", "sede1", "2026-10-05", "09:00", "10:00", null, // sillon candidato: null
    [MEDICO], [SEDE], turnosExistentes, [], "elTurno", []
  );
  assert(resultado.valido === true, `[bug reportado] modificar dejando "Sin asignar" en un día lleno de otros sobreturnos sin sillón → válido (antes: ${JSON.stringify(resultado)})`);
}

// --- Prueba 2: dos sobreturnos sin sillón exactamente a la misma hora, incluso ese
// caso extremo tiene que dar válido. ---
{
  const ctx = cargarMotor();
  const turnosExistentes = [
    { id: "otro1", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:00", horarioFin: "10:00" },
    { id: "elTurno", sedeId: "sede1", fecha: "2026-10-05", sillon: null, horarioInicio: "09:00", horarioFin: "10:00" }
  ];
  const resultado = ctx.validarModificacionTurno(
    "med1", "sede1", "2026-10-05", "09:00", "10:00", null,
    [MEDICO], [SEDE], turnosExistentes, [], "elTurno", []
  );
  assert(resultado.valido === true, "[caso extremo] dos sobreturnos sin sillón a la hora exacta → sigue siendo válido");
}

// --- Prueba 3 (regresión — NO romper el chequeo real): un sillón físico SÍ ocupado por
// otro turno en el mismo horario tiene que seguir dando "sillonOcupado". ---
{
  const ctx = cargarMotor();
  const turnosExistentes = [
    { id: "otro1", sedeId: "sede1", fecha: "2026-10-05", sillon: 1, horarioInicio: "09:00", horarioFin: "10:00" },
    { id: "elTurno", sedeId: "sede1", fecha: "2026-10-05", sillon: 2, horarioInicio: "09:00", horarioFin: "10:00" }
  ];
  const resultado = ctx.validarModificacionTurno(
    "med1", "sede1", "2026-10-05", "09:30", "10:30", 1, // pide pasar a sillón 1, ocupado
    [MEDICO], [SEDE], turnosExistentes, [], "elTurno", []
  );
  assert(resultado.valido === false && resultado.motivo === "sillonOcupado", "[regresión] sillón físico realmente ocupado → sigue detectándose (sillonOcupado)");
}

// --- Prueba 4 (regresión): mismo sillón físico pero SIN superposición horaria → válido. ---
{
  const ctx = cargarMotor();
  const turnosExistentes = [
    { id: "otro1", sedeId: "sede1", fecha: "2026-10-05", sillon: 1, horarioInicio: "08:00", horarioFin: "09:00" },
    { id: "elTurno", sedeId: "sede1", fecha: "2026-10-05", sillon: 2, horarioInicio: "09:00", horarioFin: "10:00" }
  ];
  const resultado = ctx.validarModificacionTurno(
    "med1", "sede1", "2026-10-05", "09:00", "10:00", 1, // sillón 1 está libre a esta hora
    [MEDICO], [SEDE], turnosExistentes, [], "elTurno", []
  );
  assert(resultado.valido === true, "[regresión] mismo sillón físico pero sin superposición horaria → válido");
}

// --- Prueba 5 (regresión): el propio turno (turnoIdExcluir) no debe contarse contra
// sí mismo, ni en el caso sillon=null ni en el caso de sillón físico. ---
{
  const ctx = cargarMotor();
  const turnosExistentes = [
    { id: "elTurno", sedeId: "sede1", fecha: "2026-10-05", sillon: 1, horarioInicio: "09:00", horarioFin: "10:00" }
  ];
  const resultado = ctx.validarModificacionTurno(
    "med1", "sede1", "2026-10-05", "09:00", "10:00", 1, // no cambia nada
    [MEDICO], [SEDE], turnosExistentes, [], "elTurno", []
  );
  assert(resultado.valido === true, "[regresión] el turno no choca contra sí mismo (turnoIdExcluir)");
}

console.log("\nTODAS LAS PRUEBAS DEL BUG PASARON\n");
