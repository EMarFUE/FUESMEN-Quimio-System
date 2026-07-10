// Lógica de la carga de entrega de medicación (etapa 5).
// No depende de pacientes.js ni de medicamentos.js: cada pantalla del sistema mantiene sus propias
// funciones de normalización, igual que ya conviven medicamentos.js y pacientes.js entre sí.

const UNIDADES_MEDIDA = [
  { value: "g", label: "gramo" },
  { value: "cc", label: "centímetro cúbico" },
  { value: "mg", label: "miligramo" }
];

let usuarioActual = null;
let datosUsuarioActual = null;
let pacientesCacheEntregas = [];
let medicamentosCacheEntregas = [];
let pacienteSeleccionado = null;
let contadorFilasMedicamento = 0;
let guardando = false;

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

async function iniciarEntregas(user, datosUsuario) {
  usuarioActual = user;
  datosUsuarioActual = datosUsuario;

  document.getElementById("campo-donacion").addEventListener("change", actualizarEtiquetasSegunDonacion);
  document.getElementById("campo-buscar-paciente").addEventListener("input", (e) => buscarPaciente(e.target.value));
  document.getElementById("alta-numero-documento").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value).slice(0, 9);
  });
  document.getElementById("entrega-documento").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value).slice(0, 9);
  });

  await Promise.all([cargarPacientesEntregas(), cargarMedicamentosEntregas()]);
  agregarFilaMedicamento();
}

