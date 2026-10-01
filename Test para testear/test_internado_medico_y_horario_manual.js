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
const srcDia = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-dia.js"), "utf8");
const srcCss = fs.readFileSync(path.join(__dirname, "../repo/css/styles.css"), "utf8");

const SEDE = { id: "s1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "18:00", diasAtencion: ["lunes", "martes", "miercoles", "jueves", "viernes"],
  usaAtaduraDia: false, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }, { numero: 3, tipo: "backup" }] };
const F = "2030-10-07";
const base = { sedeId: "s1", sedeNombre: "Emilio Civit", sedeAutomatica: false, medicoId: "med1", medicoNombre: "Dr. Gómez", esMedicoOtro: false,
  protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }], premedicacion: false, duracionTotalMinutos: 60, ciclo: 1, sesion: 1, fecha: F,
  paciente: { id: "P", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE", numeroDocumento: "1" }, estado: "activo" };
const INTERNADO = { ...base, id: "tInt", internado: true, sillon: null, horarioInicio: "10:00", horarioFin: "11:00" };
const COMUN = { ...base, id: "tCom", sillon: 1, horarioInicio: "12:00", horarioFin: "13:00" };
const MANUAL = { ...base, id: "tMan", sillon: 2, horarioInicio: "14:00", horarioFin: "15:00", horarioManual: true };

function domGrilla(setupJs, extraScripts) {
  const html = `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-turno-grilla" style="display:none;"></div><div id="contenido-detalle-turno-grilla"></div>
    <div id="overlay-notas-turno-grilla" style="display:none;"></div><div id="lista-notas-turno-grilla"></div>
    <button id="boton-abrir-nueva-nota-grilla" style="display:inline-block;"></button>
    <div id="contenedor-nueva-nota-grilla" style="display:none;"><textarea id="campo-nueva-nota-grilla"></textarea></div>
    <div id="overlay-reasignar-grilla"></div><div id="mensaje-reasignar-grilla"></div>
    <script>window.ROLES = { administrador: "Administrador", enfermeria: "Enfermería", medico: "Médico" };</script>
    <script>${srcMotor}</script><script>${srcCarga}</script><script>${srcGrilla}</script>${extraScripts || ""}
    <script>${setupJs}</script></body></html>`;
  return new JSDOM(html, { runScripts: "dangerously" });
}
const setupRol = (rol) => `
  sedesCacheGrilla = ${JSON.stringify([SEDE])}; sedeSeleccionadaGrilla = "s1";
  turnosCacheGrilla = ${JSON.stringify([INTERNADO, COMUN, MANUAL])};
  rolActualGrilla = ${JSON.stringify(rol)}; datosUsuarioActualGrilla = { rol: ${JSON.stringify(rol)}, medicoId: "med1" };
  usuarioActualGrilla = { uid: "u1" }; medicosCacheGrilla = [];`;

(async () => {
  // ===== 1. Médico sin interacción con internados (grilla) =====
  {
    const dom = domGrilla(`${setupRol("medico")}
      window.__editInt = puedeEditarTurnoGrilla(turnosCacheGrilla[0]);
      window.__arrInt = puedeArrastrarTurnoGrilla(turnosCacheGrilla[0]);
      window.__editCom = puedeEditarTurnoGrilla(turnosCacheGrilla[1]);
      abrirDetalleTurnoGrilla("tInt"); window.__detInt = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
      abrirDetalleTurnoGrilla("tCom"); window.__detCom = document.getElementById("contenido-detalle-turno-grilla").innerHTML;`);
    const w = dom.window;
    assert(w.__editInt === false && w.__arrInt === false, "[médico] no puede editar ni arrastrar un internado propio");
    assert(!/abrirModificarGrilla|abrirEliminarGrilla|abrirReasignarGrilla/.test(w.__detInt), "[médico] el detalle de un internado propio no tiene Modificar/Eliminar/Reasignar");
    assert(!w.__detInt.includes("actualizarPrioridadTurnoGrilla"), "[médico] no puede editar la prioridad de un internado propio");
    assert(w.__editCom === true && /abrirModificarGrilla/.test(w.__detCom) && w.__detCom.includes("actualizarPrioridadTurnoGrilla"),
      "[médico, regresión] en un turno común propio sigue pudiendo modificar y editar prioridad");
  }
  for (const rol of ["administrador", "enfermeria"]) {
    const dom = domGrilla(`${setupRol(rol)}
      window.__editInt = puedeEditarTurnoGrilla(turnosCacheGrilla[0]); window.__arrInt = puedeArrastrarTurnoGrilla(turnosCacheGrilla[0]);`);
    assert(dom.window.__editInt === true && dom.window.__arrInt === true, `[${rol}] sigue interactuando con internados como antes`);
  }

  // ===== 2. Comentarios de un internado: solo lectura para el médico =====
  async function abrirNotas(rol, turnoId) {
    const dom = domGrilla(`${setupRol(rol)}
      db = { collection: () => ({ doc: () => ({ collection: () => ({ orderBy: () => ({ get: async () => ({ docs: [
        { id: "n1", data: () => ({ texto: "nota propia", autorUid: "u1", autorNombre: "Yo", autorRol: "medico" }) } ] }) }) }) }) }) };
      window.__fin = false; abrirNotasTurnoGrilla(${JSON.stringify(turnoId)}).then(() => { window.__fin = true; });`);
    for (let i = 0; i < 100 && !dom.window.__fin; i++) await new Promise(r => setTimeout(r, 0));
    const d = dom.window.document;
    return { botonAgregar: d.getElementById("boton-abrir-nueva-nota-grilla").style.display, lista: d.getElementById("lista-notas-turno-grilla").innerHTML };
  }
  {
    const r = await abrirNotas("medico", "tInt");
    assert(r.botonAgregar === "none" && r.lista.includes("nota propia") && !/Editar|Borrar/.test(r.lista), "[médico, internado] ve los comentarios pero no puede agregar, editar ni borrar");
    const rc = await abrirNotas("medico", "tCom");
    assert(rc.botonAgregar !== "none" && /Editar/.test(rc.lista), "[médico, turno común, regresión] sigue pudiendo comentar y editar su nota");
    const ra = await abrirNotas("administrador", "tInt");
    assert(ra.botonAgregar !== "none", "[administrador, internado] sigue pudiendo comentar");
  }

  // ===== 3. Badge "Int." con óvalo propio (semanal y diaria) + CSS =====
  {
    const dom = domGrilla(`${setupRol("administrador")}
      window.__tInt = renderizarTarjetaTurnoGrilla(turnosCacheGrilla[0], 480, sedesCacheGrilla[0], { lane: 0, totalLanes: 1 });
      window.__tCom = renderizarTarjetaTurnoGrilla(turnosCacheGrilla[1], 480, sedesCacheGrilla[0], { lane: 0, totalLanes: 1 });`);
    assert(/class="badge-sillon-grilla\s+internado"[^>]*>Int\.</.test(dom.window.__tInt), "[semanal] el internado muestra \"Int.\" con la clase internado");
    assert(/>S1</.test(dom.window.__tCom) && !/badge-sillon-grilla[^"]*internado/.test(dom.window.__tCom), "[semanal, regresión] un turno común muestra S1 y no lleva la clase internado");
  }
  {
    const dom = domGrilla(`${setupRol("administrador")}
      window.__fInt = renderizarFilaTurnoDia(turnosCacheGrilla[0], sedesCacheGrilla[0]);
      window.__fCom = renderizarFilaTurnoDia(turnosCacheGrilla[1], sedesCacheGrilla[0]);
      window.__fMan = renderizarFilaTurnoDia(turnosCacheGrilla[2], sedesCacheGrilla[0]);`, `<script>${srcDia}</script>`);
    const w = dom.window;
    assert(/class="badge-sillon-grilla\s+internado"[^>]*>Int\.</.test(w.__fInt) && !w.__fInt.includes(">S?<"), "[diaria] el internado muestra \"Int.\" (antes aparecía como \"S?\")");
    assert(w.__fMan.includes("badge-horario-manual-dia") && w.__fMan.includes("horario manual"), "[diaria] el turno con horario manual muestra su marca (con explicación al pasar el mouse)");
    assert(!w.__fCom.includes("badge-horario-manual-dia") && !w.__fInt.includes("badge-horario-manual-dia"), "[diaria] los turnos sin horario manual no la muestran");
  }
  assert(/\.badge-sillon-grilla\.internado\s*\{[^}]*background:\s*var\(--color-danger\)/.test(srcCss), "[css] el óvalo del internado es rojo, distinto del común (celeste) y del backup (verde)");

  // ===== 4. Detalle: fila de horario manual =====
  {
    const dom = domGrilla(`${setupRol("administrador")}
      abrirDetalleTurnoGrilla("tMan"); window.__dMan = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
      abrirDetalleTurnoGrilla("tCom"); window.__dCom = document.getElementById("contenido-detalle-turno-grilla").innerHTML;`);
    assert(dom.window.__dMan.includes("Horario manual") && !dom.window.__dCom.includes("Horario manual"), "[detalle] fila \"Horario manual\" solo en los turnos que la tienen");
  }

  // ===== 5. La marca: se pone con hora exacta, se pierde con Buscar y con arrastre =====
  {
    const dom = domGrilla(`${setupRol("administrador")}
      window.__campos = [];
      abrirModalMotivoGrilla = function(t, campos) { window.__campos.push(campos); };
      confirmarArrastreGrilla(turnosCacheGrilla[2], { hueco: { fecha: "${F}", horaInicio: "09:00", horaFin: "10:00", sillon: 1, sedeId: "s1", sedeNombre: "Emilio Civit" } });
      abrirMotivoReasignarGrilla({ turnoIdParaReasignar: "tMan" }, { fecha: "${F}", horaInicio: "09:00", horaFin: "10:00", sillon: 1, sedeId: "s1", sedeNombre: "Emilio Civit" }, null);
      abrirMotivoReasignarGrilla({ turnoIdParaReasignar: "tCom" }, { fecha: "${F}", horaInicio: "09:00", horaFin: "10:00", sillon: 1, sedeId: "s1", sedeNombre: "Emilio Civit", horarioManual: true }, null);`);
    const c = dom.window.__campos;
    assert(c[0] && c[0].horarioManual === false, "[arrastre] un turno con horario manual pierde la marca al arrastrarlo");
    assert(c[1] && c[1].horarioManual === false, "[reasignar → Buscar disponibilidad] pierde la marca (hueco del motor, sin horarioManual)");
    assert(c[2] && c[2].horarioManual === true, "[reasignar → hora exacta] queda marcado");
  }
  {
    // Modificar no toca la marca: anularYCrearTurnoGrilla parte de una copia del original.
    const i = srcGrilla.indexOf("async function anularYCrearTurnoGrilla");
    const cuerpo = srcGrilla.slice(i, i + 3000);
    assert(/Object\.assign\(docNuevo, camposNuevos\)/.test(cuerpo) && /\.\.\.turnoOriginal|Object\.assign\(\{\}, turnoOriginal|docNuevo = \{[\s\S]{0,200}turnoOriginal/.test(cuerpo),
      "[modificar] el turno nuevo parte de una copia del original, así que hereda horarioManual si no se lo pisa");
  }

  // ===== 6. Carga: "+ nuevo turno" con horario manual guarda horarioManual: true =====
  async function cargarConHorario(horarioManual) {
    const docs = {};
    const setup = `
      rolActualCarga = "administrador"; datosUsuarioActualCarga = { rol: "administrador", nombre: "Admin" }; usuarioActualCarga = { uid: "u1" };
      pacienteSeleccionadoCarga = ${JSON.stringify({ ...base.paciente, tipoDocumento: "DNI" })};
      medicosCacheCarga = [{ id: "med1", nombre: "Dr. Gómez", diasPorSede: {} }]; sedesCacheCarga = ${JSON.stringify([SEDE])};
      turnosExistentes = []; cuposCacheCarga = []; bloqueosCacheCarga = [];
      firebase = { firestore: { FieldValue: { serverTimestamp: () => "TS", increment: (n) => n } } };
      let cont = 0;
      const ref = (c, id) => ({ id, __c: c, get: async () => ({ exists: !!window.__docs[c + "/" + id], data: () => window.__docs[c + "/" + id] || {} }), update: async (x) => { window.__docs[c + "/" + id] = { ...(window.__docs[c + "/" + id] || {}), ...x }; }, set: async (x) => { window.__docs[c + "/" + id] = x; } });
      db = { collection: (c) => ({ doc: (id) => ref(c, id || "auto" + (++cont)), add: async (x) => { const id = "auto" + (++cont); window.__docs[c + "/" + id] = x; return ref(c, id); } }),
             batch: () => { const ops = []; return { set: (r, d) => ops.push([r, d]), update: (r, d) => ops.push([r, d, 1]), commit: async () => { for (const [r, d, u] of ops) window.__docs[r.__c + "/" + r.id] = u ? { ...(window.__docs[r.__c + "/" + r.id] || {}), ...d } : d; } }; },
             runTransaction: async (fn) => fn({ get: async () => ({ exists: false, data: () => ({}) }), set: () => {}, update: () => {} }) };
      window.__docs = {};
      mostrarComprobanteTurno = function() {}; resetearFormularioCarga = function() {}; cargarTurnosExistentes = async function() {};
      window.__fin = false;
      const datos = ${JSON.stringify({ medicoId: "med1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sedeId: "s1", sedeNombre: "Emilio Civit", sedeAutomatica: false,
        protocolos: base.protocolos, premedicacion: false, duracionTotalMinutos: 60, ciclo: 1, sesion: 1, fecha: F, pacienteId: "P", pacienteObraSocial: "OSDE" })};
      (${horarioManual ? `buscarYGuardarConHorarioManual(datos, "09:00", false)` : `buscarYMostrarHuecos(datos, { id: "P", obraSocial: "OSDE" })`}).then(() => { window.__fin = true; }, (e) => { window.__err = String(e); window.__fin = true; });`;
    const html = `<!DOCTYPE html><html><body><div id="mensaje-general"></div><button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script><script>${srcCarga}</script><script>${setup}</script></body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 300 && !dom.window.__fin; i++) await new Promise(r => setTimeout(r, 0));
    const turnos = Object.entries(dom.window.__docs).filter(([k]) => k.startsWith("turnos/")).map(([, v]) => v);
    return { turnos, err: dom.window.__err };
  }
  {
    const r = await cargarConHorario(true);
    assert(r.turnos.length === 1 && r.turnos[0].horarioManual === true, "[carga] con horario manual, el turno guardado lleva horarioManual: true" + (r.err ? " (" + r.err + ")" : ""));
    const r2 = await cargarConHorario(false);
    assert(r2.turnos.length === 1 && !("horarioManual" in r2.turnos[0]), "[carga, regresión] búsqueda automática: el turno NO lleva el campo");
  }

  // ===== 7. Reacomodo: un turno con horario manual nunca se mueve =====
  {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><script>${srcMotor}\n${srcCarga}\n
      turnosExistentes = ${JSON.stringify([COMUN, MANUAL])}; window.__ids = calcularTurnosNoReacomodablesIds();</script></body></html>`, { runScripts: "dangerously" });
    const ids = new Set(dom.window.__ids);
    assert(ids.has("tMan") && !ids.has("tCom"), "[reacomodo] el turno con horario manual queda protegido; uno común (futuro) no");
  }

  console.log("\nTODAS LAS PRUEBAS DE INTERNADO (MÉDICO/BADGE) Y HORARIO MANUAL PASARON\n");
})();
