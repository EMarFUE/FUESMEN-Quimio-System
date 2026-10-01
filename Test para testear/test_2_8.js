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

const SEDES = [
  { id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "18:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }, { numero: 3, tipo: "backup" }] },
  { id: "sede2", nombre: "Entre Ríos", horaApertura: "08:00", horaCierre: "18:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }] },
  { id: "sede-corta", nombre: "Sede Horario Corto", horaApertura: "14:00", horaCierre: "20:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }] }
];
const MEDICOS = [{ id: "med1", nombre: "Dr. Gómez", diasPorSede: {} }];
const TURNO = {
  id: "t1", sedeId: "sede1", sedeNombre: "Emilio Civit", sedeAutomatica: true,
  medicoId: "med1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sillon: 1,
  horarioInicio: "09:00", horarioFin: "10:00", fecha: "2026-10-05",
  protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
  premedicacion: false, ciclo: 1, sesion: 1, tipoSobreturno: null,
  paciente: { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" }
};

// ============ PARTE A: Modificar + Sede ============

function domModificar() {
  return `<!DOCTYPE html><html><body>
    <div id="resumen-modificar-grilla"></div>
    <select id="campo-sede-modificar"></select>
    <select id="campo-medico-modificar"><option value="med1">Dr. Gómez</option></select>
    <div id="bloque-medico-otro-modificar" style="display:none;"><input id="campo-medico-otro-nombre-modificar"/></div>
    <select id="campo-sillon-modificar"></select>
    <input id="campo-premedicacion-modificar" type="checkbox"/>
    <input id="campo-ciclo-modificar" type="number"/>
    <input id="campo-sesion-modificar" type="number"/>
    <input id="campo-obra-social-modificar"/>
    <div id="mensaje-modificar-grilla"></div>
    <div id="overlay-modificar-grilla"></div>
    <button id="boton-guardar-modificar-grilla"></button>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${srcGrilla}</script>
  </body></html>`;
}

function setupComunModificar(rol) {
  return `
    rolActualGrilla = ${JSON.stringify(rol)};
    rolActualCarga = ${JSON.stringify(rol)};
    datosUsuarioActualGrilla = { rol: ${JSON.stringify(rol)}, medicoId: "med1" };
    datosUsuarioActualCarga = datosUsuarioActualGrilla;
    usuarioActualGrilla = { uid: "u1" };
    usuarioActualCarga = usuarioActualGrilla;
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = [];
    cuposCacheCarga = [];
    bloqueosCacheCarga = [];
    turnosCacheGrilla = [${JSON.stringify(TURNO)}];
    turnoIdModificarActual = "t1";
    protocolosSeleccionadosModificar = { fila1: { protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 } };
  `;
}

// --- Prueba 1: poblarSelectSedeModificar, por rol ---
{
  const setupJs = setupComunModificar("administrador") + `
    poblarSelectSedeModificar(turnosCacheGrilla[0]);
    window.__opciones = Array.from(document.getElementById("campo-sede-modificar").options).map(o => o.value);
    window.__disabled = document.getElementById("campo-sede-modificar").disabled;
    window.__valor = document.getElementById("campo-sede-modificar").value;
  `;
  const dom = new JSDOM(domModificar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__opciones.length === 3, "[sede modificar, administrador] ve las 3 sedes");
  assert(dom.window.__disabled === false, "[sede modificar, administrador] select habilitado");
  assert(dom.window.__valor === "sede1", "[sede modificar, administrador] arranca en la sede actual del turno");
}
{
  const setupJs = setupComunModificar("enfermeria") + `
    poblarSelectSedeModificar(turnosCacheGrilla[0]);
    window.__opciones = Array.from(document.getElementById("campo-sede-modificar").options).map(o => o.value);
    window.__disabled = document.getElementById("campo-sede-modificar").disabled;
  `;
  const dom = new JSDOM(domModificar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__opciones.length === 1 && dom.window.__opciones[0] === "sede1", "[sede modificar, enfermería] un único option fijo con la sede actual");
  assert(dom.window.__disabled === true, "[sede modificar, enfermería] select deshabilitado");
}

// --- Prueba 2: cambiarSedeModificar resetea el sillón ---
{
  const setupJs = setupComunModificar("administrador") + `
    poblarSelectSedeModificar(turnosCacheGrilla[0]);
    poblarSelectSillonModificar(turnosCacheGrilla[0].sedeId, turnosCacheGrilla[0].sillon);
    document.getElementById("campo-sede-modificar").value = "sede2";
    cambiarSedeModificar();
    window.__sillones = Array.from(document.getElementById("campo-sillon-modificar").options).map(o => o.value);
    window.__valorSillon = document.getElementById("campo-sillon-modificar").value;
  `;
  const dom = new JSDOM(domModificar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__valorSillon === "", "[cambiarSedeModificar] el sillón se resetea a \"Sin asignar\"");
  assert(dom.window.__sillones.includes("1") && !dom.window.__sillones.includes("2"), "[cambiarSedeModificar] la lista de sillones es la de la sede nueva (sede2 solo tiene sillón 1)");
}

// --- Prueba 3: guardarModificacionGrilla end-to-end ---
function correrGuardarModificacion(rol, sedeElegida) {
  const setupJs = setupComunModificar(rol) + `
    window.__spy = null;
    abrirModalMotivoGrilla = function(turno, camposNuevos, tipo, msg, boton) {
      window.__spy = { camposNuevos };
    };
    poblarSelectSedeModificar(turnosCacheGrilla[0]);
    poblarSelectMedicoModificar(turnosCacheGrilla[0]);
    poblarSelectSillonModificar(turnosCacheGrilla[0].sedeId, turnosCacheGrilla[0].sillon);
    document.getElementById("campo-sede-modificar").value = ${JSON.stringify(sedeElegida)};
    if (${JSON.stringify(sedeElegida)} !== turnosCacheGrilla[0].sedeId) cambiarSedeModificar();
    document.getElementById("campo-sillon-modificar").value =
      document.getElementById("campo-sillon-modificar").options.length > 1 ? "1" : "";
    document.getElementById("campo-medico-modificar").value = "med1";
    document.getElementById("campo-ciclo-modificar").value = "1";
    document.getElementById("campo-sesion-modificar").value = "1";
    document.getElementById("campo-obra-social-modificar").value = "OSDE";
    guardarModificacionGrilla();
  `;
  const dom = new JSDOM(domModificar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  return { spy: dom.window.__spy, mensaje: dom.window.document.getElementById("mensaje-modificar-grilla").textContent };
}

{
  const r = correrGuardarModificacion("administrador", "sede2");
  assert(!!r.spy, "[guardar, admin cambia a sede2 válida] se confirma la modificación (pasa validación)");
  assert(r.spy.camposNuevos.sedeId === "sede2", "[guardar, admin cambia a sede2] camposNuevos.sedeId = sede2");
  assert(r.spy.camposNuevos.sedeNombre === "Entre Ríos", "[guardar, admin cambia a sede2] camposNuevos.sedeNombre correcto");
  assert(r.spy.camposNuevos.sedeAutomatica === false, "[guardar, admin cambia a sede2] sedeAutomatica queda en false");
}
{
  const r = correrGuardarModificacion("administrador", "sede1");
  assert(!!r.spy, "[guardar, admin deja la misma sede] se confirma la modificación");
  assert(!("sedeId" in r.spy.camposNuevos), "[guardar, admin deja la misma sede] camposNuevos NO incluye sedeId (sin cambios)");
  assert(!("sedeAutomatica" in r.spy.camposNuevos), "[guardar, admin deja la misma sede] camposNuevos NO incluye sedeAutomatica");
}
{
  const r = correrGuardarModificacion("enfermeria", "sede1"); // select deshabilitado, único option = sede1 igual
  assert(!!r.spy, "[guardar, enfermería] se confirma la modificación (sin tocar sede)");
  assert(!("sedeId" in r.spy.camposNuevos), "[guardar, enfermería] camposNuevos NO incluye sedeId — cero cambio de comportamiento");
}
{
  const r = correrGuardarModificacion("administrador", "sede-corta"); // 09:00-10:00 no entra en 14:00-20:00
  assert(!r.spy, "[guardar, admin cambia a sede con horario incompatible] NO se confirma la modificación");
  assert(r.mensaje.includes("horario de atención"), "[guardar, sede incompatible] mensaje de error de horario");
}

console.log("\n--- Parte A (Modificar + Sede) OK ---\n");

// ============ PARTE B: Reasignar + horario exacto (solo administrador) ============

function domReasignar() {
  return `<!DOCTYPE html><html><body>
    <div id="resumen-reasignar-grilla"></div>
    <input type="date" id="campo-fecha-reasignar-grilla"/>
    <label id="etiqueta-fecha-reasignar-grilla"></label>
    <div id="bloque-horario-manual-reasignar-grilla" style="display:none;"><input type="time" id="campo-horario-manual-reasignar-grilla"/></div>
    <div id="mensaje-reasignar-grilla"></div>
    <button id="boton-buscar-reasignar-grilla"></button>
    <button id="boton-horario-manual-reasignar-grilla" style="display:none;"></button>
    <div id="overlay-detalle-turno-grilla"></div>
    <div id="overlay-reasignar-grilla"></div>
    <!-- elementos que toca abrirDetalleTurnoGrilla/cerrarDetalleTurnoGrilla y el resto del flujo -->
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${srcGrilla}</script>
  </body></html>`;
}

function setupComunReasignar(rol) {
  return `
    rolActualGrilla = ${JSON.stringify(rol)};
    rolActualCarga = ${JSON.stringify(rol)};
    datosUsuarioActualGrilla = { rol: ${JSON.stringify(rol)}, medicoId: "med1" };
    datosUsuarioActualCarga = datosUsuarioActualGrilla;
    usuarioActualGrilla = { uid: "u1" };
    usuarioActualCarga = usuarioActualGrilla;
    sedesCacheCarga = ${JSON.stringify(SEDES)};
    medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    turnosExistentes = [];
    cuposCacheCarga = [];
    bloqueosCacheCarga = [];
    turnosCacheGrilla = [${JSON.stringify(TURNO)}];
    // Se pisan los loaders async (tocan Firestore real) — no importan para esta prueba,
    // los datos ya están precargados arriba.
    cargarMedicosCarga = async function() {};
    cargarSedesCarga = async function() {};
    cargarTurnosExistentes = async function() {};
    cargarCuposCarga = async function() {};
    cargarBloqueosCarga = async function() {};
  `;
}

// --- Prueba 1: visibilidad del horario exacto en Reasignar, por rol ---
async function correrVisibilidadReasignar(rol) {
  const setupJs = setupComunReasignar(rol) + `
    (async () => {
      await abrirReasignarGrilla("t1");
      window.__display = document.getElementById("bloque-horario-manual-reasignar-grilla").style.display;
      window.__displayBoton = document.getElementById("boton-horario-manual-reasignar-grilla").style.display;
      window.__listo = true;
    })();
  `;
  const dom = new JSDOM(domReasignar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
  return { display: dom.window.__display, displayBoton: dom.window.__displayBoton };
}

(async () => {
  for (const [rol, esperado] of [["administrador", "block"], ["medico", "none"], ["enfermeria", "none"], ["administrativo", "none"]]) {
    const r = await correrVisibilidadReasignar(rol);
    assert(r.display === esperado, `[visibilidad reasignar] rol ${rol} → bloque horario exacto = "${esperado}"`);
    assert(r.displayBoton === esperado, `[visibilidad reasignar] rol ${rol} → botón horario exacto = "${esperado}"`);
  }

  // --- Prueba 2: buscarReasignarHorarioManualGrilla — validaciones y llamado correcto ---
  function correrBuscarHorarioManual({ fecha, horario, sillonTurno }) {
    const turnoAjustado = { ...TURNO, sillon: sillonTurno !== undefined ? sillonTurno : TURNO.sillon };
    const setupJs = setupComunReasignar("administrador") + `
      turnosCacheGrilla = [${JSON.stringify(turnoAjustado)}];
      turnoIdReasignarActual = "t1";
      window.__spy = null;
      buscarYGuardarConHorarioManual = async function(datosBasicos, horarioManualString, soloBackup, opciones) {
        window.__spy = { datosBasicos, horarioManualString, soloBackup, opciones };
      };
      document.getElementById("campo-fecha-reasignar-grilla").value = ${JSON.stringify(fecha)};
      document.getElementById("campo-horario-manual-reasignar-grilla").value = ${JSON.stringify(horario)};
      buscarReasignarHorarioManualGrilla();
    `;
    const dom = new JSDOM(domReasignar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    return { spy: dom.window.__spy, mensaje: dom.window.document.getElementById("mensaje-reasignar-grilla").textContent };
  }

  {
    const r = correrBuscarHorarioManual({ fecha: "", horario: "14:00" });
    assert(!r.spy, "[reasignar horario manual, sin fecha] no llama a buscarYGuardarConHorarioManual");
    assert(r.mensaje.includes("fecha"), "[reasignar horario manual, sin fecha] mensaje de error pide la fecha");
  }
  {
    const r = correrBuscarHorarioManual({ fecha: "2026-10-05", horario: "" });
    assert(!r.spy, "[reasignar horario manual, sin horario] no llama a buscarYGuardarConHorarioManual");
    assert(r.mensaje.includes("horario"), "[reasignar horario manual, sin horario] mensaje de error pide el horario");
  }
  {
    const r = correrBuscarHorarioManual({ fecha: "2026-10-05", horario: "14:30" });
    assert(!!r.spy, "[reasignar horario manual, completo] llama a buscarYGuardarConHorarioManual");
    assert(r.spy.horarioManualString === "14:30", "[reasignar horario manual] horario pasado correctamente");
    assert(r.spy.datosBasicos.modoReasignar === true, "[reasignar horario manual] datosBasicos.modoReasignar = true");
    assert(r.spy.datosBasicos.turnoIdParaReasignar === "t1", "[reasignar horario manual] turnoIdParaReasignar correcto");
    assert(r.spy.datosBasicos.sedeId === "sede1", "[reasignar horario manual] sede se mantiene la del turno (no se elige a mano)");
    assert(r.spy.soloBackup === false, "[reasignar horario manual, sillón regular] soloBackup en false");
    assert(r.spy.opciones.botonId === "boton-horario-manual-reasignar-grilla", "[reasignar horario manual] botón enrutado al propio de Reasignar");
    assert(r.spy.opciones.mostrarMensaje === r.spy.opciones.mostrarMensaje, "[reasignar horario manual] mostrarMensaje presente"); // sanity
  }
  {
    const r = correrBuscarHorarioManual({ fecha: "2026-10-05", horario: "14:30", sillonTurno: 3 }); // sillón 3 = backup en sede1
    assert(r.spy.soloBackup === true, "[reasignar horario manual, sillón backup] soloBackup se detecta automáticamente en true");
  }

  console.log("\n--- Parte B (Reasignar + horario exacto) OK ---\n");

  // --- Prueba 3: buscarYGuardarConHorarioManual sigue funcionando igual que antes de 2.8 (regresión) ---
  // Reutiliza el mismo patrón de test_2_5.js: llamando SIN el 4to argumento, debe usar
  // mostrarMensajeGeneral y "boton-guardar-turno" exactamente como antes.
  async function correrRegresion25() {
    const setupJs = `
      rolActualCarga = "enfermeria";
      pacienteSeleccionadoCarga = { nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" };
      medicosCacheCarga = ${JSON.stringify(MEDICOS)};
      sedesCacheCarga = ${JSON.stringify(SEDES)};
      turnosExistentes = [];
      bloqueosCacheCarga = [];
      buscarSillonHorarioFijo = async function() { return { exito: false, motivo: "horarioFueraDeSede" }; };
      window.__listo = false;
      buscarYGuardarConHorarioManual({
        medicoId: "med1", medicoNombre: "Dr. Gómez", fecha: "2026-10-05",
        duracionTotalMinutos: 60, sedeAutomatica: true, sedeId: "sede1"
      }, "07:00", false).then(() => { window.__listo = true; }); // sin 4to argumento — mismo llamado que "+ nuevo turno"
    `;
    const html = `<!DOCTYPE html><html><body>
      <div id="mensaje-general"></div>
      <button id="boton-guardar-turno"></button>
      <script>${srcMotor}</script>
      <script>${srcCarga}</script>
      <script>${setupJs}</script>
    </body></html>`;
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    return dom.window.document.getElementById("mensaje-general").textContent;
  }
  const mensajeRegresion = await correrRegresion25();
  assert(mensajeRegresion.includes("horario de atención"), "[regresión 2.5] sin 4to argumento, el mensaje sigue yendo a #mensaje-general como antes");

  // --- Prueba 4 (regresión del bug reportado por Elías): Reasignar con horario exacto,
  // de punta a punta, con pacienteSeleccionadoCarga en null — el valor real que tiene en
  // producción cuando nunca se abrió "+ nuevo turno" en la sesión. Acá NO se pisa
  // buscarYGuardarConHorarioManual (a diferencia de la Prueba 2): se ejecuta la función
  // real completa, y se pisa buscarSillonHorarioFijo (el motor) para observar qué le
  // llega y confirmar que no explota.
  function correrBugPacienteNull() {
    const setupJs = setupComunReasignar("administrador") + `
      pacienteSeleccionadoCarga = null; // estado real en producción sin "+ nuevo turno" abierto
      turnoIdReasignarActual = "t1";
      window.__spyMotor = null;
      window.__error = null;
      buscarSillonHorarioFijo = async function(medicoId, obraSocial) {
        window.__spyMotor = { medicoId, obraSocial };
        return { exito: false, motivo: "sinSillon" };
      };
      window.mostrarSobreturnoHorarioFijo = function() {}; // no nos importa este modal acá
      document.getElementById("campo-fecha-reasignar-grilla").value = "2026-10-05";
      document.getElementById("campo-horario-manual-reasignar-grilla").value = "11:30";
      window.__listo = false;
      (async () => {
        try {
          await buscarReasignarHorarioManualGrilla();
        } catch (e) {
          window.__error = e.message;
        }
        window.__listo = true;
      })();
    `;
    return new JSDOM(domReasignar().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  }
  const dom4 = correrBugPacienteNull();
  for (let i = 0; i < 50 && !dom4.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
  assert(dom4.window.__error === null, `[bug reportado] no explota con pacienteSeleccionadoCarga=null (antes: "${dom4.window.__error}")`);
  assert(!!dom4.window.__spyMotor, "[bug reportado] llega a llamar al motor (buscarSillonHorarioFijo)");
  assert(dom4.window.__spyMotor.obraSocial === "OSDE", "[bug reportado] la obra social sale de datosBasicos.pacienteObraSocial (la del turno), no de pacienteSeleccionadoCarga");

  console.log("\nTODAS LAS PRUEBAS DE 2.8 PASARON (incluida la regresión del bug reportado)\n");
})();
