// Lógica de la carga de tratamiento (egreso de stock, etapa 6).
// No depende de entregas.js, pacientes.js ni medicamentos.js: cada pantalla mantiene sus
// propias funciones de normalización, mismo criterio de independencia por página ya usado
// en el resto del sistema.

const UNIDADES_MEDIDA_LABELS = { g: "gramo", cc: "centímetro cúbico", mg: "miligramo" };

// Etapa 5B — stock negativo. Los dos depósitos "(viejo)" se cargaron de forma masiva porque
// la medicación real no estaba identificada por paciente ni por depósito, así que al
// consumir es esperable que aparezcan negativos (y que a fin de mes se compensen contra
// sobrantes de otros depósitos). Ahí NO rige el bloqueo de "sin stock cargado": se puede
// cargar un tratamiento aunque ese medicamento nunca se haya ingresado en esa unidad, con
// aviso y confirmación. En los otros tres depósitos el bloqueo sigue igual (evita el
// "stock fantasma" en una unidad que nunca tuvo ingresos, ver Handoff_etapa_6.md).
const DEPOSITOS_HISTORICOS_EGRESOS = ["POP (viejo)", "FUESMEN (viejo)"];
const TEXTO_AVISO_SIN_STOCK = "No hay stock cargado de este medicamento en este depósito.";

let usuarioActualEgresos = null;
let datosUsuarioActualEgresos = null;
let pacientesCacheEgresos = [];
let medicamentosCacheEgresos = [];
let stockCacheEgresos = [];
let pacienteSeleccionado = null;
let contadorFilasMedicamento = 0;
let guardando = false;
let verificandoStock = false;
let pendingEgresoData = null;
let rolActualEgresos = null;
let temporizadorBusquedaDocumento = null;

// --- Cache de pacientes en localStorage (etapa 10) ---
// Mismo criterio que entregas.js: el cache vence por día, no por minutos, porque
// el listado de pacientes activos casi no cambia (lo que aparece son altas
// puntuales, no modificaciones al resto). Usa la misma clave que entregas.js e
// historial.js a propósito, para que las pestañas abiertas en una misma
// computadora compartan una sola lectura real por día en vez de una cada una.
const CACHE_PACIENTES_KEY = "cache_pacientes_activos";

function fechaLocalHoy() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function leerCachePacientes() {
  try {
    const crudo = localStorage.getItem(CACHE_PACIENTES_KEY);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (datos.fecha !== fechaLocalHoy()) return null;
    return datos.pacientes;
  } catch (error) {
    console.warn("No se pudo leer el cache de pacientes:", error);
    return null;
  }
}

function guardarCachePacientes(pacientes) {
  try {
    localStorage.setItem(CACHE_PACIENTES_KEY, JSON.stringify({ fecha: fechaLocalHoy(), pacientes }));
  } catch (error) {
    console.warn("No se pudo guardar el cache de pacientes:", error);
  }
}

function agregarPacienteACache(paciente) {
  try {
    const actuales = leerCachePacientes() || [];
    if (actuales.some((p) => p.id === paciente.id)) return;
    actuales.push(paciente);
    guardarCachePacientes(actuales);
  } catch (error) {
    console.warn("No se pudo actualizar el cache de pacientes:", error);
  }
}

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function capitalizarPalabras(texto) {
  return (texto || "")
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase())
    .join(" ");
}

function soloDigitos(texto) {
  return (texto || "").toString().replace(/\D/g, "");
}

function idPaciente(tipoDocumento, numeroDocumento) {
  return `${tipoDocumento}-${numeroDocumento}`;
}

function slugDeposito(deposito) {
  return normalizarTexto(deposito).replace(/\s+/g, "-");
}

function esDepositoHistorico(deposito) {
  return DEPOSITOS_HISTORICOS_EGRESOS.includes(deposito);
}

