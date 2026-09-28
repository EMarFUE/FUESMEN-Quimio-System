// Etapa 5B, punto 3b — Ajuste de stock y transferencia entre depósitos (solo administrador).
//
// Por qué existe: los depósitos "(viejo)" se cargaron de forma masiva y ya no admiten cargas
// de medicación, pero es esperable que al consumir queden en negativo mientras otros
// depósitos tienen sobrantes. A fin de mes hay que poder compensarlos y dejar constancia.
//
// Reglas de diseño (decididas con Elías):
//  - Dos operaciones: "ajuste" (dejar el stock de UN depósito en el valor contado) y
//    "transferencia" (mover una cantidad de un depósito a otro, misma droga y unidad).
//  - Cada una queda registrada en la colección "ajustesStock" (con motivo obligatorio y quién
//    la hizo) y aparece en "ver movimientos" de cada fila de stock (stock.js).
//  - Un ajuste no se edita ni se anula: un error se corrige con otro ajuste.
//  - Se puede ajustar una combinación que todavía no tiene documento de stock (se crea).
//  - Una transferencia NO puede dejar el depósito de origen en negativo: si ese stock físico
//    no está registrado, primero se lo ajusta.
//  - Todo se escribe dentro de una TRANSACCIÓN de Firestore: se lee el stock real en el
//    momento de guardar, así "dejar el stock en X" deja exactamente X aunque otra persona
//    haya cargado un tratamiento mientras se confirmaba (si el documento cambia, Firestore
//    reintenta solo). Se escribe el valor absoluto (no un incremento) para evitar residuos
//    decimales como 0.30000000000000004.

const DEPOSITOS_AJUSTES = ["FUESMEN", "Programa Oncológico", "Donaciones", "POP (viejo)", "FUESMEN (viejo)"];
const UNIDADES_AJUSTES = [
  { value: "g", label: "gramo" },
  { value: "cc", label: "centímetro cúbico" },
  { value: "mg", label: "miligramo" }
];
const MOTIVO_MINIMO_AJUSTES = 5;

let usuarioActualAjustes = null;
let datosUsuarioActualAjustes = null;
let medicamentosCacheAjustes = [];
let stockMedicamentoAjustes = []; // documentos de "stock" del medicamento elegido (todos los depósitos)
let modoAjustes = "ajuste";
let pendienteAjuste = null;
let guardandoAjuste = false;

// --- Utilidades ---

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Mismo formato de ID que usan entregas.js, egresos.js y correcciones.js para "stock".
function slugDeposito(deposito) {
  return normalizarTexto(deposito).replace(/\s+/g, "-");
}

function claveStockAjustes(medicamentoId, unidad, deposito) {
  return `${medicamentoId}_${unidad}_${slugDeposito(deposito)}`;
}

