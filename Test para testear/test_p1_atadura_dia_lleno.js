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
function cargarMotor() { const c = { console: { log() {}, warn() {}, error() {} } }; vm.createContext(c); vm.runInContext(srcMotor, c); return c; }

// Fechas lejanas a propósito (nunca "hoy"). 2030-10-07 es lunes.
const LUNES = "2030-10-07", MARTES = "2030-10-08", MARTES_SIG = "2030-10-15";
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const sede = (extra) => ({ id: "s1", nombre: "Emilio Civit", horaApertura: "09:00", horaCierre: "13:00", diasAtencion: DIAS,
  usaAtaduraDia: true, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }], ...(extra || {}) });
// El médico solo atiende los martes en esta sede: pedir un lunes dispara la atadura.
const MED = { id: "m1", nombre: "Dr. Gómez", diasPorSede: { "Emilio Civit": ["martes"] } };
const T = (id, sillon, i, f, fecha, extra) => ({ id, sedeId: "s1", fecha: fecha || LUNES, sillon, horarioInicio: i, horarioFin: f,
  medicoId: "m2", paciente: { id: "p" + id, apellido: "Ape" + id, nombre: "Nom" + id }, ...(extra || {}) });
const lunesLleno = [T("a", 1, "09:00", "13:00"), T("b", 2, "09:00", "13:00")];

function buscar(ctx, { turnos, esMedico, sedeCfg, fecha, excluir, paciente, bloqueos, dur }) {
  return ctx.buscarHuecos("m1", "", dur || 60, fecha || LUNES, [MED], [sedeCfg || sede()], turnos || [], !!esMedico, "s1", [],
    paciente || "pN", excluir, bloqueos || [], null);
}

