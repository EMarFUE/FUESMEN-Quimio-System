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

// Fechas lejanas a propósito: así "hoy" nunca coincide y ningún turno queda protegido por
// el criterio temporal sin que la prueba lo pida.
const LUNES = "2030-10-07", MARTES = "2030-10-08";
const sede = { id: "s1", nombre: "Emilio Civit", horaApertura: "09:00", horaCierre: "13:00", diasAtencion: ["lunes", "martes"],
  usaAtaduraDia: false, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }] };
const MEDICOS = [{ id: "m1", nombre: "Dr. Gómez", diasPorSede: {} }];
const T = (id, sillon, i, f, ape, fecha) => ({ id, sedeId: "s1", fecha: fecha || LUNES, sillon, horarioInicio: i, horarioFin: f, medicoId: "m2",
  paciente: { id: "p" + id, apellido: ape || "Ape" + id, nombre: "Nom" + id } });
// Lunes: ningún sillón tiene 75 min seguidos libres, pero reacomodando entra (ver auditoría).
const lunesLleno = [T("t0", 1, "09:00", "11:15", "Pérez"), T("t1", 1, "12:00", "13:00"), T("t2", 2, "09:00", "10:45", "Gómez"), T("t3", 2, "11:30", "13:00")];
const datosBase = { medicoId: "m1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sedeId: "s1", sedeNombre: "Emilio Civit", sedeAutomatica: false,
  protocolos: [{ protocoloId: "p", nombre: "FEC", duracionMinutos: 75 }], premedicacion: false, duracionTotalMinutos: 75, ciclo: 1, sesion: 1, fecha: LUNES };

