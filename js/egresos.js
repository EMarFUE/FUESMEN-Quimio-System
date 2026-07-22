// Lógica de la carga de tratamiento (egreso de stock, etapa 6).
// No depende de entregas.js, pacientes.js ni medicamentos.js: cada pantalla mantiene sus
// propias funciones de normalización, mismo criterio de independencia por página ya usado
// en el resto del sistema.

const UNIDADES_MEDIDA_LABELS = { g: "gramo", cc: "centímetro cúbico", mg: "miligramo" };

let usuarioActualEgresos = null;
let datosUsuarioActualEgresos = null;
let pacientesCacheEgresos = [];
let medicamentosCacheEgresos = [];
let stockCacheEgresos = [];
let pacienteSeleccionado = null;
let contadorFilasMedicamento = 0;
let guardando = false;
let pendingEgresoData = null;
let rolActualEgresos = null;

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
  const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
  pacientesCacheEgresos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function cargarMedicamentosEgresos() {
  const snapshot = await db.collection("medicamentos").get();
  medicamentosCacheEgresos = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((med) => med.activo !== false)
    .sort((a, b) => (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" }));
}

async function cargarStockEgresos() {
  // Médico y administrativo solo pueden leer Programa Oncológico y Donaciones
  // (misma restricción que en stock.js, exigida por la regla de Firestore).
  const ROLES_RESTRINGIDOS = ["medico", "administrativo"];
  const consulta = ROLES_RESTRINGIDOS.includes(rolActualEgresos)
    ? db.collection("stock").where("deposito", "in", ["Programa Oncológico", "Donaciones"])
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
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${p.apellido}, ${p.nombre} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPaciente(p.id));
    cont.appendChild(div);
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
    `<strong>${pacienteSeleccionado.apellido}, ${pacienteSeleccionado.nombre}</strong> · ${pacienteSeleccionado.tipoDocumento} ${pacienteSeleccionado.numeroDocumento}`;
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
      .map((m) => `<option value="${m.id}">${m.droga}${m.marca ? " — " + m.marca : ""}</option>`)
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
  document.getElementById("lista-medicamentos").appendChild(div);
}

function actualizarUnidadesFila(filaId) {
  const fila = document.getElementById(filaId);
  const medicamentoId = fila.querySelector(".sel-medicamento").value;
  const deposito = document.getElementById("campo-deposito").value;
  const selUnidad = fila.querySelector(".sel-unidad");
  const inpCantidad = fila.querySelector(".inp-cantidad");
  const aviso = fila.querySelector(".aviso-sin-stock");

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

  if (unidadesConStock.length === 0) {
    selUnidad.innerHTML = `<option value="">Sin stock cargado</option>`;
    selUnidad.disabled = true;
    inpCantidad.disabled = true;
    aviso.style.display = "block";
    return;
  }

  aviso.style.display = "none";
  selUnidad.disabled = false;
  inpCantidad.disabled = false;
  selUnidad.innerHTML = unidadesConStock
    .map((s) => {
      const label = s.unidadMedidaLabel || UNIDADES_MEDIDA_LABELS[s.unidadMedida] || s.unidadMedida;
      const disponible = Number(s.cantidad) || 0;
      return `<option value="${s.unidadMedida}">${label} (${disponible.toLocaleString("es-AR", { maximumFractionDigits: 3 })} disponibles)</option>`;
    })
    .join("");
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

// --- Guardado: valida, chequea stock disponible y arma la confirmación si falta ---

function intentarGuardarEgreso() {
  if (guardando) return;

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
      mostrarMensajeGeneral(`No hay stock cargado de ${med.droga} en este depósito, así que no se puede descontar (línea ${i + 1}).`, "error");
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
    const disponible = stockEntry ? Number(stockEntry.cantidad) || 0 : 0;

    medicamentos.push({
      medicamentoId: med.id,
      droga: med.droga,
      marca: med.marca || "",
      unidadMedida: unidadValue,
      unidadMedidaLabel: unidadLabel,
      cantidad,
      disponible
    });
  }

  const faltantes = medicamentos.filter((m) => m.disponible < m.cantidad);

  const datos = { deposito, ciclo, sesion, medicamentos };

  if (faltantes.length > 0) {
    mostrarConfirmacionStock(faltantes, datos);
    return;
  }

  guardarEgresoReal(datos);
}

function mostrarConfirmacionStock(faltantes, datos) {
  pendingEgresoData = datos;
  const detalle = faltantes
    .map(
      (f) =>
        `${f.droga}${f.marca ? " — " + f.marca : ""}: hay ${f.disponible.toLocaleString("es-AR", { maximumFractionDigits: 3 })} ${f.unidadMedidaLabel} disponibles y se están descontando ${f.cantidad.toLocaleString("es-AR", { maximumFractionDigits: 3 })}.`
    )
    .join(" ");
  document.getElementById("texto-confirmacion-stock").textContent = detalle + " ¿Confirmás igual?";
  document.getElementById("bloque-confirmacion-stock").style.display = "block";
  document.getElementById("bloque-confirmacion-stock").scrollIntoView({ behavior: "smooth", block: "center" });
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
    batch.set(egresoRef, {
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
      creadoPor: { uid: usuarioActualEgresos.uid, nombre: datosUsuarioActualEgresos.nombre || usuarioActualEgresos.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

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