function formatearNumeroStock(numero) {
  return Number(numero).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

// Evita que un resultado como 0.3 - 0.1 - 0.2 muestre -0 o un residuo binario.
function redondearStock(numero) {
  const r = Math.round(Number(numero) * 1000) / 1000;
  return r === 0 ? 0 : r;
}

// Escapa texto libre antes de insertarlo con innerHTML (nombre/apellido de paciente,
// droga/marca del catálogo). Mismo patrón ya usado en medicamentos.js desde la etapa 3.
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function mostrarMensajeGeneral(texto, tipo) {
  const el = document.getElementById("mensaje-general");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function iniciarEgresos(user, datosUsuario) {
  usuarioActualEgresos = user;
  datosUsuarioActualEgresos = datosUsuario;
  rolActualEgresos = datosUsuario.rol;

  const campoBuscarPaciente = document.getElementById("campo-buscar-paciente");
  campoBuscarPaciente.addEventListener("input", (e) => buscarPaciente(e.target.value));
  document.getElementById("alta-numero-documento").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value).slice(0, 9);
  });
  document.getElementById("campo-ciclo").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value);
  });
  document.getElementById("campo-sesion").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value);
  });
  document.getElementById("campo-deposito").addEventListener("change", recalcularUnidadesTodasLasFilas);

  // El listado de pacientes activos (~2.600 registros) es, de las tres colecciones que
  // usa esta pantalla, la que más tarda en traerse. Antes se esperaban las tres juntas
  // (Promise.all) antes de que auth.js revelara la página, así que toda la pantalla
  // quedaba oculta el tiempo que tardara la consulta más lenta de las tres.
  // Ahora se carga en paralelo sin bloquear la aparición del formulario: el buscador de
  // paciente queda deshabilitado con un aviso mientras tanto, y se habilita solo cuando
  // el cache está listo. Medicamentos y stock sí se siguen esperando antes de revelar,
  // porque agregarFilaMedicamento() los necesita para armar la primera fila.
  campoBuscarPaciente.disabled = true;
  campoBuscarPaciente.placeholder = "Cargando listado de pacientes…";
  cargarPacientesEgresos().then(() => {
    campoBuscarPaciente.disabled = false;
    campoBuscarPaciente.placeholder = "Buscar por apellido, nombre o documento";
  });

  await Promise.all([cargarMedicamentosEgresos(), cargarStockEgresos()]);
  agregarFilaMedicamento();
}

async function cargarPacientesEgresos() {
  const enCache = leerCachePacientes();
  if (enCache) {
    pacientesCacheEgresos = enCache;
    return;
  }
  const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
  pacientesCacheEgresos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  guardarCachePacientes(pacientesCacheEgresos);
}