(async () => {
  // ===================== PARTE A: motor =====================
  {
    const r = await buscar(cargarMotor(), { turnos: lunesLleno });
    const b = r.bloqueoAtadura;
    assert(r.exito === false && b && b.tipo === "confirmable", "[motor] atadura + día lleno (admin/enfermería) → bloqueoAtadura confirmable (antes: 'No hay lugar en 10 días')");
    assert(b.huecoDisponible && b.huecoDisponible.sinHuecoFisico === true && b.huecoDisponible.horaInicio === null && b.huecoDisponible.horaFin === null,
      "[motor] el hueco informado es un candidato sin hueco físico: sinHuecoFisico true y sin horas");
    assert(b.huecoDisponible.fecha === LUNES && b.huecoDisponible.sedeId === "s1" && b.huecoDisponible.sedeNombre === "Emilio Civit",
      "[motor] el candidato lleva el día pedido y la sede donde cortó la atadura");
    assert(b.nombreDiaSolicitado === "lunes" && JSON.stringify(b.diasAtencionMedico) === JSON.stringify(["martes"]), "[motor] informa el día pedido y los días del médico");
    assert(/no atiende/.test(r.sinHuecosMotivo) && !/10 días/.test(r.sinHuecosMotivo), "[motor] el motivo dice que el médico no atiende (ya no 'dentro de 10 días')");
    assert(/Además, ese día no queda lugar en ningún sillón/.test(r.sinHuecosMotivo), "[motor] el motivo agrega que el día no tiene lugar");
  }
  {
    const r = await buscar(cargarMotor(), { turnos: lunesLleno, esMedico: true });
    const b = r.bloqueoAtadura;
    assert(r.exito === false && b && b.tipo === "bloqueoTotal" && !b.huecoDisponible, "[motor, médico] atadura + día lleno → bloqueoTotal, sin opción de forzar");
    assert(b.nombreDiaSolicitado === "lunes" && JSON.stringify(b.diasAtencionMedico) === JSON.stringify(["martes"]), "[motor, médico] informa los días válidos del médico");
  }
  {
    const r = await buscar(cargarMotor(), { turnos: [] });
    const h = r.bloqueoAtadura && r.bloqueoAtadura.huecoDisponible;
    assert(h && h.horaInicio === "09:00" && h.horaFin === "10:00" && !h.sinHuecoFisico, "[motor, regresión] atadura con hueco físico libre: sigue ofreciendo ese hueco real (sin sinHuecoFisico)");
    assert(!/no queda lugar/.test(r.sinHuecosMotivo) && !("sinHuecoFisico" in h), "[motor, regresión] con hueco real el motivo y la forma del hueco quedan idénticos a antes");
  }
  {
    const bloqueo = { sedeId: "s1", tipo: "rango", fechaInicio: LUNES, fechaFin: LUNES, motivo: "Mantenimiento" };
    const r = await buscar(cargarMotor(), { turnos: [], bloqueos: [bloqueo] });
    assert(r.bloqueoAtadura && r.bloqueoAtadura.huecoDisponible && r.bloqueoAtadura.huecoDisponible.sinHuecoFisico === true,
      "[motor] día sin lugar por un bloqueo vigente + atadura → también avisa la atadura con sinHuecoFisico");
  }
  {
    const parcial = [T("a", 1, "09:00", "11:00"), T("b", 2, "09:00", "11:00")];
    const r = await buscar(cargarMotor(), { turnos: parcial, dur: 240 });
    assert(r.bloqueoAtadura && r.bloqueoAtadura.huecoDisponible.sinHuecoFisico === true, "[motor] el día pedido sin lugar para la duración completa (quedan solo 120 min libres) → sinHuecoFisico");
  }
  {
    // Día pedido ES del médico (martes) y está lleno: no hay atadura, la búsqueda sigue otros días como siempre.
    const llenoMartes = [T("a", 1, "09:00", "13:00", MARTES), T("b", 2, "09:00", "13:00", MARTES)];
    const r = await buscar(cargarMotor(), { turnos: llenoMartes, fecha: MARTES });
    assert(r.exito === true && !r.bloqueoAtadura && r.huecosEncontrados[0].fecha === MARTES_SIG, "[motor, regresión] día lleno que SÍ es del médico: sin atadura, da el martes siguiente");
  }
  {
    const r = await buscar(cargarMotor(), { turnos: lunesLleno, sedeCfg: sede({ usaAtaduraDia: false }) });
    assert(r.exito === true && !r.bloqueoAtadura, "[motor, regresión] sede sin atadura activada: nada cambia (busca otros días y encuentra)");
  }
  {
    const r = await buscar(cargarMotor(), { turnos: [...lunesLleno, T("x", 1, "14:00", "15:00", LUNES, { paciente: { id: "pN" } })] });
    assert(r.bloqueoPaciente === true && !r.bloqueoAtadura, "[motor, regresión] el paciente ya tiene turno ese día: sigue ganando el bloqueo de paciente");
  }
  {
    // Reasignar: el turno propio ocupa el día, pero se excluye (turnoIdExcluir) → queda lugar físico → hueco real, no sinHuecoFisico.
    const propio = T("propio", 1, "09:00", "10:00", LUNES, { paciente: { id: "P" } });
    const r = await buscar(cargarMotor(), { turnos: [propio, T("o", 2, "09:00", "13:00")], excluir: "propio", paciente: "P" });
    const h = r.bloqueoAtadura && r.bloqueoAtadura.huecoDisponible;
    assert(h && h.horaInicio === "09:00" && !h.sinHuecoFisico, "[motor, Reasignar] el turno propio no cuenta: si con él afuera hay lugar, el candidato es un hueco real");
  }
  {
    const m = cargarMotor();
    const r = await m.buscarHuecosConReacomodo("m1", "", 60, LUNES, [MED], [sede()], lunesLleno, false, "s1", [], "pN", undefined, [], null, [], false, true);
    assert(r.exito === false && r.bloqueoAtadura && r.bloqueoAtadura.huecoDisponible.sinHuecoFisico === true && r.reacomodo === null,
      "[motor, con reacomodo] atadura + día lleno: informa la atadura y no intenta reacomodar (no hay nada que reacomodar con atadura)");
  }
  {
    // Arrastre semanal: no cambia (no captura candidatos).
    const m = cargarMotor();
    const rs = await m.buscarHuecosSemanaEnSede("s1", "Emilio Civit", [new Date(2030, 9, 7)], 60, "09:00", "13:00", DIAS, lunesLleno, [1, 2], "m1", MED, true, false, [], new Set(), []);
    assert(rs[LUNES] && rs[LUNES].bloqueadoPorAtadura === true && rs[LUNES].huecos.length === 0, "[motor, regresión] búsqueda semanal del arrastre: el día de atadura sigue bloqueado y sin huecos");
  }

  // ===================== PARTE B: carga (flujo real con jsdom) =====================
  const datosBase = { medicoId: "m1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sedeId: "s1", sedeNombre: "Emilio Civit", sedeAutomatica: false,
    protocolos: [{ protocoloId: "p", nombre: "FEC", duracionMinutos: 60 }], premedicacion: false, duracionTotalMinutos: 60, ciclo: 1, sesion: 1, fecha: LUNES };

  async function correr({ rol, turnos, extraDatos, sedeCfg, accion, clic, pacienteId, bloqueos }) {
    const setup = `
      rolActualCarga = ${JSON.stringify(rol)}; datosUsuarioActualCarga = { rol: ${JSON.stringify(rol)} }; usuarioActualCarga = { uid: "u" };
      sedesCacheCarga = ${JSON.stringify([sedeCfg || sede()])}; medicosCacheCarga = ${JSON.stringify([MED])};
      turnosExistentes = ${JSON.stringify(turnos)}; cuposCacheCarga = []; bloqueosCacheCarga = ${JSON.stringify(bloqueos || [])};
      window.__guardados = [];
      guardarTurnoConHueco = async function(d, h, tipo, cambios) { window.__guardados.push({ hueco: h, tipo: tipo, cambios: cambios || null }); };
      mostrarMensajeReasignarGrilla = function() {};
      window.__fin = false;
      buscarYMostrarHuecos(${JSON.stringify({ ...datosBase, ...(extraDatos || {}) })}, { id: ${JSON.stringify(pacienteId || "pN")}, obraSocial: "OSDE" })
        .then(() => { window.__fin = true; });
    `;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div><div id="mensaje-reasignar-grilla"></div><button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const w = dom.window;
    for (let i = 0; i < 300 && !w.__fin; i++) { await new Promise(r => setTimeout(r, 0)); }
    const modal = w.document.getElementById("modal-bloqueo-atadura");
    const visible = !!(modal && modal.style.display === "block");
    const texto = visible ? modal.textContent.replace(/\s+/g, " ") : "";
    const sobreturnoGenerico = w.document.getElementById("modal-sobreturno");
    const hayGenerico = !!(sobreturnoGenerico && sobreturnoGenerico.style.display === "block");
    const botones = visible ? Array.from(modal.querySelectorAll("button")).map(b => b.textContent.trim()) : [];
    if (clic && visible) {
      const btn = Array.from(modal.querySelectorAll("button")).find(b => clic.test(b.textContent));
      if (btn) { btn.click(); for (let i = 0; i < 300 && w.__guardados.length === 0 && !/Cancelar/.test(clic.source); i++) { await new Promise(r => setTimeout(r, 0)); } }
    }
    return { visible, texto, botones, hayGenerico, guardados: w.__guardados, modalVisibleDespues: !!(modal && modal.style.display === "block"),
      botonHabilitado: w.document.getElementById("boton-guardar-turno").disabled === false };
  }

  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno });
    assert(r.visible && !r.hayGenerico && r.guardados.length === 0, "[carga, admin] aparece el cartel de atadura (no el de 'sin lugar en 10 días') y no se guarda nada solo");
    assert(/no atiende en Emilio Civit/.test(r.texto) && /ese día no queda lugar en ningún sillón/.test(r.texto) && /sobreturno sin sillón ese mismo día/.test(r.texto),
      "[carga, admin] el texto avisa la atadura Y que el día está completo, y ofrece sobreturno sin sillón");
    assert(r.botones.includes("Cargar igual como sobreturno este día") && r.botones.includes("Cancelar (elegir otra fecha)"), "[carga, admin] los dos botones aprobados");
  }
  {
    const r = await correr({ rol: "enfermeria", turnos: lunesLleno });
    assert(r.visible && /ese día no queda lugar en ningún sillón/.test(r.texto), "[carga, enfermería] también ve el cartel con el aviso de día completo");
  }
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, clic: /Cargar igual como sobreturno/ });
    assert(r.guardados.length === 1 && r.guardados[0].tipo === "ataduraDia", "[carga] 'Cargar igual' guarda UN turno con tipoSobreturno 'ataduraDia'");
    const h = r.guardados[0].hueco;
    assert(h.sillon === null && h.fecha === LUNES && h.sedeId === "s1", "[carga] queda sin sillón, el día pedido, en la sede donde cortó la atadura");
    // Día lleno hasta el cierre → el motor de sobreturno da la marca de 1 minuto al cierre (comportamiento ya existente de calcularBloqueSobreturno).
    const esperado = cargarMotor().calcularBloqueSobreturno("09:00", "13:00", lunesLleno, 60);
    assert(h.horaInicio === esperado.horaInicio && h.horaFin === esperado.horaFin && h.horaInicio !== null, `[carga] el horario sale de calcularBloqueSobreturno (${esperado.horaInicio}-${esperado.horaFin}), nunca null`);
    assert(!r.modalVisibleDespues, "[carga] el cartel se cierra al confirmar");
  }
  {
    // Día lleno para 240 min pero con lugar al final: el sobreturno ocupa lo que hay (no una marca de 1 minuto).
    const parcial = [T("a", 1, "09:00", "11:00"), T("b", 2, "09:00", "11:00")];
    const r = await correr({ rol: "administrador", turnos: parcial, extraDatos: { duracionTotalMinutos: 240 }, clic: /Cargar igual como sobreturno/ });
    const h = r.guardados[0] && r.guardados[0].hueco;
    assert(h && h.horaInicio === "11:00" && h.horaFin === "13:00", "[carga] con lugar parcial al final del día, el sobreturno ocupa de 11:00 a 13:00 (lo que queda)");
  }
  {
    // Día sin lugar por un bloqueo de 09:00 a 12:00 (queda 1 h libre y se piden 240 min): el sobreturno no cae en pleno bloqueo.
    const bloqueo = { sedeId: "s1", tipo: "rango", fechaInicio: LUNES, fechaFin: LUNES, horaInicio: "09:00", horaFin: "12:00", motivo: "Mantenimiento" };
    const r = await correr({ rol: "administrador", turnos: [], bloqueos: [bloqueo], extraDatos: { duracionTotalMinutos: 240 }, clic: /Cargar igual como sobreturno/ });
    const h = r.guardados[0] && r.guardados[0].hueco;
    assert(h && h.horaInicio === "12:00" && h.horaFin === "13:00", "[carga] el sobreturno respeta los bloqueos vigentes del día (12:00-13:00, no 09:00-13:00)");
  }
  {
    const r = await correr({ rol: "administrador", turnos: lunesLleno, clic: /^\s*Cancelar/ });
    assert(r.guardados.length === 0 && !r.modalVisibleDespues && r.botonHabilitado, "[carga] 'Cancelar' no guarda nada y deja el botón de guardar habilitado");
  }
  {
    const r = await correr({ rol: "medico", turnos: lunesLleno });
    assert(r.visible && !r.hayGenerico && r.guardados.length === 0, "[carga, médico] ve el cartel de atadura (no el genérico de sobreturno)");
    assert(/no atiende consultas en esta institución/.test(r.texto) && /martes/.test(r.texto), "[carga, médico] el mensaje le indica qué días le corresponden");
    assert(r.botones.length === 1 && r.botones[0] === "Entendido" && !/sobreturno/.test(r.texto), "[carga, médico] sin opción de sobreturno: solo 'Entendido'");
  }
  {
    // Reasignar: el turno propio está ese mismo día (un sobreturno de 12:00 a 13:00). Excluido, el día queda con lugar
    // para 60 min? No: el sillón 1 está ocupado 09:00-11:00 y el 2 también, y para 240 min no hay hueco → sinHuecoFisico.
    // El horario del sobreturno tiene que calcularse SIN el propio turno (si no, quedaría al final del día: 13:00-13:01).
    const propio = T("propio", null, "12:00", "13:00", LUNES, { paciente: { id: "P" }, tipoSobreturno: "ataduraDia" });
    const otros = [T("a", 1, "09:00", "11:00"), T("b", 2, "09:00", "11:00")];
    const r = await correr({ rol: "administrador", turnos: [propio, ...otros], pacienteId: "P",
      extraDatos: { modoReasignar: true, turnoIdParaReasignar: "propio", duracionTotalMinutos: 240 }, clic: /Cargar igual como sobreturno/ });
    const h = r.guardados[0] && r.guardados[0].hueco;
    assert(r.guardados.length === 1 && h && h.sillon === null, "[carga, Reasignar] 'Cargar igual' guarda el sobreturno sin sillón");
    assert(h && h.horaInicio === "11:00" && h.horaFin === "13:00", "[carga, Reasignar] el horario se calcula sin contar al propio turno (11:00-13:00, no 13:00-13:01)");
  }
  {
    // Un candidato con hueco físico real (caso de siempre) NO pasa por el cálculo nuevo: se guarda tal cual vino del motor.
    const r = await correr({ rol: "administrador", turnos: [], clic: /Cargar igual como sobreturno/ });
    const h = r.guardados[0] && r.guardados[0].hueco;
    assert(h && h.horaInicio === "09:00" && h.horaFin === "10:00" && h.sillon === null && r.guardados[0].tipo === "ataduraDia",
      "[carga, regresión] atadura con hueco libre: se guarda el hueco real del motor (09:00-10:00), como antes");
    assert(!/ese día no queda lugar/.test(r.texto), "[carga, regresión] y el cartel NO agrega la línea de 'día completo'");
  }

  console.log("\nTODAS LAS PRUEBAS DE P1 (ATADURA CON EL DÍA PEDIDO LLENO) PASARON\n");
})();