async function correr({ rol, turnos, modoReasignar, clic }) {
  const setup = `
    rolActualCarga = ${JSON.stringify(rol)}; datosUsuarioActualCarga = { rol: ${JSON.stringify(rol)} }; usuarioActualCarga = { uid: "u" };
    sedesCacheCarga = ${JSON.stringify([sede])}; medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = ${JSON.stringify(turnos)}; cuposCacheCarga = []; bloqueosCacheCarga = [];
    window.__guardados = [];
    guardarTurnoConHueco = async function(d, h, tipo, cambios) { window.__guardados.push({ hueco: h, cambios: cambios || null }); };
    window.__fin = false;
    buscarYMostrarHuecos(${JSON.stringify({ ...datosBase, ...(modoReasignar ? { modoReasignar: true, turnoIdParaReasignar: "x" } : {}) })}, { id: "pN", obraSocial: "OSDE" })
      .then(() => { window.__fin = true; });
  `;
  const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div><div id="mensaje-reasignar-grilla"></div><button id="boton-guardar-turno"></button>
    <script>${srcMotor}</script><script>${srcCarga}</script><script>
      mostrarMensajeReasignarGrilla = function() {};
      ${setup}
    </script></body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  const w = dom.window;
  for (let i = 0; i < 300 && !w.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
  const modal = w.document.getElementById("modal-sobreturno");
  const visible = !!(modal && modal.style.display === "block");
  const texto = visible ? modal.textContent.replace(/\s+/g, " ") : "";
  if (clic && visible) {
    const btn = Array.from(modal.querySelectorAll("button")).find(b => clic.test(b.textContent));
    if (btn) { btn.click(); for (let i = 0; i < 300 && w.__guardados.length === 0; i++) { await new Promise(r => setTimeout(r, 0)); } }
  }
  return { visible, texto, guardados: w.__guardados, modalVisibleDespues: !!(modal && modal.style.display === "block") };
}

(async () => {
  // ---- Motor directo: sin el parámetro, nada cambia ----
  {
    const c = { console: { log() {}, warn() {}, error() {} } }; vm.createContext(c); vm.runInContext(srcMotor, c);
    const args = ["m1", "", 75, LUNES, MEDICOS, [sede], lunesLleno, false, "s1", [], "pN", undefined, [], null, [], false];
    const sin = await c.buscarHuecosConReacomodo(...args);
    const con = await c.buscarHuecosConReacomodo(...args, true);
    assert(sin.exito && sin.huecosEncontrados[0].fecha === MARTES && !sin.alternativaReacomodo, "[motor] sin el parámetro: da el martes, sin alternativa (igual que antes)");
    assert(con.exito && con.huecosEncontrados[0].fecha === MARTES && con.alternativaReacomodo && con.alternativaReacomodo.hueco.fecha === LUNES,
      "[motor] con el parámetro: sigue dando el martes y además ofrece el lunes reacomodando");
    assert(con.reacomodo === null, "[motor] la opción principal (otro día) no mueve a nadie");
  }

  // ---- Administrador: aparece el cartel, nada se guarda solo ----
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno });
    assert(r.visible && r.guardados.length === 0, "[admin] aparece el cartel y no se guarda nada hasta elegir");
    assert(/está completo/.test(r.texto) && /Otro día, sin mover a nadie/.test(r.texto) && /El día pedido, reacomodando sillones/.test(r.texto), "[admin] el cartel tiene las dos opciones aprobadas");
    // Los cambios esperados salen del motor (la solución óptima), no de una suposición.
    const c = { console: { log() {}, warn() {}, error() {} } }; vm.createContext(c); vm.runInContext(srcMotor, c);
    const con = await c.buscarHuecosConReacomodo("m1", "", 75, LUNES, MEDICOS, [sede], lunesLleno, false, "s1", [], "pN", undefined, [], null, [], false, true);
    const esperados = con.alternativaReacomodo.cambios;
    const nombre = id => { const t = lunesLleno.find(x => x.id === id); return `${t.paciente.apellido}, ${t.paciente.nombre}`; };
    assert(esperados.length > 0 && esperados.every(ch => r.texto.includes(`${nombre(ch.turnoId)}: sillón ${ch.sillonAnterior} → ${ch.sillonNuevo}`)),
      "[admin] lista por nombre, con sillón de origen y destino, a cada paciente que cambia de sillón");
    assert(/^ ?El lunes, 7 de octubre de 2030 está completo/.test(r.texto), "[admin] título en minúscula: 'El lunes, 7 de octubre de 2030 está completo'");
  }
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, clic: /^\s*Dar el turno el/ });
    assert(r.guardados.length === 1 && r.guardados[0].hueco.fecha === MARTES && r.guardados[0].cambios === null && !r.modalVisibleDespues,
      "[admin] 'Dar el turno el martes' guarda el martes sin mover a nadie y cierra el cartel");
  }
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, clic: /Reacomodar y dar el turno/ });
    assert(r.guardados.length === 1 && r.guardados[0].hueco.fecha === LUNES && r.guardados[0].cambios && r.guardados[0].cambios.length > 0,
      "[admin] 'Reacomodar y dar el turno el lunes' guarda el lunes junto con los cambios de sillón");
  }
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, clic: /^\s*Cancelar\s*$/ });
    assert(r.guardados.length === 0 && !r.modalVisibleDespues, "[admin] 'Cancelar' no guarda nada");
  }
  // ---- Enfermería: también ve el cartel ----
  {
    const r = await correr({ rol: "enfermeria", turnos: lunesLleno });
    assert(r.visible && r.guardados.length === 0, "[enfermería] también ve el cartel");
  }
  // ---- Médico: igual que antes, guarda directo el otro día ----
  {
    const r = await correr({ rol: "medico", turnos: lunesLleno });
    assert(!r.visible && r.guardados.length === 1 && r.guardados[0].hueco.fecha === MARTES && r.guardados[0].cambios === null,
      "[médico] sin cartel: guarda directo el martes, como antes");
  }
  // ---- El día pedido tiene lugar: sin cartel ----
  {
    const r = await correr({ rol: "administrador", turnos: [T("t0", 1, "09:00", "11:15")] });
    assert(!r.visible && r.guardados.length === 1 && r.guardados[0].hueco.fecha === LUNES, "[sin conflicto] el día pedido tiene lugar → guarda directo, sin cartel");
  }
  // ---- Ni reacomodando entra el día pedido: guarda el otro día directo, como antes ----
  {
    const lleno = [T("a", 1, "09:00", "13:00"), T("b", 2, "09:00", "13:00")];
    const r = await correr({ rol: "administrador", turnos: lleno });
    assert(!r.visible && r.guardados.length === 1 && r.guardados[0].hueco.fecha === MARTES, "[día imposible] si ni reacomodando entra, guarda el otro día directo (como antes)");
  }
  // ---- Reasignar: nunca se ofrece (sigue sin reacomodo) ----
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, modoReasignar: true });
    assert(!r.visible || !/reacomodando/.test(r.texto), "[reasignar] nunca ofrece reacomodar");
  }

  console.log("\nTODAS LAS PRUEBAS DE \"OTRO DÍA O REACOMODAR EL DÍA PEDIDO\" PASARON\n");
})();
