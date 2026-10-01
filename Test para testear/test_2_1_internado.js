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
const srcMensual = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-mensual.js"), "utf8");

const SEDES = [
  { id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "18:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }] },
  { id: "sede-corta", nombre: "Sede Horario Corto", horaApertura: "14:00", horaCierre: "20:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false, sillones: [{ numero: 1, tipo: "regular" }] }
];
const MEDICOS = [{ id: "med1", nombre: "Dr. Gómez", diasPorSede: { "Emilio Civit": ["lunes"] } }];

// ============ PARTE A: turnero-carga.js (checkbox, guardado directo, comprobante) ============

function domCarga() {
  return `<!DOCTYPE html><html><body>
    <div id="mensaje-general"></div>
    <button id="boton-guardar-turno"></button>
    <select id="campo-medico"><option value="med1">Dr. Gómez</option></select>
    <input id="campo-medico-otro-nombre"/>
    <select id="campo-sede-manual"></select>
    <input id="campo-ciclo" type="number"/>
    <input id="campo-sesion" type="number"/>
    <input id="campo-fecha" type="date"/>
    <input id="campo-premedicacion" type="checkbox"/>
    <div id="bloque-horario-manual"><input id="campo-horario-manual" type="time"/></div>
    <div id="bloque-sillon-backup" style="display:none;"><input id="campo-sillon-backup" type="checkbox"/></div>
    <label id="bloque-internado" style="display:none;"><input id="campo-internado" type="checkbox" onchange="alternarInternado()"/></label>
    <div id="bloque-prioridad-turno" style="display:none;"><select id="campo-prioridad-turno"></select></div>
    <input id="campo-nota-inicial-turno"/>
    <div id="contenedor-nota-inicial-turno"></div>
    <button id="boton-abrir-nota-inicial-turno"></button>
    <input id="campo-dias-turno" type="number"/>
    <div id="fecha-calculada-info"></div>
    <div id="bloque-dias-turno"></div>
    <div id="bloque-fecha-manual"></div>
    <div id="lista-protocolos"></div>
    <input id="campo-buscar-paciente"/>
    <div id="paciente-seleccionado"><span id="texto-paciente-seleccionado"></span></div>
    <div id="bloque-busqueda-paciente"></div>
    <div id="bloque-medico-otro" style="display:none;"></div>
    <div id="sede-automatica-info" style="display:none;"><span id="badge-sede-automatica"></span></div>
    <div id="aviso-sede-indefinida" style="display:none;"></div>
    <div id="resumen-duracion"></div>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
  </body></html>`;
}

function setupComunCarga(rol) {
  return `
    rolActualCarga = ${JSON.stringify(rol)};
    datosUsuarioActualCarga = { rol: ${JSON.stringify(rol)}, medicoId: "med1" };
    usuarioActualCarga = { uid: "u1" };
    pacienteSeleccionadoCarga = { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE", tipoDocumento: "DNI", numeroDocumento: "1234" };
    medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    turnosExistentes = [];
    bloqueosCacheCarga = [];
    protocolosSeleccionados = { fila1: { protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 } };
    modoFechaTurno = "manual";
  `;
}

// --- Prueba 1: visibilidad del checkbox Internado por rol ---
for (const [rol, esperado] of [["administrador", "block"], ["enfermeria", "block"], ["medico", "none"], ["administrativo", "none"]]) {
  const setupJs = setupComunCarga(rol) + `
    document.getElementById("campo-internado").checked = true;
    actualizarVisibilidadCamposEspeciales();
    window.__display = document.getElementById("bloque-internado").style.display;
    window.__checked = document.getElementById("campo-internado").checked;
  `;
  const dom = new JSDOM(domCarga().replace("</script>\n  </body>", `</script><script>${setupJs}</script>\n  </body>`), { runScripts: "dangerously" });
  assert(dom.window.__display === esperado, `[visibilidad internado] rol ${rol} → bloque-internado = "${esperado}"`);
  if (esperado === "none") {
    assert(dom.window.__checked === false, `[visibilidad internado] rol ${rol} → se destilda al ocultarse`);
  }
}

// --- Prueba 2: alternarInternado fuerza horario manual visible y oculta backup ---
{
  const setupJs = setupComunCarga("administrador") + `
    document.getElementById("campo-internado").checked = true;
    alternarInternado();
    window.__displayHorario = document.getElementById("bloque-horario-manual").style.display;
    window.__displayBackup = document.getElementById("bloque-sillon-backup").style.display;
  `;
  const dom = new JSDOM(domCarga().replace("</script>\n  </body>", `</script><script>${setupJs}</script>\n  </body>`), { runScripts: "dangerously" });
  assert(dom.window.__displayHorario === "block", "[alternarInternado, tildado] fuerza visible el horario manual");
  assert(dom.window.__displayBackup === "none", "[alternarInternado, tildado] oculta el checkbox de sillón backup");
}
{
  const setupJs = setupComunCarga("administrador") + `
    document.getElementById("campo-medico").value = "med1";
    document.getElementById("campo-internado").checked = false;
    alternarInternado();
    window.__displayHorario = document.getElementById("bloque-horario-manual").style.display;
  `;
  const dom = new JSDOM(domCarga().replace("</script>\n  </body>", `</script><script>${setupJs}</script>\n  </body>`), { runScripts: "dangerously" });
  assert(dom.window.__displayHorario === "block", "[alternarInternado, destildado] restaura el estado normal (admin igual ve horario manual)");
}

console.log("\n--- Parte A.1 (visibilidad) OK ---\n");

// --- Prueba 3: validación — falta horario manual con Internado tildado ---
function correrGuardarConInternado({ rol, internadoTildado, horario, stubGuardarInterno }) {
  const setupJs = setupComunCarga(rol) + `
    window.__spy = null;
    ${stubGuardarInterno ? `guardarTurnoInternado = async function(datosBasicos, horarioManualString) {
      window.__spy = { datosBasicos, horarioManualString };
    };` : ""}
    buscarYGuardarConHorarioManual = async function() { window.__llamoHorarioManual = true; };
    buscarYMostrarHuecos = async function() { window.__llamoBusquedaAutomatica = true; };
    window.__llamoHorarioManual = false;
    window.__llamoBusquedaAutomatica = false;

    document.getElementById("campo-medico").value = "med1";
    document.getElementById("campo-ciclo").value = "1";
    document.getElementById("campo-sesion").value = "1";
    document.getElementById("campo-fecha").value = "2026-10-05";
    document.getElementById("campo-internado").checked = ${internadoTildado};
    document.getElementById("campo-horario-manual").value = ${JSON.stringify(horario)};
    intentarGuardarTurno();
  `;
  const dom = new JSDOM(domCarga().replace("</script>\n  </body>", `</script><script>${setupJs}</script>\n  </body>`), { runScripts: "dangerously" });
  return {
    spy: dom.window.__spy,
    llamoHorarioManual: dom.window.__llamoHorarioManual,
    llamoBusquedaAutomatica: dom.window.__llamoBusquedaAutomatica,
    mensaje: dom.window.document.getElementById("mensaje-general").textContent
  };
}

{
  const r = correrGuardarConInternado({ rol: "administrador", internadoTildado: true, horario: "", stubGuardarInterno: true });
  assert(!r.spy, "[guardar internado, sin horario] no llega a guardar");
  assert(r.mensaje.includes("horario"), "[guardar internado, sin horario] pide el horario");
  assert(!r.llamoHorarioManual && !r.llamoBusquedaAutomatica, "[guardar internado, sin horario] no cae a ningún otro camino");
}
{
  const r = correrGuardarConInternado({ rol: "administrador", internadoTildado: true, horario: "10:30", stubGuardarInterno: true });
  assert(!!r.spy, "[guardar internado, con horario] llama a guardarTurnoInternado");
  assert(r.spy.horarioManualString === "10:30", "[guardar internado] horario pasado correctamente");
  assert(!r.llamoHorarioManual, "[guardar internado] NO llama a buscarYGuardarConHorarioManual (nunca busca sillón)");
  assert(!r.llamoBusquedaAutomatica, "[guardar internado] NO llama a la búsqueda automática");
}
{
  // Regresión: sin tildar Internado, con horario manual cargado, sigue yendo por el
  // camino de siempre (2.5/2.8) — el checkbox nuevo no rompe nada de lo existente.
  const r = correrGuardarConInternado({ rol: "administrador", internadoTildado: false, horario: "10:30", stubGuardarInterno: false });
  assert(r.llamoHorarioManual === true, "[regresión] sin Internado, horario manual sigue yendo por buscarYGuardarConHorarioManual");
}

console.log("\n--- Parte A.2 (ramas de guardado) OK ---\n");

// --- Prueba 4: guardarTurnoConHueco de punta a punta, con Firestore simulado ---
// Mock mínimo: guarda todo lo escrito por collection/doc, permite leerlo de vuelta.
function armarFirestoreMock() {
  const docs = {}; // "coleccion/id" -> data
  let contadorId = 0;
  function claveDoc(coleccion, id) { return `${coleccion}/${id}`; }
  function armarDocRef(coleccion, id) {
    return {
      id,
      collection(sub) { return armarColRef(`${coleccion}/${id}/${sub}`); },
      async get() {
        const data = docs[claveDoc(coleccion, id)];
        return { exists: !!data, data: () => data };
      },
      async update(cambios) {
        docs[claveDoc(coleccion, id)] = { ...(docs[claveDoc(coleccion, id)] || {}), ...cambios };
      }
    };
  }
  function armarColRef(coleccion) {
    return {
      doc(id) { return armarDocRef(coleccion, id || `auto${++contadorId}`); }
    };
  }
  function armarBatch() {
    const operaciones = [];
    return {
      set(ref, data) { operaciones.push({ tipo: "set", coleccion: ref.id ? null : null, ref, data }); },
      update(ref, data) { operaciones.push({ tipo: "update", ref, data }); },
      async commit() {
        for (const op of operaciones) {
          const clave = `${op.ref.__coleccion}/${op.ref.id}`;
          if (op.tipo === "set") {
            docs[clave] = { ...op.data };
          } else if (op.tipo === "update") {
            const actual = docs[clave] || {};
            const merge = { ...actual };
            for (const [k, v] of Object.entries(op.data)) {
              if (v && v.__merge) { merge[k] = { ...(actual[k] || {}), ...v.valor }; }
              else { merge[k] = v; }
            }
            docs[clave] = merge;
          }
        }
      }
    };
  }
  // Necesito que doc() lleve grabada su propia colección para el batch de arriba —
  // envuelvo armarDocRef para adjuntarla.
  function collectionConTag(coleccion) {
    return {
      doc(id) {
        const ref = armarDocRef(coleccion, id || `auto${++contadorId}`);
        ref.__coleccion = coleccion;
        return ref;
      }
    };
  }
  return {
    collection: collectionConTag,
    batch: armarBatch,
    _docs: docs
  };
}

function correrGuardarTurnoConHueco({ internado }) {
  const fsMock = armarFirestoreMock();
  const setupJs = setupComunCarga("administrador") + `
    db = window.__db;
    firebase = { firestore: { FieldValue: { serverTimestamp: () => "TS", increment: (n) => ({ __increment: n }) } } };
    window.__abrioComprobante = false;
    abrirComprobanteTurno = function() { window.__abrioComprobante = true; };
    window.__resultado = null;
    (async () => {
      const datosBasicos = {
        esMedicoOtro: false, medicoId: "med1", medicoNombre: "Dr. Gómez",
        sedeAutomatica: true, protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
        premedicacion: false, duracionTotalMinutos: 60, ciclo: 1, sesion: 1,
        diasSolicitados: null, fechaCalculadaDesdeDias: false, notaInicial: null, prioridad: null
        ${internado ? ", internado: true" : ""}
      };
      const hueco = { sedeId: "sede1", sedeNombre: "Emilio Civit", fecha: "2026-10-05",
        fechaLegible: "5 de octubre de 2026", horaInicio: "10:30", horaFin: "11:30",
        sillon: ${internado ? "null" : "1"} };
      await guardarTurnoConHueco(datosBasicos, hueco, null);
      window.__listo = true;
    })();
  `;
  const html = domCarga().replace("</script>\n  </body>", `</script><script>${setupJs}</script>\n  </body>`);
  const dom = new JSDOM(html, { runScripts: "dangerously", beforeParse(window) { window.__db = fsMock; } });
  return { dom, fsMock };
}

async function esperar(dom) {
  for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
}

(async () => {
  // --- internado: true ---
  {
    const { dom, fsMock } = correrGuardarTurnoConHueco({ internado: true });
    await esperar(dom);
    const turnoGuardado = Object.entries(fsMock._docs).find(([k]) => k.startsWith("turnos/"));
    assert(!!turnoGuardado, "[guardarTurnoConHueco, internado] se escribió un turno");
    const [, data] = turnoGuardado;
    assert(data.internado === true, "[guardarTurnoConHueco, internado] docTurno.internado === true");
    assert(data.sillon === null, "[guardarTurnoConHueco, internado] docTurno.sillon === null");
    assert(!("numeroComprobante" in data), "[guardarTurnoConHueco, internado] NUNCA se le escribe numeroComprobante");
    const contador = fsMock._docs["contadores/comprobantesTurno"];
    assert(!contador, "[guardarTurnoConHueco, internado] el contador de comprobantes NO se toca");
    assert(dom.window.__abrioComprobante === false, "[guardarTurnoConHueco, internado] NO se abre el comprobante");
    assert(dom.window.document.getElementById("mensaje-general").textContent.includes("internado"), "[guardarTurnoConHueco, internado] mensaje de éxito distinto, sin mencionar comprobante");
  }

  // --- internado: false (regresión) ---
  {
    const { dom, fsMock } = correrGuardarTurnoConHueco({ internado: false });
    await esperar(dom);
    const turnoGuardado = Object.entries(fsMock._docs).find(([k]) => k.startsWith("turnos/"));
    const [, data] = turnoGuardado;
    assert(!("internado" in data), "[regresión, turno común] docTurno NO lleva el campo internado en absoluto");
    assert(data.sillon === 1, "[regresión, turno común] sillón normal se guarda igual que siempre");
    const contador = fsMock._docs["contadores/comprobantesTurno"];
    assert(!!contador, "[regresión, turno común] el contador de comprobantes SÍ se incrementa");
    assert("numeroComprobante" in data, "[regresión, turno común] SÍ se le escribe numeroComprobante");
    assert(dom.window.__abrioComprobante === true, "[regresión, turno común] SÍ se abre el comprobante");
  }

  console.log("\n--- Parte A.3 (guardarTurnoConHueco con Firestore simulado) OK ---\n");
})();

// ============ PARTE B: turnero-grilla.js (tarjeta, arrastre, Modificar, detalle) ============

function domGrilla() {
  return `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-turno-grilla"></div>
    <div id="contenido-detalle-turno-grilla"></div>
    <div id="resumen-modificar-grilla"></div>
    <select id="campo-sede-modificar"></select>
    <select id="campo-medico-modificar"><option value="med1">Dr. Gómez</option></select>
    <div id="bloque-medico-otro-modificar" style="display:none;"><input id="campo-medico-otro-nombre-modificar"/></div>
    <select id="campo-sillon-modificar"></select>
    <input id="campo-premedicacion-modificar" type="checkbox"/>
    <input id="campo-ciclo-modificar" type="number"/>
    <input id="campo-sesion-modificar" type="number"/>
    <input id="campo-obra-social-modificar"/>
    <div id="lista-protocolos-modificar"></div>
    <div id="resumen-duracion-modificar"></div>
    <div id="mensaje-modificar-grilla"></div>
    <div id="overlay-modificar-grilla"></div>
    <button id="boton-guardar-modificar-grilla"></button>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${srcGrilla}</script>
  </body></html>`;
}

const TURNO_INTERNADO = {
  id: "tInt", sedeId: "sede1", sedeNombre: "Emilio Civit", sedeAutomatica: false,
  medicoId: "med1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sillon: null,
  horarioInicio: "10:30", horarioFin: "11:30", fecha: "2026-10-05",
  protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
  premedicacion: false, ciclo: 1, sesion: 1, tipoSobreturno: null, internado: true,
  paciente: { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" }
};
const TURNO_COMUN = { ...TURNO_INTERNADO, id: "tComun", sillon: 1, internado: undefined };
delete TURNO_COMUN.internado;

// --- Prueba 5: renderizarTarjetaTurnoGrilla — altura fija, badge, clase, tooltip ---
{
  const setupJs = `
    rolActualGrilla = "administrador";
    window.__html = renderizarTarjetaTurnoGrilla(
      ${JSON.stringify(TURNO_INTERNADO)}, 480,
      ${JSON.stringify(SEDES[0])}, { lane: 0, totalLanes: 1 }
    );
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(html.includes('height:20px'), "[tarjeta internado] altura fija de 20px, sin importar la duración");
  // Etapa 5C, ajuste del 2.1 (pedido de Elías): "Int." con óvalo propio (rojo).
  assert(html.includes(">Int.<") && !html.includes(">Internado<"), "[tarjeta internado] el badge de sillón dice \"Int.\" (antes \"Internado\")");
  assert(/class="badge-sillon-grilla\s+\s*internado"/.test(html), "[tarjeta internado] el óvalo lleva la clase internado (color propio)");
  assert(html.includes("internado-grilla"), "[tarjeta internado] tiene la clase visual internado-grilla");
  assert(html.includes("Internado") && html.includes("title="), "[tarjeta internado] el tooltip incluye \"Internado\"");
  assert(html.includes('type="checkbox" class="checkbox-presente-grilla"'), "[tarjeta internado] mantiene el checkbox de presente");
  assert(html.includes("badge-notas-grilla"), "[tarjeta internado] mantiene el ícono de comentario");
}
{
  // Regresión: un turno común no debe llevar ninguna de estas marcas.
  const setupJs = `
    rolActualGrilla = "administrador";
    window.__html = renderizarTarjetaTurnoGrilla(
      ${JSON.stringify(TURNO_COMUN)}, 480,
      ${JSON.stringify(SEDES[0])}, { lane: 0, totalLanes: 1 }
    );
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(!html.includes("internado-grilla"), "[regresión, turno común] sin clase internado-grilla");
  assert(html.includes(">S1<"), "[regresión, turno común] badge de sillón normal (S1)");
  assert(!html.includes('height:20px'), "[regresión, turno común] la altura sigue calculándose por duración (60 min ≠ 20px)");
}

console.log("\n--- Parte B.1 (renderizarTarjetaTurnoGrilla) OK ---\n");

// --- Prueba 6: puedeArrastrarTurnoGrilla con internado ---
// NOTA: superada en parte por la ampliación (ver test_2_1_ampliacion.js, Grupo 3) — acá
// solo queda la parte que NO cambió: médico nunca puede, ni con lo suyo propio.
{
  const setupJs = `
    rolActualGrilla = "medico";
    datosUsuarioActualGrilla = { medicoId: "med1" };
    medicosCacheGrilla = [];
    window.__puede = puedeArrastrarTurnoGrilla(${JSON.stringify(TURNO_INTERNADO)});
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__puede === false, "[arrastre internado] médico nunca puede, ni con lo suyo propio (sin cambios en la ampliación)");
}
{
  const setupJs = `
    rolActualGrilla = "administrador";
    window.__puede = puedeArrastrarTurnoGrilla(${JSON.stringify(TURNO_COMUN)});
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__puede === true, "[regresión] un turno común de administrador sigue siendo arrastrable");
}

// --- Prueba 7: poblarSelectSillonModificar con forzarSinAsignar ---
{
  const setupJs = `
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    poblarSelectSillonModificar("sede1", null, true);
    window.__opciones = Array.from(document.getElementById("campo-sillon-modificar").options).map(o => o.value);
    window.__disabled = document.getElementById("campo-sillon-modificar").disabled;
    window.__valor = document.getElementById("campo-sillon-modificar").value;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__opciones.length === 1 && dom.window.__opciones[0] === "", "[sillón, internado] un único option (\"Sin asignar\")");
  assert(dom.window.__disabled === true, "[sillón, internado] select deshabilitado");
  assert(dom.window.__valor === "", "[sillón, internado] valor en blanco");
}
{
  // Regresión: sin forzarSinAsignar, sigue mostrando los sillones reales de la sede.
  const setupJs = `
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    poblarSelectSillonModificar("sede1", 2, false);
    window.__opciones = Array.from(document.getElementById("campo-sillon-modificar").options).map(o => o.value);
    window.__disabled = document.getElementById("campo-sillon-modificar").disabled;
    window.__valor = document.getElementById("campo-sillon-modificar").value;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__opciones.length === 3, "[regresión, sillón común] sigue listando los sillones reales de la sede");
  assert(dom.window.__disabled === false, "[regresión, sillón común] select habilitado");
  assert(dom.window.__valor === "2", "[regresión, sillón común] respeta el sillón actual pasado");
}

// --- Prueba 8: cambiarSedeModificar propaga el flag de internado del turno actual ---
{
  const setupJs = `
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    turnoIdModificarActual = "tInt";
    document.getElementById("campo-sede-modificar").value = "sede-corta";
    cambiarSedeModificar();
    window.__disabled = document.getElementById("campo-sillon-modificar").disabled;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__disabled === true, "[cambiarSedeModificar, internado] al cambiar de sede, el sillón sigue forzado a \"Sin asignar\"");
}

console.log("\n--- Parte B.2 (arrastre, sillón en Modificar) OK ---\n");

// --- Prueba 9: guardarModificacionGrilla salta validarModificacionTurno para internado ---
function correrGuardarModificacionInternado(turno) {
  const setupJs = `
    rolActualGrilla = "administrador"; rolActualCarga = "administrador";
    datosUsuarioActualGrilla = { rol: "administrador", medicoId: "med1" };
    usuarioActualGrilla = { uid: "u1" };
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = []; cuposCacheCarga = []; bloqueosCacheCarga = [];
    turnosCacheGrilla = [${JSON.stringify(turno)}];
    turnoIdModificarActual = ${JSON.stringify(turno.id)};
    protocolosSeleccionadosModificar = { fila1: { protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 } };
    window.__spy = null;
    abrirModalMotivoGrilla = function(t, camposNuevos) { window.__spy = { camposNuevos }; };

    poblarSelectSedeModificar(turnosCacheGrilla[0]);
    poblarSelectMedicoModificar(turnosCacheGrilla[0]);
    poblarSelectSillonModificar(turnosCacheGrilla[0].sedeId, turnosCacheGrilla[0].sillon, turnosCacheGrilla[0].internado === true);
    // Sede horario-corto: 14:00-20:00 — el turno es a las 10:30, fuera de ese horario.
    // Si la validación NO se saltea, esto tiene que rechazarse.
    document.getElementById("campo-sede-modificar").value = "sede-corta";
    if (!turnosCacheGrilla[0].internado) { cambiarSedeModificar(); document.getElementById("campo-sillon-modificar").value = "1"; }
    document.getElementById("campo-medico-modificar").value = "med1";
    document.getElementById("campo-ciclo-modificar").value = "1";
    document.getElementById("campo-sesion-modificar").value = "1";
    document.getElementById("campo-obra-social-modificar").value = "OSDE";
    guardarModificacionGrilla();
  `;
  const html = domGrilla()
    .replace("</body>", `<div id="overlay-modificar-grilla"></div><script>${setupJs}</script></body>`);
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return { spy: dom.window.__spy, mensaje: dom.window.document.getElementById("mensaje-modificar-grilla").textContent };
}

{
  const r = correrGuardarModificacionInternado(TURNO_INTERNADO);
  assert(!!r.spy, "[modificar internado, sede con horario incompatible] SE CONFIRMA igual — la validación de horario/atadura/cupo no aplica");
}
{
  const r = correrGuardarModificacionInternado(TURNO_COMUN);
  assert(!r.spy, "[regresión, turno común, sede con horario incompatible] SIGUE RECHAZÁNDOSE como antes");
  assert(r.mensaje.includes("horario de atención"), "[regresión] mensaje de error de horario, sin cambios");
}

console.log("\n--- Parte B.3 (guardarModificacionGrilla salta validación) OK ---\n");

// --- Prueba 10: abrirDetalleTurnoGrilla muestra la fila Internado y "No aplica" en Sillón ---
{
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)};
    sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    rolActualGrilla = "administrador"; datosUsuarioActualGrilla = { medicoId: "med1" };
    abrirDetalleTurnoGrilla("tInt");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(html.includes("No aplica (internado)"), "[detalle internado] fila Sillón dice \"No aplica (internado)\"");
  assert(/Internado<\/span>\s*<span>Sí/.test(html), "[detalle internado] fila propia \"Internado: Sí\"");
}
{
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)};
    sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_COMUN)}];
    rolActualGrilla = "administrador"; datosUsuarioActualGrilla = { medicoId: "med1" };
    abrirDetalleTurnoGrilla("tComun");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(!dom.window.__html.includes(">Internado<"), "[regresión, detalle turno común] sin fila \"Internado\"");
}

// --- Prueba 11: abrirModificarGrilla — resumen muestra Internado, y bloquea el sillón ---
{
  const setupJs = `
    rolActualGrilla = "administrador"; rolActualCarga = "administrador";
    datosUsuarioActualGrilla = { rol: "administrador", medicoId: "med1" };
    usuarioActualGrilla = { uid: "u1" };
    sedesCacheCarga = ${JSON.stringify(SEDES)}; medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = []; cuposCacheCarga = []; bloqueosCacheCarga = [];
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    cargarMedicosCarga = async function() {}; cargarSedesCarga = async function() {};
    cargarProtocolosCarga = async function() {}; cargarTurnosExistentes = async function() {};
    cargarCuposCarga = async function() {}; cargarBloqueosCarga = async function() {};
    window.__listo = false;
    abrirModificarGrilla("tInt").then(() => {
      window.__resumen = document.getElementById("resumen-modificar-grilla").innerHTML;
      window.__sillonDisabled = document.getElementById("campo-sillon-modificar").disabled;
      window.__listo = true;
    });
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  (async () => {
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    assert(dom.window.__resumen.includes("Internado"), "[abrirModificarGrilla, internado] el resumen menciona que es internado");
    assert(dom.window.__sillonDisabled === true, "[abrirModificarGrilla, internado] el select de sillón arranca deshabilitado");
    console.log("\n--- Parte B.4 (detalle y abrirModificarGrilla) OK ---\n");
  })();
}

// --- Prueba 12 (regresión del bug que encontré yo mismo al testear): Modificar y
// Eliminar tienen que seguir disponibles para un internado; Reasignar y "Reimprimir
// comprobante" NO. ---
{
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)};
    sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    rolActualGrilla = "administrador"; datosUsuarioActualGrilla = { medicoId: "med1" };
    abrirDetalleTurnoGrilla("tInt");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(html.includes("abrirModificarGrilla"), "[detalle internado] el botón Modificar sigue estando");
  assert(html.includes("abrirEliminarGrilla"), "[detalle internado] el botón Eliminar sigue estando");
  assert(html.includes("abrirReasignarGrilla"), "[detalle internado, administrador] el botón Reasignar SÍ aparece (superado por la ampliación — ver test_2_1_ampliacion.js Grupo 8)");
  assert(!html.includes("Reimprimir comprobante"), "[detalle internado] el botón \"Reimprimir comprobante\" NO aparece (nunca hubo uno)");
}
{
  // Regresión: un turno común sigue teniendo los cuatro botones de siempre.
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)};
    sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_COMUN)}];
    rolActualGrilla = "administrador"; datosUsuarioActualGrilla = { medicoId: "med1" };
    abrirDetalleTurnoGrilla("tComun");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(html.includes("abrirModificarGrilla") && html.includes("abrirEliminarGrilla") &&
    html.includes("abrirReasignarGrilla") && html.includes("Reimprimir comprobante"),
    "[regresión, detalle turno común] los cuatro botones de siempre siguen estando");
}