async function cargarMedicamentosEgresos() {
  const snapshot = await db.collection("medicamentos").get();
  medicamentosCacheEgresos = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((med) => med.activo !== false)
    .sort((a, b) => (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" }));
}

async function cargarStockEgresos() {
  // Médico y administrativo solo pueden leer Programa Oncológico, Donaciones y
  // POP (viejo) (mismo criterio que en stock.js, exigido por la regla de Firestore;
  // POP (viejo) agregado junto con FUESMEN (viejo) a pedido de Elías).
  const ROLES_RESTRINGIDOS = ["medico", "administrativo"];
  const consulta = ROLES_RESTRINGIDOS.includes(rolActualEgresos)
    ? db.collection("stock").where("deposito", "in", ["Programa Oncológico", "Donaciones", "POP (viejo)"])
    : db.collection("stock");
  const snapshot = await consulta.get();
  stockCacheEgresos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// --- Búsqueda y alta rápida de paciente (mismo patrón que entregas.js) ---

function buscarPaciente(texto) {
  const cont = document.getElementById("resultados-busqueda-paciente");
  const sinResultados = document.getElementById("sin-resultados");
  document.getElementById("bloque-alta-rapida").style.display = "none";
  cont.innerHTML = "";

  if (!texto.trim()) {
    sinResultados.style.display = "none";
    return;
  }

  const norm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const encontrados = pacientesCacheEgresos.filter((p) => {
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  if (encontrados.length === 0) {
    sinResultados.style.display = "block";
    buscarPacientePorDocumentoEnSegundoPlano(digitos);
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${escaparHtml(p.apellido)}, ${escaparHtml(p.nombre)} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPaciente(p.id));
    cont.appendChild(div);
  });
}

// Mismo criterio que entregas.js: si lo tipeado es un documento completo, se
// intenta encontrarlo puntual en Firestore por si se dio de alta hoy en otra
// computadora y el cache local todavía no lo tiene.
function buscarPacientePorDocumentoEnSegundoPlano(digitos) {
  clearTimeout(temporizadorBusquedaDocumento);
  if (digitos.length < 7 || digitos.length > 9) return;

  temporizadorBusquedaDocumento = setTimeout(async () => {
    const digitosActuales = soloDigitos(document.getElementById("campo-buscar-paciente").value);
    if (digitosActuales !== digitos) return;

    try {
      const snapshot = await db.collection("pacientes")
        .where("numeroDocumento", "==", digitos)
        .where("activo", "==", true)
        .get();
      if (snapshot.empty) return;

      snapshot.docs.forEach((doc) => {
        const p = { id: doc.id, ...doc.data() };
        if (!pacientesCacheEgresos.some((existente) => existente.id === p.id)) {
          pacientesCacheEgresos.push(p);
          agregarPacienteACache(p);
        }
      });

      buscarPaciente(document.getElementById("campo-buscar-paciente").value);
    } catch (error) {
      console.error("Error al buscar paciente por documento:", error);
    }
  }, 500);
}

// Enlace manual "actualizar listado", para la búsqueda por apellido/nombre.
function actualizarListadoPacientes() {
  const boton = document.getElementById("boton-actualizar-pacientes");
  if (boton) { boton.disabled = true; boton.textContent = "actualizando..."; }

  db.collection("pacientes").where("activo", "==", true).get()
    .then((snapshot) => {
      pacientesCacheEgresos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      guardarCachePacientes(pacientesCacheEgresos);
      buscarPaciente(document.getElementById("campo-buscar-paciente").value);
    })
    .catch((error) => console.error("Error al actualizar el listado de pacientes:", error))
    .finally(() => {
      if (boton) { boton.disabled = false; boton.textContent = "actualizar listado"; }
    });
}

function seleccionarPaciente(id) {
  pacienteSeleccionado = pacientesCacheEgresos.find((p) => p.id === id);
  document.getElementById("campo-buscar-paciente").value = "";
  document.getElementById("resultados-busqueda-paciente").innerHTML = "";
  document.getElementById("sin-resultados").style.display = "none";
  document.getElementById("bloque-alta-rapida").style.display = "none";
  renderizarPacienteSeleccionado();
}

function renderizarPacienteSeleccionado() {
  const cont = document.getElementById("paciente-seleccionado");
  const busqueda = document.getElementById("bloque-busqueda-paciente");
  if (!pacienteSeleccionado) {
    cont.style.display = "none";
    busqueda.style.display = "block";
    return;
  }
  cont.style.display = "flex";
  busqueda.style.display = "none";
  document.getElementById("texto-paciente-seleccionado").innerHTML =
    `<strong>${escaparHtml(pacienteSeleccionado.apellido)}, ${escaparHtml(pacienteSeleccionado.nombre)}</strong> · ${pacienteSeleccionado.tipoDocumento} ${pacienteSeleccionado.numeroDocumento}`;
}

function quitarPacienteSeleccionado() {
  pacienteSeleccionado = null;
  renderizarPacienteSeleccionado();
}

function mostrarAltaRapida() {
  document.getElementById("bloque-alta-rapida").style.display = "block";
  document.getElementById("mensaje-alta-rapida").style.display = "none";
}

async function altaRapidaPaciente() {
  const tipoDocumento = document.getElementById("alta-tipo-documento").value;
  const numeroDocumento = soloDigitos(document.getElementById("alta-numero-documento").value);
  const nombre = capitalizarPalabras(document.getElementById("alta-nombre").value);
  const apellido = capitalizarPalabras(document.getElementById("alta-apellido").value);
  const mensajeEl = document.getElementById("mensaje-alta-rapida");

  const mostrarError = (texto) => {
    mensajeEl.textContent = texto;
    mensajeEl.style.display = "block";
  };

  if (!nombre || !apellido) {
    mostrarError("Nombre y apellido son obligatorios.");
    return;
  }
  if (numeroDocumento.length < 7 || numeroDocumento.length > 9) {
    mostrarError("El número de documento debe tener entre 7 y 9 dígitos.");
    return;
  }

  const id = idPaciente(tipoDocumento, numeroDocumento);

  try {
    const existente = await db.collection("pacientes").doc(id).get();
    if (existente.exists) {
      mostrarError("Ya existe un paciente registrado con ese documento. Buscalo arriba en vez de darlo de alta de nuevo.");
      return;
    }

    await db.collection("pacientes").doc(id).set({
      tipoDocumento,
      numeroDocumento,
      nombre,
      apellido,
      obraSocial: "",
      activo: true,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    const nuevo = { id, tipoDocumento, numeroDocumento, nombre, apellido, obraSocial: "", activo: true };
    pacientesCacheEgresos.push(nuevo);
    agregarPacienteACache(nuevo);
    seleccionarPaciente(id);
  } catch (error) {
    console.error("Error al dar de alta al paciente:", error);
    mostrarError("No se pudo guardar el paciente. Reintentá en unos segundos.");
  }
}

// --- Medicamentos del tratamiento ---
// A diferencia de entregas.js, la unidad de medida no es una lista fija: se arma según
// las unidades para las que ya existe stock cargado de ese medicamento en el depósito
// elegido. Esto evita que un egreso descuente en una unidad distinta a la que se usó
// para cargar el ingreso (ver conversación de la etapa 6).

function agregarFilaMedicamento() {
  contadorFilasMedicamento++;
  const id = `fila-med-${contadorFilasMedicamento}`;
  const div = document.createElement("div");
  div.className = "fila-medicamento";
  div.id = id;

  const opcionesMedicamento =
    `<option value="">Elegir...</option>` +
    medicamentosCacheEgresos
      .map((m) => `<option value="${m.id}">${escaparHtml(m.droga)}${m.marca ? " — " + escaparHtml(m.marca) : ""}</option>`)
      .join("");

  div.innerHTML = `
    <div class="fila-medicamento-encabezado">
      <span>medicamento ${contadorFilasMedicamento}</span>
      <button type="button" class="enlace-accion peligro" data-quitar="${id}">quitar</button>
    </div>
    <div class="fila-3">
      <div class="campo" style="margin-bottom:0;">
        <label>Droga / marca</label>
        <select class="sel-medicamento">${opcionesMedicamento}</select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Unidad de medida</label>
        <select class="sel-unidad" disabled><option value="">Elegí el medicamento primero</option></select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Cantidad</label>
        <input type="number" class="inp-cantidad" min="0" step="any" placeholder="0" disabled />
      </div>
    </div>
    <div class="aviso-sin-stock" style="display:none;">No hay stock cargado de este medicamento en este depósito.</div>
  `;
  div.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaMedicamento(id));
  div.querySelector(".sel-medicamento").addEventListener("change", () => actualizarUnidadesFila(id));
  div.querySelector(".sel-unidad").addEventListener("change", () => actualizarAvisoUnidadFila(id));
  document.getElementById("lista-medicamentos").appendChild(div);
}

function actualizarUnidadesFila(filaId) {
  const fila = document.getElementById(filaId);
  const medicamentoId = fila.querySelector(".sel-medicamento").value;
  const deposito = document.getElementById("campo-deposito").value;
  const selUnidad = fila.querySelector(".sel-unidad");
  const inpCantidad = fila.querySelector(".inp-cantidad");
  const aviso = fila.querySelector(".aviso-sin-stock");

  aviso.textContent = TEXTO_AVISO_SIN_STOCK;

  if (!medicamentoId) {
    selUnidad.innerHTML = `<option value="">Elegí el medicamento primero</option>`;
    selUnidad.disabled = true;
    inpCantidad.disabled = true;
    aviso.style.display = "none";
    return;
  }

  const unidadesConStock = stockCacheEgresos.filter(
    (s) => s.medicamentoId === medicamentoId && s.deposito === deposito
  );
  const historico = esDepositoHistorico(deposito);

  if (unidadesConStock.length === 0 && !historico) {
    selUnidad.innerHTML = `<option value="">Sin stock cargado</option>`;
    selUnidad.disabled = true;
    inpCantidad.disabled = true;
    aviso.style.display = "block";
    return;
  }

  selUnidad.disabled = false;
  inpCantidad.disabled = false;

  if (!historico) {
    aviso.style.display = "none";
    selUnidad.innerHTML = unidadesConStock
      .map((s) => {
        const label = s.unidadMedidaLabel || UNIDADES_MEDIDA_LABELS[s.unidadMedida] || s.unidadMedida;
        const disponible = Number(s.cantidad) || 0;
        return `<option value="${s.unidadMedida}">${label} (${formatearNumeroStock(disponible)} disponibles)</option>`;
      })
      .join("");
    return;
  }

  // Depósito "(viejo)": se ofrecen las tres unidades. Las que ya tienen stock muestran
  // cuánto hay (y la primera queda preseleccionada); las demás dicen "sin stock cargado" y
  // al usarlas se crea el documento de stock directamente en negativo. Si el medicamento
  // no tiene stock en ninguna unidad, no se preselecciona nada: hay que elegir a propósito.
  const unidades = Object.keys(UNIDADES_MEDIDA_LABELS);
  unidadesConStock.forEach((s) => { if (!unidades.includes(s.unidadMedida)) unidades.push(s.unidadMedida); });
  const preseleccionada = unidadesConStock.length > 0 ? unidadesConStock[0].unidadMedida : "";
  selUnidad.innerHTML =
    (preseleccionada ? "" : `<option value="">Elegir unidad...</option>`) +
    unidades
      .map((u) => {
        const existente = unidadesConStock.find((s) => s.unidadMedida === u);
        const label = (existente && existente.unidadMedidaLabel) || UNIDADES_MEDIDA_LABELS[u] || u;
        const detalle = existente
          ? `${formatearNumeroStock(Number(existente.cantidad) || 0)} disponibles`
          : "sin stock cargado";
        return `<option value="${u}" ${u === preseleccionada ? "selected" : ""}>${label} (${detalle})</option>`;
      })
      .join("");
  actualizarAvisoUnidadFila(filaId);
}

// Solo en depósitos "(viejo)": avisa, antes de guardar, cuando la unidad elegida no tiene
// documento de stock (se va a crear en negativo) o cuando el medicamento no tiene stock en
// ninguna unidad. En el resto de los depósitos no aplica (ahí directamente no se puede elegir).
function actualizarAvisoUnidadFila(filaId) {
  const fila = document.getElementById(filaId);
  if (!fila) return;
  const deposito = document.getElementById("campo-deposito").value;
  const aviso = fila.querySelector(".aviso-sin-stock");
  if (!esDepositoHistorico(deposito)) return;

  const medicamentoId = fila.querySelector(".sel-medicamento").value;
  const unidad = fila.querySelector(".sel-unidad").value;
  if (!medicamentoId) {
    aviso.style.display = "none";
    return;
  }
  const hayAlgunaUnidad = stockCacheEgresos.some((s) => s.medicamentoId === medicamentoId && s.deposito === deposito);
  if (!unidad) {
    aviso.textContent = hayAlgunaUnidad
      ? TEXTO_AVISO_SIN_STOCK
      : "Este medicamento no tiene stock cargado en este depósito. Elegí la unidad: al confirmar, el stock va a quedar en negativo.";
    aviso.style.display = hayAlgunaUnidad ? "none" : "block";
    return;
  }
  const existe = stockCacheEgresos.some(
    (s) => s.medicamentoId === medicamentoId && s.unidadMedida === unidad && s.deposito === deposito
  );
  if (existe) {
    aviso.style.display = "none";
  } else {
    aviso.textContent = "En este depósito no hay stock cargado de este medicamento en esta unidad: al confirmar, el stock va a quedar en negativo.";
    aviso.style.display = "block";
  }
}

function recalcularUnidadesTodasLasFilas() {
  document.querySelectorAll(".fila-medicamento").forEach((fila) => actualizarUnidadesFila(fila.id));
}

function quitarFilaMedicamento(id) {
  const filas = document.querySelectorAll(".fila-medicamento");
  if (filas.length <= 1) {
    alert("Tiene que quedar al menos un medicamento cargado.");
    return;
  }
  document.getElementById(id).remove();
}

// --- Guardado: valida, relee el stock real y arma la confirmación si va a quedar en negativo ---

async function intentarGuardarEgreso() {
  if (guardando || verificandoStock) return;

  const deposito = document.getElementById("campo-deposito").value;
  const ciclo = parseInt(document.getElementById("campo-ciclo").value, 10);
  const sesion = parseInt(document.getElementById("campo-sesion").value, 10);
  const filas = [...document.querySelectorAll(".fila-medicamento")];

  if (!pacienteSeleccionado) {
    mostrarMensajeGeneral("Falta indicar a quién pertenece el tratamiento.", "error");
    return;
  }
  if (!ciclo || ciclo < 1) {
    mostrarMensajeGeneral("El ciclo tiene que ser un número mayor o igual a 1.", "error");
    return;
  }
  if (!sesion || sesion < 1) {
    mostrarMensajeGeneral("La sesión tiene que ser un número mayor o igual a 1.", "error");
    return;
  }

  const medicamentos = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const medId = fila.querySelector(".sel-medicamento").value;
    const med = medicamentosCacheEgresos.find((m) => m.id === medId);
    const unidadValue = fila.querySelector(".sel-unidad").value;
    const cantidad = parseFloat(fila.querySelector(".inp-cantidad").value);

    if (!med) {
      mostrarMensajeGeneral(`Falta elegir el medicamento en la línea ${i + 1}.`, "error");
      return;
    }
    if (!unidadValue) {
      mostrarMensajeGeneral(
        esDepositoHistorico(deposito)
          ? `Elegí la unidad de medida de ${med.droga} (línea ${i + 1}).`
          : `No hay stock cargado de ${med.droga} en este depósito, así que no se puede descontar (línea ${i + 1}).`,
        "error"
      );
      return;
    }
    if (!cantidad || cantidad <= 0) {
      mostrarMensajeGeneral(`La cantidad del medicamento ${i + 1} (${med.droga}) tiene que ser mayor a cero.`, "error");
      return;
    }

    const stockEntry = stockCacheEgresos.find(
      (s) => s.medicamentoId === med.id && s.unidadMedida === unidadValue && s.deposito === deposito
    );
    const unidadLabel = (stockEntry && stockEntry.unidadMedidaLabel) || UNIDADES_MEDIDA_LABELS[unidadValue] || unidadValue;

    medicamentos.push({
      medicamentoId: med.id,
      droga: med.droga,
      marca: med.marca || "",
      unidadMedida: unidadValue,
      unidadMedidaLabel: unidadLabel,
      cantidad
    });
  }

  // El stock se relee ahora, justo antes de avisar (etapa 5B): con dos personas cargando a
  // la vez, el número que trajo la pantalla al abrirse puede estar viejo.
  verificandoStock = true;
  document.getElementById("boton-guardar-egreso").disabled = true;
  let lineasStock;
  try {
    lineasStock = await leerStockActualLineas(deposito, medicamentos);
  } finally {
    verificandoStock = false;
    document.getElementById("boton-guardar-egreso").disabled = false;
  }

  const faltantes = lineasStock.filter((l) => l.resultante < 0);

  const datos = { deposito, ciclo, sesion, medicamentos };

  if (faltantes.length > 0) {
    mostrarConfirmacionStock(faltantes, datos);
    return;
  }

  guardarEgresoReal(datos);
}

// Agrupa las líneas por documento de stock (dos líneas del mismo medicamento y unidad
// descuentan del mismo lugar, así que el aviso tiene que sumarlas) y trae el valor real de
// cada documento. Si una lectura falla, se usa lo que había en la caché de la pantalla: el
// aviso es informativo, no un límite, así que un error de lectura no debe frenar la carga.
async function leerStockActualLineas(deposito, medicamentos) {
  const grupos = new Map();
  medicamentos.forEach((m) => {
    const clave = `${m.medicamentoId}_${m.unidadMedida}_${slugDeposito(deposito)}`;
    if (!grupos.has(clave)) {
      const enCache = stockCacheEgresos.find(
        (s) => s.medicamentoId === m.medicamentoId && s.unidadMedida === m.unidadMedida && s.deposito === deposito
      );
      grupos.set(clave, {
        clave,
        medicamentoId: m.medicamentoId,
        droga: m.droga,
        marca: m.marca,
        unidadMedida: m.unidadMedida,
        unidadMedidaLabel: m.unidadMedidaLabel,
        cantidad: 0,
        existe: !!enCache,
        disponible: enCache ? Number(enCache.cantidad) || 0 : 0
      });
    }
    grupos.get(clave).cantidad += m.cantidad;
  });

  await Promise.all(
    [...grupos.values()].map(async (g) => {
      try {
        const snap = await db.collection("stock").doc(g.clave).get();
        g.existe = snap.exists;
        g.disponible = snap.exists ? Number(snap.data().cantidad) || 0 : 0;
      } catch (error) {
        console.warn("No se pudo releer el stock de", g.clave, "- se usa el valor de la pantalla:", error);
      }
    })
  );

  grupos.forEach((g) => {
    g.cantidad = redondearStock(g.cantidad);
    g.resultante = redondearStock(g.disponible - g.cantidad);
  });
  return [...grupos.values()];
}

function textoAvisoStockNegativo(l) {
  const nombre = `${l.droga}${l.marca ? " — " + l.marca : ""}`;
  const u = l.unidadMedida;
  const resultado = `va a quedar en ${formatearNumeroStock(l.resultante)} ${u}`;
  if (!l.existe) {
    return `${nombre}: no hay stock cargado en este depósito; ${resultado}.`;
  }
  if (l.disponible < 0) {
    return `${nombre}: el stock YA está en negativo (${formatearNumeroStock(l.disponible)} ${u}) y se descuentan ${formatearNumeroStock(l.cantidad)} más; ${resultado}.`;
  }
  return `${nombre}: hay ${formatearNumeroStock(l.disponible)} ${u} y se descuentan ${formatearNumeroStock(l.cantidad)}; ${resultado}.`;
}

function mostrarConfirmacionStock(faltantes, datos) {
  pendingEgresoData = { ...datos, negativos: faltantes };

  const contenedor = document.getElementById("texto-confirmacion-stock");
  contenedor.innerHTML = "";
  faltantes.forEach((l) => {
    const linea = document.createElement("div");
    linea.style.marginBottom = "6px";
    linea.textContent = textoAvisoStockNegativo(l);
    contenedor.appendChild(linea);
  });
  const cierre = document.createElement("div");
  cierre.style.marginTop = "8px";
  cierre.textContent = "¿Confirmás seguir cargando con el stock en negativo?";
  contenedor.appendChild(cierre);

  // Aviso fuerte (rojo) cuando el stock ya estaba en negativo o directamente no existía.
  const bloque = document.getElementById("bloque-confirmacion-stock");
  const fuerte = faltantes.some((l) => !l.existe || l.disponible < 0);
  bloque.style.borderColor = fuerte ? "var(--color-danger)" : "";
  bloque.style.background = fuerte ? "var(--color-danger-soft)" : "";
  bloque.style.display = "block";
  bloque.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelarConfirmacionStock() {
  pendingEgresoData = null;
  document.getElementById("bloque-confirmacion-stock").style.display = "none";
}

function confirmarGuardarConStockNegativo() {
  if (!pendingEgresoData) return;
  const datos = pendingEgresoData;
  document.getElementById("bloque-confirmacion-stock").style.display = "none";
  guardarEgresoReal(datos);
}

async function guardarEgresoReal(datos) {
  if (guardando) return;
  guardando = true;
  document.getElementById("boton-guardar-egreso").disabled = true;

  try {
    const batch = db.batch();

    const egresoRef = db.collection("egresos").doc();
    const datosEgreso = {
      deposito: datos.deposito,
      paciente: {
        id: pacienteSeleccionado.id,
        tipoDocumento: pacienteSeleccionado.tipoDocumento,
        numeroDocumento: pacienteSeleccionado.numeroDocumento,
        nombre: pacienteSeleccionado.nombre,
        apellido: pacienteSeleccionado.apellido
      },
      ciclo: datos.ciclo,
      sesion: datos.sesion,
      medicamentos: datos.medicamentos.map((m) => ({
        medicamentoId: m.medicamentoId,
        droga: m.droga,
        marca: m.marca,
        unidadMedida: m.unidadMedida,
        unidadMedidaLabel: m.unidadMedidaLabel,
        cantidad: m.cantidad
      })),
      // Campo agregado en la etapa 10, mismo criterio que entregas.js: un tratamiento
      // cargado desde esta pantalla siempre descuenta stock de verdad (a diferencia
      // de la carga combinada), así que siempre lleva "clavesStock".
      clavesStock: datos.medicamentos.map(
        (m) => `${m.medicamentoId}_${m.unidadMedida}_${slugDeposito(datos.deposito)}`
      ),
      creadoPor: { uid: usuarioActualEgresos.uid, nombre: datosUsuarioActualEgresos.nombre || usuarioActualEgresos.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Etapa 5B: si quien carga confirmó seguir con el stock en negativo, el egreso lo deja
    // registrado (una entrada por documento de stock afectado) para la revisión de fin de
    // mes. No lleva estado ni afecta ninguna otra lógica: es solo una marca de auditoría.
    if (datos.negativos && datos.negativos.length > 0) {
      datosEgreso.stockNegativoConfirmado = datos.negativos.map((n) => ({
        medicamentoId: n.medicamentoId,
        unidadMedida: n.unidadMedida,
        stockPrevio: n.disponible,
        cantidad: n.cantidad,
        stockResultante: n.resultante,
        sinDocumento: !n.existe
      }));
    }

    batch.set(egresoRef, datosEgreso);

    datos.medicamentos.forEach((linea) => {
      const stockId = `${linea.medicamentoId}_${linea.unidadMedida}_${slugDeposito(datos.deposito)}`;
      const stockRef = db.collection("stock").doc(stockId);
      batch.set(
        stockRef,
        {
          medicamentoId: linea.medicamentoId,
          droga: linea.droga,
          marca: linea.marca,
          unidadMedida: linea.unidadMedida,
          unidadMedidaLabel: linea.unidadMedidaLabel,
          deposito: datos.deposito,
          cantidad: firebase.firestore.FieldValue.increment(-linea.cantidad),
          actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    await batch.commit();

    mostrarMensajeGeneral("Tratamiento guardado y stock actualizado.", "exito");
    await cargarStockEgresos();
    resetearFormularioEgreso(datos.deposito);
    setTimeout(() => {
      document.getElementById("mensaje-general").style.display = "none";
    }, 4000);
  } catch (error) {
    console.error("Error al guardar el tratamiento:", error);
    mostrarMensajeGeneral("No se pudo guardar el tratamiento. Reintentá en unos segundos.", "error");
  } finally {
    guardando = false;
    pendingEgresoData = null;
    document.getElementById("boton-guardar-egreso").disabled = false;
  }
}

function resetearFormularioEgreso(depositoAnterior) {
  // El depósito se mantiene seleccionado a propósito: es habitual cargar varios
  // tratamientos seguidos en el mismo depósito (mismo criterio que entregas.js).
  document.getElementById("campo-deposito").value = depositoAnterior;
  document.getElementById("campo-ciclo").value = "";
  document.getElementById("campo-sesion").value = "";

  quitarPacienteSeleccionado();
  document.getElementById("campo-buscar-paciente").value = "";

  document.getElementById("lista-medicamentos").innerHTML = "";
  agregarFilaMedicamento();
}