async function cargarPacientesEntregas() {
  const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
  pacientesCacheEntregas = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function cargarMedicamentosEntregas() {
  const snapshot = await db.collection("medicamentos").get();
  medicamentosCacheEntregas = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((med) => med.activo !== false)
    .sort((a, b) => (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" }));
}

// --- Donación: cambia a qué se refiere el bloque de paciente y la etiqueta de "quién entrega" ---

function actualizarEtiquetasSegunDonacion() {
  const esDonacion = document.getElementById("campo-donacion").checked;
  document.getElementById("titulo-bloque-paciente").textContent = esDonacion ? "a quién pertenecía" : "a quién pertenece";
  document.getElementById("label-es-mismo-paciente").textContent = esDonacion
    ? "Es el mismo paciente que donaba la medicación"
    : "Trae el propio paciente";
  renderizarPacienteSeleccionado();
}

// --- Búsqueda y alta rápida de paciente ---

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
  const encontrados = pacientesCacheEntregas.filter((p) => {
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
  pacienteSeleccionado = pacientesCacheEntregas.find((p) => p.id === id);
  document.getElementById("campo-buscar-paciente").value = "";
  document.getElementById("resultados-busqueda-paciente").innerHTML = "";
  document.getElementById("sin-resultados").style.display = "none";
  document.getElementById("bloque-alta-rapida").style.display = "none";
  document.getElementById("campo-es-mismo-paciente").disabled = false;
  renderizarPacienteSeleccionado();
}

function renderizarPacienteSeleccionado() {
  const cont = document.getElementById("paciente-seleccionado");
  if (!pacienteSeleccionado) {
    cont.style.display = "none";
    return;
  }
  cont.style.display = "flex";
  const esDonacion = document.getElementById("campo-donacion").checked;
  document.getElementById("texto-paciente-seleccionado").innerHTML =
    `<strong>${pacienteSeleccionado.apellido}, ${pacienteSeleccionado.nombre}</strong> · ${pacienteSeleccionado.tipoDocumento} ${pacienteSeleccionado.numeroDocumento}` +
    (esDonacion ? ` <span class="badge" style="margin-left:8px;">dueño anterior</span>` : "");
}

function quitarPacienteSeleccionado() {
  pacienteSeleccionado = null;
  document.getElementById("paciente-seleccionado").style.display = "none";
  document.getElementById("campo-es-mismo-paciente").checked = false;
  document.getElementById("campo-es-mismo-paciente").disabled = true;
  onToggleEsMismoPaciente();
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
    pacientesCacheEntregas.push(nuevo);
    seleccionarPaciente(id);
  } catch (error) {
    console.error("Error al dar de alta al paciente:", error);
    mostrarError("No se pudo guardar el paciente. Reintentá en unos segundos.");
  }
}

// --- Quién entrega ---

function onToggleEsMismoPaciente() {
  const marcado = document.getElementById("campo-es-mismo-paciente").checked;
  const nombre = document.getElementById("entrega-nombre");
  const apellido = document.getElementById("entrega-apellido");
  const documento = document.getElementById("entrega-documento");

  if (marcado && pacienteSeleccionado) {
    nombre.value = pacienteSeleccionado.nombre;
    apellido.value = pacienteSeleccionado.apellido;
    documento.value = pacienteSeleccionado.numeroDocumento;
    nombre.disabled = true;
    apellido.disabled = true;
    documento.disabled = true;
  } else {
    nombre.disabled = false;
    apellido.disabled = false;
    documento.disabled = false;
    nombre.value = "";
    apellido.value = "";
    documento.value = "";
  }
}

// --- Medicamentos de la carga ---

function agregarFilaMedicamento() {
  contadorFilasMedicamento++;
  const id = `fila-med-${contadorFilasMedicamento}`;
  const div = document.createElement("div");
  div.className = "fila-medicamento";
  div.id = id;

  const opcionesMedicamento = medicamentosCacheEntregas
    .map((m) => `<option value="${m.id}">${m.droga}${m.marca ? " — " + m.marca : ""}</option>`)
    .join("");
  const opcionesUnidad = UNIDADES_MEDIDA.map((u) => `<option value="${u.value}">${u.label}</option>`).join("");

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
        <select class="sel-unidad">${opcionesUnidad}</select>
      </div>
      <div class="campo" style="margin-bottom:0;">
        <label>Cantidad</label>
        <input type="number" class="inp-cantidad" min="0" step="any" placeholder="0" />
      </div>
    </div>
  `;
  div.querySelector("[data-quitar]").addEventListener("click", () => quitarFilaMedicamento(id));
  document.getElementById("lista-medicamentos").appendChild(div);
}

function quitarFilaMedicamento(id) {
  const filas = document.querySelectorAll(".fila-medicamento");
  if (filas.length <= 1) {
    alert("Tiene que quedar al menos un medicamento cargado.");
    return;
  }
  document.getElementById(id).remove();
}

// --- Guardado: crea la entrega y actualiza el stock en el mismo batch ---

async function guardarEntrega() {
  if (guardando) return;

  const deposito = document.getElementById("campo-deposito").value;
  const esDonacion = document.getElementById("campo-donacion").checked;
  const quienEntregaNombre = capitalizarPalabras(document.getElementById("entrega-nombre").value);
  const quienEntregaApellido = capitalizarPalabras(document.getElementById("entrega-apellido").value);
  const quienEntregaDocumento = soloDigitos(document.getElementById("entrega-documento").value);
  const esMismoPaciente = document.getElementById("campo-es-mismo-paciente").checked;
  const filas = [...document.querySelectorAll(".fila-medicamento")];

  if (!pacienteSeleccionado) {
    mostrarMensajeGeneral(
      esDonacion ? "Falta indicar a quién pertenecía la medicación." : "Falta indicar a quién pertenece la medicación.",
      "error"
    );
    return;
  }
  if (!quienEntregaNombre || !quienEntregaApellido || !quienEntregaDocumento) {
    mostrarMensajeGeneral("Faltan los datos de quién entrega.", "error");
    return;
  }
  if (quienEntregaDocumento.length < 7 || quienEntregaDocumento.length > 9) {
    mostrarMensajeGeneral("El documento de quién entrega debe tener entre 7 y 9 dígitos.", "error");
    return;
  }

  const medicamentos = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const medId = fila.querySelector(".sel-medicamento").value;
    const med = medicamentosCacheEntregas.find((m) => m.id === medId);
    const unidadValue = fila.querySelector(".sel-unidad").value;
    const unidad = UNIDADES_MEDIDA.find((u) => u.value === unidadValue);
    const cantidad = parseFloat(fila.querySelector(".inp-cantidad").value);

    if (!med) {
      mostrarMensajeGeneral(`No hay medicamentos cargados en el catálogo para elegir en la línea ${i + 1}.`, "error");
      return;
    }
    if (!cantidad || cantidad <= 0) {
      mostrarMensajeGeneral(`La cantidad del medicamento ${i + 1} (${med.droga}) tiene que ser mayor a cero.`, "error");
      return;
    }

    medicamentos.push({
      medicamentoId: med.id,
      droga: med.droga,
      marca: med.marca || "",
      unidadMedida: unidad.value,
      unidadMedidaLabel: unidad.label,
      cantidad
    });
  }

  guardando = true;
  document.getElementById("boton-guardar-entrega").disabled = true;

  try {
    const batch = db.batch();

    const entregaRef = db.collection("entregas").doc();
    batch.set(entregaRef, {
      deposito,
      esDonacion,
      paciente: {
        id: pacienteSeleccionado.id,
        tipoDocumento: pacienteSeleccionado.tipoDocumento,
        numeroDocumento: pacienteSeleccionado.numeroDocumento,
        nombre: pacienteSeleccionado.nombre,
        apellido: pacienteSeleccionado.apellido
      },
      quienEntrega: {
        nombre: quienEntregaNombre,
        apellido: quienEntregaApellido,
        documento: quienEntregaDocumento
      },
      esMismoPaciente,
      medicamentos,
      creadoPor: { uid: usuarioActual.uid, nombre: datosUsuarioActual.nombre || usuarioActual.email },
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    medicamentos.forEach((linea) => {
      const stockId = `${linea.medicamentoId}_${linea.unidadMedida}_${slugDeposito(deposito)}`;
      const stockRef = db.collection("stock").doc(stockId);
      batch.set(
        stockRef,
        {
          medicamentoId: linea.medicamentoId,
          droga: linea.droga,
          marca: linea.marca,
          unidadMedida: linea.unidadMedida,
          unidadMedidaLabel: linea.unidadMedidaLabel,
          deposito,
          cantidad: firebase.firestore.FieldValue.increment(linea.cantidad),
          actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    await batch.commit();

    mostrarMensajeGeneral("Entrega guardada y stock actualizado.", "exito");
    resetearFormularioEntrega(deposito);
    setTimeout(() => {
      document.getElementById("mensaje-general").style.display = "none";
    }, 4000);
  } catch (error) {
    console.error("Error al guardar la entrega:", error);
    mostrarMensajeGeneral("No se pudo guardar la entrega. Reintentá en unos segundos.", "error");
  } finally {
    guardando = false;
    document.getElementById("boton-guardar-entrega").disabled = false;
  }
}

function resetearFormularioEntrega(depositoAnterior) {
  // El depósito se mantiene seleccionado a propósito: es habitual cargar varias entregas
  // seguidas en el mismo depósito, y volver a elegirlo cada vez sería una fricción innecesaria.
  document.getElementById("campo-deposito").value = depositoAnterior;
  document.getElementById("campo-donacion").checked = false;
  actualizarEtiquetasSegunDonacion();

  quitarPacienteSeleccionado();
  document.getElementById("campo-buscar-paciente").value = "";

  document.getElementById("lista-medicamentos").innerHTML = "";
  agregarFilaMedicamento();
}