// Prueba 13 (abrirReasignarGrilla con internado) se movió por completo a
// test_2_1_ampliacion.js, Grupo 6 — ese archivo tiene el DOM completo del modal de
// Reasignar; acá solo quedaba un resguardo mínimo que ya no aporta nada distinto.

console.log("\n--- Parte B.5 (arreglo de botones Modificar/Eliminar/Reasignar) OK ---\n");

// ============ PARTE C: turnero-mensual.js ============

function domMensual() {
  return `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-mensual"></div>
    <div id="contenido-detalle-mensual"></div>
    <script>${srcMotor}</script>
    <script>${srcMensual}</script>
  </body></html>`;
}

// --- Prueba 14: renderizarLineaTurnoMensual — clase visual ---
{
  const setupJs = `
    window.__html = renderizarLineaTurnoMensual(${JSON.stringify(TURNO_INTERNADO)}, ${JSON.stringify(SEDES[0])});
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__html.includes("internado-mensual"), "[línea mensual, internado] tiene la clase internado-mensual");
}
{
  const setupJs = `
    window.__html = renderizarLineaTurnoMensual(${JSON.stringify(TURNO_COMUN)}, ${JSON.stringify(SEDES[0])});
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(!dom.window.__html.includes("internado-mensual"), "[regresión, línea mensual turno común] sin la clase");
}