function formatearNumeroAjustes(numero) {
  return Number(numero).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

function redondearAjustes(numero) {
  const r = Math.round(Number(numero) * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function mostrarMensajeGeneral(texto, tipo) {
  const el = document.getElementById("mensaje-general");
  el.textContent = texto;
  el.className = "mensaje-info " + tipo;
  el.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function nombreMedicamentoAjustes(med) {
  return `${med.droga}${med.marca ? " — " + med.marca : ""}`;
}

function etiquetaUnidadAjustes(unidad) {
  return (UNIDADES_AJUSTES.find((u) => u.value === unidad) || {}).label || unidad;
}

function stockDeAjustes(medicamentoId, unidad, deposito) {
  return stockMedicamentoAjustes.find(
    (s) => s.medicamentoId === medicamentoId && s.unidadMedida === unidad && s.deposito === deposito
  ) || null;
}

// --- Arranque ---

async function iniciarAjustes(user, datosUsuario) {
  usuarioActualAjustes = user;
  datosUsuarioActualAjustes = datosUsuario;

  const opcionesDepositos = `<option value="">Elegir…</option>` +
    DEPOSITOS_AJUSTES.map((d) => `<option value="${d}">${d}</option>`).join("");
  ["aj-deposito", "tr-origen", "tr-destino"].forEach((id) => {
    document.getElementById(id).innerHTML = opcionesDepositos;
  });
  document.getElementById("tr-unidad").innerHTML = `<option value="">Elegir unidad…</option>` +
    UNIDADES_AJUSTES.map((u) => `<option value="${u.value}">${u.label}</option>`).join("");
  document.getElementById("aj-unidad").innerHTML = `<option value="">Elegí medicamento y depósito</option>`;

  await cargarMedicamentosAjustes();

  document.getElementById("aj-medicamento").addEventListener("change", async () => {
    cancelarConfirmacionAjuste();
    await cargarStockMedicamentoAjustes();
  });
  document.getElementById("aj-deposito").addEventListener("change", () => {
    refrescarUnidadesAjuste();
    refrescarInfoAjuste();
  });
  document.getElementById("aj-unidad").addEventListener("change", refrescarInfoAjuste);
  ["tr-unidad", "tr-origen", "tr-destino"].forEach((id) => {
    document.getElementById(id).addEventListener("change", refrescarInfoTransferencia);
  });
  // Si se toca cualquier campo después de "Revisar", lo que se iba a confirmar ya no es lo que
  // se ve en pantalla: se descarta la confirmación pendiente.
  ["panel-ajuste", "panel-transferencia"].forEach((id) => {
    const panel = document.getElementById(id);
    panel.addEventListener("input", cancelarConfirmacionAjuste);
    panel.addEventListener("change", cancelarConfirmacionAjuste);
  });
  document.querySelectorAll("#selector-modo .filtro-tab").forEach((boton) => {
    boton.addEventListener("click", () => cambiarModoAjustes(boton.dataset.modo));
  });

  await cargarUltimosAjustes();
}

async function cargarMedicamentosAjustes() {
  const snapshot = await db.collection("medicamentos").get();
  medicamentosCacheAjustes = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((med) => med.activo !== false)
    .sort((a, b) => (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" }));
  document.getElementById("aj-medicamento").innerHTML =
    `<option value="">Elegir medicamento…</option>` +
    medicamentosCacheAjustes.map((m) => `<option value="${m.id}">${escaparHtml(nombreMedicamentoAjustes(m))}</option>`).join("");
}

function cambiarModoAjustes(modo) {
  modoAjustes = modo;
  cancelarConfirmacionAjuste();
  document.querySelectorAll("#selector-modo .filtro-tab").forEach((b) => {
    b.classList.toggle("activo", b.dataset.modo === modo);
  });
  document.getElementById("panel-ajuste").style.display = modo === "ajuste" ? "block" : "none";
  document.getElementById("panel-transferencia").style.display = modo === "transferencia" ? "block" : "none";
}

// --- Stock del medicamento elegido ---

async function cargarStockMedicamentoAjustes() {
  const medicamentoId = document.getElementById("aj-medicamento").value;
  if (!medicamentoId) {
    stockMedicamentoAjustes = [];
    renderizarStockMedicamentoAjustes();
    refrescarUnidadesAjuste();
    refrescarInfoAjuste();
    refrescarInfoTransferencia();
    return;
  }
  try {
    const snapshot = await db.collection("stock").where("medicamentoId", "==", medicamentoId).get();
    // Si mientras tanto se eligió otro medicamento, esta respuesta ya no corresponde.
    if (document.getElementById("aj-medicamento").value !== medicamentoId) return;
    stockMedicamentoAjustes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error al leer el stock del medicamento:", error);
    mostrarMensajeGeneral("No se pudo leer el stock de este medicamento. Reintentá en unos segundos.", "error");
    return;
  }
  renderizarStockMedicamentoAjustes();
  refrescarUnidadesAjuste();
  refrescarInfoAjuste();
  preseleccionarUnidadTransferencia();
  refrescarInfoTransferencia();
}

function renderizarStockMedicamentoAjustes() {
  const bloque = document.getElementById("bloque-stock-medicamento");
  const cuerpo = document.getElementById("cuerpo-stock-medicamento");
  if (!document.getElementById("aj-medicamento").value) {
    bloque.style.display = "none";
    cuerpo.innerHTML = "";
    return;
  }
  bloque.style.display = "block";
  if (stockMedicamentoAjustes.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Este medicamento no tiene stock cargado en ningún depósito.</td></tr>`;
    return;
  }
  const ordenados = [...stockMedicamentoAjustes].sort((a, b) =>
    DEPOSITOS_AJUSTES.indexOf(a.deposito) - DEPOSITOS_AJUSTES.indexOf(b.deposito) ||
    (a.unidadMedida || "").localeCompare(b.unidadMedida || ""));
  cuerpo.innerHTML = ordenados.map((s) => {
    const cantidad = Number(s.cantidad) || 0;
    return `<tr>
      <td>${escaparHtml(s.deposito)}</td>
      <td>${escaparHtml(s.unidadMedidaLabel || etiquetaUnidadAjustes(s.unidadMedida))}</td>
      <td style="${cantidad < 0 ? "color:var(--color-danger);font-weight:500;" : ""}">${formatearNumeroAjustes(cantidad)}</td>
    </tr>`;
  }).join("");
}

// --- Ajuste de un depósito ---

function refrescarUnidadesAjuste() {
  const medicamentoId = document.getElementById("aj-medicamento").value;
  const deposito = document.getElementById("aj-deposito").value;
  const sel = document.getElementById("aj-unidad");
  const anterior = sel.value;
  if (!medicamentoId || !deposito) {
    sel.innerHTML = `<option value="">Elegí medicamento y depósito</option>`;
    return;
  }
  const conStock = stockMedicamentoAjustes.filter((s) => s.deposito === deposito);
  const preseleccionada = UNIDADES_AJUSTES.some((u) => u.value === anterior)
    ? anterior
    : (conStock.length > 0 ? conStock[0].unidadMedida : "");
  sel.innerHTML =
    (preseleccionada ? "" : `<option value="">Elegir unidad…</option>`) +
    UNIDADES_AJUSTES.map((u) => {
      const existente = conStock.find((s) => s.unidadMedida === u.value);
      const detalle = existente ? `stock: ${formatearNumeroAjustes(Number(existente.cantidad) || 0)}` : "sin stock cargado";
      return `<option value="${u.value}" ${u.value === preseleccionada ? "selected" : ""}>${u.label} (${detalle})</option>`;
    }).join("");
}

function refrescarInfoAjuste() {
  const medicamentoId = document.getElementById("aj-medicamento").value;
  const deposito = document.getElementById("aj-deposito").value;
  const unidad = document.getElementById("aj-unidad").value;
  const info = document.getElementById("aj-stock-actual");
  if (!medicamentoId || !deposito || !unidad) {
    info.textContent = "";
    return;
  }
  const existente = stockDeAjustes(medicamentoId, unidad, deposito);
  info.textContent = existente
    ? `Stock actual en ${deposito}: ${formatearNumeroAjustes(Number(existente.cantidad) || 0)} ${unidad}.`
    : `No hay stock cargado de esta combinación en ${deposito}: al ajustar se crea (hoy es 0).`;
}

function revisarAjuste() {
  if (guardandoAjuste) return;
  const medicamentoId = document.getElementById("aj-medicamento").value;
  const med = medicamentosCacheAjustes.find((m) => m.id === medicamentoId);
  const deposito = document.getElementById("aj-deposito").value;
  const unidad = document.getElementById("aj-unidad").value;
  const valorTexto = document.getElementById("aj-nuevo-valor").value;
  const motivo = document.getElementById("aj-motivo").value.trim();

  if (!med) return mostrarMensajeGeneral("Elegí el medicamento.", "error");
  if (!deposito) return mostrarMensajeGeneral("Elegí el depósito.", "error");
  if (!unidad) return mostrarMensajeGeneral("Elegí la unidad de medida.", "error");
  const nuevo = parseFloat(valorTexto);
  if (valorTexto === "" || isNaN(nuevo) || nuevo < 0) {
    return mostrarMensajeGeneral("Indicá a cuánto tiene que quedar el stock (0 o más).", "error");
  }
  if (redondearAjustes(nuevo) !== nuevo) {
    return mostrarMensajeGeneral("Usá hasta 3 decimales.", "error");
  }
  if (motivo.length < MOTIVO_MINIMO_AJUSTES) {
    return mostrarMensajeGeneral(`El motivo es obligatorio (mínimo ${MOTIVO_MINIMO_AJUSTES} caracteres).`, "error");
  }

  const existente = stockDeAjustes(med.id, unidad, deposito);
  const previo = existente ? Number(existente.cantidad) || 0 : 0;
  if (redondearAjustes(nuevo - previo) === 0) {
    return mostrarMensajeGeneral(`El stock ya está en ${formatearNumeroAjustes(previo)} ${unidad}: no hay nada para ajustar.`, "error");
  }

  pendienteAjuste = { tipo: "ajuste", med, deposito, unidad, nuevo, motivo, previoVisto: previo, existe: !!existente };
  const delta = redondearAjustes(nuevo - previo);
  mostrarConfirmacionAjuste("Confirmá el ajuste", [
    `${nombreMedicamentoAjustes(med)} · ${deposito} · ${unidad}`,
    `El stock pasa de ${formatearNumeroAjustes(previo)} ${unidad} a ${formatearNumeroAjustes(nuevo)} ${unidad} (diferencia ${delta > 0 ? "+" : ""}${formatearNumeroAjustes(delta)}).`,
    ...(existente ? [] : ["No había stock cargado de esta combinación: se crea con este valor."]),
    `Motivo: ${motivo}`
  ]);
}

// --- Transferencia entre depósitos ---

function preseleccionarUnidadTransferencia() {
  const sel = document.getElementById("tr-unidad");
  if (sel.value) return;
  const unidades = [...new Set(stockMedicamentoAjustes.map((s) => s.unidadMedida))];
  if (unidades.length === 1 && UNIDADES_AJUSTES.some((u) => u.value === unidades[0])) sel.value = unidades[0];
}

function refrescarInfoTransferencia() {
  const medicamentoId = document.getElementById("aj-medicamento").value;
  const unidad = document.getElementById("tr-unidad").value;
  const origen = document.getElementById("tr-origen").value;
  const destino = document.getElementById("tr-destino").value;
  const info = document.getElementById("tr-stock-actual");
  if (!medicamentoId || !unidad || (!origen && !destino)) {
    info.textContent = "";
    return;
  }
  const texto = (dep) => {
    const s = stockDeAjustes(medicamentoId, unidad, dep);
    return s ? `${formatearNumeroAjustes(Number(s.cantidad) || 0)} ${unidad}` : `sin stock cargado (0 ${unidad})`;
  };
  const partes = [];
  if (origen) partes.push(`Origen (${origen}): ${texto(origen)}`);
  if (destino) partes.push(`Destino (${destino}): ${texto(destino)}`);
  info.textContent = partes.join(" · ");
}

function revisarTransferencia() {
  if (guardandoAjuste) return;
  const medicamentoId = document.getElementById("aj-medicamento").value;
  const med = medicamentosCacheAjustes.find((m) => m.id === medicamentoId);
  const unidad = document.getElementById("tr-unidad").value;
  const origen = document.getElementById("tr-origen").value;
  const destino = document.getElementById("tr-destino").value;
  const cantidadTexto = document.getElementById("tr-cantidad").value;
  const motivo = document.getElementById("tr-motivo").value.trim();

  if (!med) return mostrarMensajeGeneral("Elegí el medicamento.", "error");
  if (!unidad) return mostrarMensajeGeneral("Elegí la unidad de medida.", "error");
  if (!origen) return mostrarMensajeGeneral("Elegí el depósito de origen.", "error");
  if (!destino) return mostrarMensajeGeneral("Elegí el depósito de destino.", "error");
  if (origen === destino) return mostrarMensajeGeneral("El origen y el destino tienen que ser distintos.", "error");
  const cantidad = parseFloat(cantidadTexto);
  if (cantidadTexto === "" || isNaN(cantidad) || cantidad <= 0) {
    return mostrarMensajeGeneral("La cantidad a transferir tiene que ser mayor a cero.", "error");
  }
  if (redondearAjustes(cantidad) !== cantidad) {
    return mostrarMensajeGeneral("Usá hasta 3 decimales.", "error");
  }
  if (motivo.length < MOTIVO_MINIMO_AJUSTES) {
    return mostrarMensajeGeneral(`El motivo es obligatorio (mínimo ${MOTIVO_MINIMO_AJUSTES} caracteres).`, "error");
  }

  const stockOrigen = stockDeAjustes(med.id, unidad, origen);
  const stockDestino = stockDeAjustes(med.id, unidad, destino);
  const previoOrigen = stockOrigen ? Number(stockOrigen.cantidad) || 0 : 0;
  const previoDestino = stockDestino ? Number(stockDestino.cantidad) || 0 : 0;
  if (redondearAjustes(previoOrigen - cantidad) < 0) {
    return mostrarMensajeGeneral(
      `${origen} tiene ${formatearNumeroAjustes(previoOrigen)} ${unidad} y no alcanza para transferir ${formatearNumeroAjustes(cantidad)}. ` +
      `Si ese stock físico no está registrado, primero ajustá el depósito de origen.`,
      "error"
    );
  }

  pendienteAjuste = { tipo: "transferencia", med, unidad, origen, destino, cantidad, motivo };
  mostrarConfirmacionAjuste("Confirmá la transferencia", [
    `${nombreMedicamentoAjustes(med)} · ${unidad}`,
    `Origen — ${origen}: de ${formatearNumeroAjustes(previoOrigen)} ${unidad} a ${formatearNumeroAjustes(redondearAjustes(previoOrigen - cantidad))} ${unidad}.`,
    `Destino — ${destino}: de ${formatearNumeroAjustes(previoDestino)} ${unidad} a ${formatearNumeroAjustes(redondearAjustes(previoDestino + cantidad))} ${unidad}.`,
    ...(stockDestino ? [] : ["El destino no tenía stock cargado de esta combinación: se crea."]),
    `Motivo: ${motivo}`
  ]);
}

// --- Confirmación ---

function mostrarConfirmacionAjuste(titulo, lineas) {
  document.getElementById("mensaje-general").style.display = "none";
  document.getElementById("titulo-confirmacion-ajuste").textContent = titulo;
  const contenedor = document.getElementById("texto-confirmacion-ajuste");
  contenedor.innerHTML = "";
  lineas.forEach((texto) => {
    const linea = document.createElement("div");
    linea.style.marginBottom = "6px";
    linea.textContent = texto;
    contenedor.appendChild(linea);
  });
  const bloque = document.getElementById("bloque-confirmacion-ajuste");
  bloque.style.display = "block";
  bloque.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelarConfirmacionAjuste() {
  pendienteAjuste = null;
  const bloque = document.getElementById("bloque-confirmacion-ajuste");
  if (bloque) bloque.style.display = "none";
}

async function confirmarAjuste() {
  if (!pendienteAjuste || guardandoAjuste) return;
  const pendiente = pendienteAjuste;
  guardandoAjuste = true;
  document.getElementById("boton-confirmar-ajuste").disabled = true;
  try {
    const resultado = pendiente.tipo === "ajuste"
      ? await ejecutarAjusteStock(pendiente)
      : await ejecutarTransferenciaStock(pendiente);
    document.getElementById("bloque-confirmacion-ajuste").style.display = "none";
    pendienteAjuste = null;
    if (resultado.sinCambio) {
      mostrarMensajeGeneral(
        `El stock ya estaba en ${formatearNumeroAjustes(resultado.previo)} ${pendiente.unidad} (cambió mientras confirmabas). No se registró nada.`,
        "info"
      );
    } else if (resultado.insuficiente) {
      mostrarMensajeGeneral(
        `${pendiente.origen} ahora tiene ${formatearNumeroAjustes(resultado.previoOrigen)} ${pendiente.unidad} y no alcanza para transferir ${formatearNumeroAjustes(pendiente.cantidad)} (cambió mientras confirmabas). No se registró nada.`,
        "error"
      );
    } else if (pendiente.tipo === "ajuste") {
      mostrarMensajeGeneral(
        `Ajuste guardado: ${nombreMedicamentoAjustes(pendiente.med)} en ${pendiente.deposito}, de ${formatearNumeroAjustes(resultado.previo)} a ${formatearNumeroAjustes(resultado.nuevo)} ${pendiente.unidad}.`,
        "exito"
      );
      limpiarCamposAjuste();
    } else {
      mostrarMensajeGeneral(
        `Transferencia guardada: ${formatearNumeroAjustes(pendiente.cantidad)} ${pendiente.unidad} de ${nombreMedicamentoAjustes(pendiente.med)}, de ${pendiente.origen} a ${pendiente.destino}.`,
        "exito"
      );
      limpiarCamposAjuste();
    }
    await cargarStockMedicamentoAjustes();
    await cargarUltimosAjustes();
  } catch (error) {
    console.error("Error al guardar el ajuste de stock:", error);
    mostrarMensajeGeneral(
      error && error.code === "permission-denied"
        ? "Firestore rechazó el guardado por permisos. Si es la primera vez que se usa esta pantalla, falta desplegar la versión nueva de firestore.rules (colección ajustesStock)."
        : "No se pudo guardar. No se cambió ningún stock. Reintentá en unos segundos.",
      "error"
    );
  } finally {
    guardandoAjuste = false;
    document.getElementById("boton-confirmar-ajuste").disabled = false;
  }
}

function limpiarCamposAjuste() {
  ["aj-nuevo-valor", "aj-motivo", "tr-cantidad", "tr-motivo"].forEach((id) => {
    document.getElementById(id).value = "";
  });
}

// --- Escritura (transacciones) ---

function datosStockAjustes(med, unidad, deposito) {
  return {
    medicamentoId: med.id,
    droga: med.droga,
    marca: med.marca || "",
    unidadMedida: unidad,
    unidadMedidaLabel: etiquetaUnidadAjustes(unidad),
    deposito
  };
}

// "delta" explícito en las transferencias: las dos líneas tienen que ser EXACTAMENTE opuestas
// (firestore.rules lo verifica), y así no depende de cómo se redondee cada resta por separado.
function lineaAjusteStock(med, unidad, deposito, previo, nuevo, delta) {
  return {
    clave: claveStockAjustes(med.id, unidad, deposito),
    ...datosStockAjustes(med, unidad, deposito),
    stockPrevio: previo,
    stockNuevo: nuevo,
    delta: delta !== undefined ? delta : redondearAjustes(nuevo - previo)
  };
}

function autorAjustes() {
  return { uid: usuarioActualAjustes.uid, nombre: datosUsuarioActualAjustes.nombre || usuarioActualAjustes.email };
}

async function ejecutarAjusteStock(p) {
  const clave = claveStockAjustes(p.med.id, p.unidad, p.deposito);
  const stockRef = db.collection("stock").doc(clave);
  const ajusteRef = db.collection("ajustesStock").doc();
  let resultado = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(stockRef);
    const previo = snap.exists ? Number(snap.data().cantidad) || 0 : 0;
    if (redondearAjustes(p.nuevo - previo) === 0) {
      resultado = { sinCambio: true, previo };
      return;
    }
    tx.set(
      stockRef,
      { ...datosStockAjustes(p.med, p.unidad, p.deposito), cantidad: p.nuevo, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(ajusteRef, {
      tipo: "ajuste",
      motivo: p.motivo,
      lineas: [lineaAjusteStock(p.med, p.unidad, p.deposito, previo, p.nuevo)],
      clavesStock: [clave],
      creadoPor: autorAjustes(),
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    resultado = { previo, nuevo: p.nuevo };
  });
  return resultado;
}

async function ejecutarTransferenciaStock(p) {
  const claveOrigen = claveStockAjustes(p.med.id, p.unidad, p.origen);
  const claveDestino = claveStockAjustes(p.med.id, p.unidad, p.destino);
  const refOrigen = db.collection("stock").doc(claveOrigen);
  const refDestino = db.collection("stock").doc(claveDestino);
  const ajusteRef = db.collection("ajustesStock").doc();
  let resultado = null;

  await db.runTransaction(async (tx) => {
    // Todas las lecturas antes que las escrituras (requisito de Firestore).
    const snapOrigen = await tx.get(refOrigen);
    const snapDestino = await tx.get(refDestino);
    const previoOrigen = snapOrigen.exists ? Number(snapOrigen.data().cantidad) || 0 : 0;
    const previoDestino = snapDestino.exists ? Number(snapDestino.data().cantidad) || 0 : 0;
    const nuevoOrigen = redondearAjustes(previoOrigen - p.cantidad);
    const nuevoDestino = redondearAjustes(previoDestino + p.cantidad);
    if (nuevoOrigen < 0) {
      resultado = { insuficiente: true, previoOrigen };
      return;
    }
    const marca = firebase.firestore.FieldValue.serverTimestamp();
    tx.set(refOrigen, { ...datosStockAjustes(p.med, p.unidad, p.origen), cantidad: nuevoOrigen, actualizadoEn: marca }, { merge: true });
    tx.set(refDestino, { ...datosStockAjustes(p.med, p.unidad, p.destino), cantidad: nuevoDestino, actualizadoEn: marca }, { merge: true });
    tx.set(ajusteRef, {
      tipo: "transferencia",
      motivo: p.motivo,
      lineas: [
        lineaAjusteStock(p.med, p.unidad, p.origen, previoOrigen, nuevoOrigen, -p.cantidad),
        lineaAjusteStock(p.med, p.unidad, p.destino, previoDestino, nuevoDestino, p.cantidad)
      ],
      clavesStock: [claveOrigen, claveDestino],
      creadoPor: autorAjustes(),
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    resultado = { previoOrigen, previoDestino, nuevoOrigen, nuevoDestino };
  });
  return resultado;
}

// --- Historial de ajustes ---

function formatearFechaAjustes(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function detalleAjusteTexto(ajuste) {
  const lineas = ajuste.lineas || [];
  const primera = lineas[0] || {};
  const nombre = `${primera.droga || ""}${primera.marca ? " — " + primera.marca : ""}`;
  if (ajuste.tipo === "transferencia" && lineas.length === 2) {
    return `${nombre} · ${primera.unidadMedida}: ${formatearNumeroAjustes(Math.abs(primera.delta))} de ${primera.deposito} a ${lineas[1].deposito}`;
  }
  return `${nombre} · ${primera.deposito} · ${primera.unidadMedida}: ${formatearNumeroAjustes(primera.stockPrevio)} → ${formatearNumeroAjustes(primera.stockNuevo)} (${primera.delta > 0 ? "+" : ""}${formatearNumeroAjustes(primera.delta)})`;
}

async function cargarUltimosAjustes() {
  const cuerpo = document.getElementById("cuerpo-ultimos-ajustes");
  const aviso = document.getElementById("aviso-ultimos-ajustes");
  aviso.style.display = "none";
  try {
    const snapshot = await db.collection("ajustesStock").orderBy("creadoEn", "desc").limit(30).get();
    if (snapshot.empty) {
      cuerpo.innerHTML = `<tr><td colspan="5" style="color:var(--color-muted);">Todavía no hay ajustes ni transferencias registrados.</td></tr>`;
      return;
    }
    cuerpo.innerHTML = snapshot.docs.map((doc) => {
      const a = doc.data();
      return `<tr>
        <td>${formatearFechaAjustes(a.creadoEn)}</td>
        <td>${a.tipo === "transferencia" ? "transferencia" : "ajuste"}</td>
        <td>${escaparHtml(detalleAjusteTexto(a))}</td>
        <td>${escaparHtml(a.motivo || "")}</td>
        <td>${escaparHtml((a.creadoPor || {}).nombre || "")}</td>
      </tr>`;
    }).join("");
  } catch (error) {
    console.error("Error al leer los ajustes de stock:", error);
    cuerpo.innerHTML = "";
    aviso.textContent = error && error.code === "permission-denied"
      ? "No se pudo leer el historial: falta desplegar la versión nueva de firestore.rules (colección ajustesStock)."
      : "No se pudo leer el historial de ajustes.";
    aviso.style.display = "block";
  }
}