// --- Prueba 15: armarTooltipTurnoMensual ---
{
  const setupJs = `
    window.__tooltip = armarTooltipTurnoMensual(${JSON.stringify(TURNO_INTERNADO)}, ${JSON.stringify(SEDES[0])});
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__tooltip.includes("Internado (no ocupa sillón)"), "[tooltip mensual, internado] dice \"Internado (no ocupa sillón)\"");
  assert(!dom.window.__tooltip.includes("Sobreturno sin sillón"), "[tooltip mensual, internado] NO dice \"Sobreturno sin sillón\" (se confundiría)");
}
{
  const setupJs = `
    window.__tooltip = armarTooltipTurnoMensual(${JSON.stringify(TURNO_COMUN)}, ${JSON.stringify(SEDES[0])});
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__tooltip.includes("Sillón 1"), "[regresión, tooltip mensual turno común] sigue diciendo el sillón normal");
}

// --- Prueba 16: abrirDetalleMensual — Sillón y fila Internado ---
{
  const setupJs = `
    sedesCacheMensual = ${JSON.stringify(SEDES)};
    sedeSeleccionadaMensual = "sede1";
    turnosMesMensual = [${JSON.stringify(TURNO_INTERNADO)}];
    function urlAgendaSemanaMensual() { return "agenda.html"; }
    abrirDetalleMensual("tInt");
    window.__html = document.getElementById("contenido-detalle-mensual").innerHTML;
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  assert(html.includes("No aplica (internado)"), "[detalle mensual, internado] fila Sillón dice \"No aplica (internado)\"");
  assert(/Internado<\/span>\s*<span>Sí/.test(html), "[detalle mensual, internado] fila propia \"Internado: Sí\"");
}
{
  const setupJs = `
    sedesCacheMensual = ${JSON.stringify(SEDES)};
    sedeSeleccionadaMensual = "sede1";
    turnosMesMensual = [${JSON.stringify(TURNO_COMUN)}];
    function urlAgendaSemanaMensual() { return "agenda.html"; }
    abrirDetalleMensual("tComun");
    window.__html = document.getElementById("contenido-detalle-mensual").innerHTML;
  `;
  const dom = new JSDOM(domMensual().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(!dom.window.__html.includes(">Internado<"), "[regresión, detalle mensual turno común] sin fila \"Internado\"");
}

console.log("\n--- Parte C (turnero-mensual.js) OK ---\n");
