// Lógica de la pantalla de stock (etapa 5).
// Lectura para los cuatro roles (médico y administrativo la necesitan para consultar
// disponibilidad); no hay alta ni edición manual acá, el stock solo se actualiza desde
// el batch que crea una entrega en entregas.js.

let stockCache = [];
let rolActualStock = null;

// Médico y administrativo solo necesitan ver si hay stock disponible para prestar
// (Programa Oncológico y Donaciones); el depósito de FUESMEN queda fuera de su vista,
// tanto en el filtro como en los datos que se cargan (ver conversación de la etapa 6).
const DEPOSITOS_RESTRINGIDOS = ["medico", "administrativo"];

function normalizarTextoStock(texto) {
  return (texto || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function iniciarStock(rol) {
  rolActualStock = rol;
  if (DEPOSITOS_RESTRINGIDOS.includes(rolActualStock)) {
    const opcionFuesmen = document.querySelector('#filtro-deposito option[value="FUESMEN"]');
    if (opcionFuesmen) opcionFuesmen.remove();
  }
  document.getElementById("filtro-deposito").addEventListener("change", renderizarTablaStock);
  document.getElementById("filtro-droga").addEventListener("input", renderizarTablaStock);
  configurarCierreModalAuditoria();
  await cargarStock();
}

// "Ver movimientos" queda para administrador y enfermería: son quienes hacen la
// tarea de conciliar el stock contra un recuento físico. La lectura de entregas/
// egresos ya es abierta a cualquier autenticado en firestore.rules, así que esto
// es una restricción de pantalla, no de datos.
function puedeVerAuditoriaStock() {
  return rolActualStock === "administrador" || rolActualStock === "enfermeria";
}

async function cargarStock() {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-muted);">Cargando...</td></tr>`;

  try {
    // Para médico y administrativo, la propia consulta tiene que pedir solo los depósitos
    // permitidos: la regla de Firestore ahora exige que la consulta esté acotada de
    // antemano, no alcanza con filtrar acá después de traer todo (ver Handoff_etapa_6.md).
    const consulta = DEPOSITOS_RESTRINGIDOS.includes(rolActualStock)
      ? db.collection("stock").where("deposito", "in", ["Programa Oncológico", "Donaciones"])
      : db.collection("stock");

    const snapshot = await consulta.get();
    stockCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    stockCache.sort((a, b) => {
      const porDroga = (a.droga || "").localeCompare(b.droga || "", "es", { sensitivity: "base" });
      if (porDroga !== 0) return porDroga;
      return (a.deposito || "").localeCompare(b.deposito || "", "es", { sensitivity: "base" });
    });
    renderizarTablaStock();
  } catch (error) {
    console.error("Error al cargar el stock:", error);
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger);">No se pudo cargar el stock.</td></tr>`;
  }
}

function filasFiltradas() {
  const deposito = document.getElementById("filtro-deposito").value;
  const filtroDroga = normalizarTextoStock(document.getElementById("filtro-droga").value);

  return stockCache.filter((item) => {
    const coincideDeposito = !deposito || item.deposito === deposito;
    const coincideDroga = !filtroDroga || normalizarTextoStock(item.droga).includes(filtroDroga);
    return coincideDeposito && coincideDroga;
  });
}

function renderizarTablaStock() {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  const filtrados = filasFiltradas();

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-muted);padding:16px 6px;">No hay stock cargado con ese filtro.</td></tr>`;
    return;
  }

  const puedeAuditar = puedeVerAuditoriaStock();

  tbody.innerHTML = filtrados
    .map(
      (item) => `
        <tr>
          <td>${item.droga || ""}</td>
          <td>${item.marca ? item.marca : '<span style="color:var(--color-muted);">—</span>'}</td>
          <td>${item.unidadMedidaLabel || item.unidadMedida || ""}</td>
          <td>${item.deposito || ""}</td>
          <td>${formatearCantidad(item.cantidad)}</td>
          <td class="acciones-fila">${puedeAuditar ? `<button type="button" class="enlace-accion" data-stock-id="${item.id}">ver movimientos</button>` : ""}</td>
        </tr>
      `
    )
    .join("");

  if (puedeAuditar) {
    tbody.querySelectorAll("[data-stock-id]").forEach((boton) => {
      boton.addEventListener("click", () => {
        const item = stockCache.find((s) => s.id === boton.dataset.stockId);
        if (item) abrirAuditoriaStock(item);
      });
    });
  }
}

// --- Auditoría de movimientos (etapa 10) ---
// Reconstruye, para una fila puntual de stock (droga + unidad + depósito), toda
// la historia de entregas y egresos que la afectaron, usando "clavesStock" (ver
// entregas.js/egresos.js/correcciones.js). El total de la reconciliación no
// necesita leer "correcciones" en ningún momento: cuando una corrección se
// aprueba, su efecto se aplica directo sobre el documento de stock, no queda un
// asiento aparte que sumar. Alcanza con sumar las entregas/egresos que NO estén
// en estado "anulada" (los reemplazos ya cuentan como documentos nuevos y
// activos) para que el total coincida con lo que hoy muestra "stock.cantidad".

function configurarCierreModalAuditoria() {
  const panel = document.getElementById("panel-auditoria-stock");
  if (!panel) return;
  panel.addEventListener("click", (e) => {
    if (e.target === panel) cerrarAuditoriaStock();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.style.display !== "none") cerrarAuditoriaStock();
  });
}

function cerrarAuditoriaStock() {
  document.getElementById("panel-auditoria-stock").style.display = "none";
  document.getElementById("modal-panel-auditoria").innerHTML = "";
}

function milisegundosStock(timestamp) {
  if (!timestamp) return 0;
  return timestamp.toMillis ? timestamp.toMillis() : new Date(timestamp).getTime();
}

function formatearFechaHoraStock(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

async function abrirAuditoriaStock(item) {
  const panel = document.getElementById("panel-auditoria-stock");
  const contenedor = document.getElementById("modal-panel-auditoria");
  panel.style.display = "flex";
  contenedor.innerHTML = `<div style="padding:20px;color:var(--color-muted);">Buscando movimientos…</div>`;

  try {
    // "item.id" ya es el mismo formato que se guarda en "clavesStock" de cada
    // entrega/egreso (${medicamentoId}_${unidadMedida}_${slugDeposito(deposito)}),
    // así que la consulta encuentra exactamente los movimientos de esta fila.
    const [snapEntregas, snapEgresos] = await Promise.all([
      db.collection("entregas").where("clavesStock", "array-contains", item.id).orderBy("creadoEn", "asc").get(),
      db.collection("egresos").where("clavesStock", "array-contains", item.id).orderBy("creadoEn", "asc").get()
    ]);

    const movimientos = [];
    snapEntregas.docs.forEach((doc) => movimientos.push(armarMovimientoStock("entregas", doc.id, doc.data(), item)));
    snapEgresos.docs.forEach((doc) => movimientos.push(armarMovimientoStock("egresos", doc.id, doc.data(), item)));
    movimientos.sort((a, b) => milisegundosStock(a.creadoEn) - milisegundosStock(b.creadoEn));

    renderizarAuditoriaStock(item, movimientos);
  } catch (error) {
    console.error("Error al buscar movimientos de stock:", error);
    contenedor.innerHTML = `
      <div class="modal-encabezado">
        <button type="button" class="modal-cerrar" onclick="cerrarAuditoriaStock()" aria-label="Cerrar">×</button>
      </div>
      <div style="padding:0 0 12px;color:var(--color-danger);font-size:13px;">
        No se pudo cargar el detalle. Si es la primera vez que se usa esta vista, puede faltar crear un índice en
        Firestore — abrí la consola del navegador (F12): el error trae un enlace directo para crearlo con un clic.
      </div>`;
  }
}

// Un documento puede tener varias líneas de medicamentos; se queda solo con las
// que corresponden a esta fila de stock puntual (podría haber más de una si,
// por error, se cargó dos veces la misma droga+unidad en la misma carga).
function armarMovimientoStock(coleccion, id, d, item) {
  const lineas = (d.medicamentos || []).filter(
    (l) => l.medicamentoId === item.medicamentoId && l.unidadMedida === item.unidadMedida
  );
  const cantidadLinea = lineas.reduce((acumulado, l) => acumulado + (Number(l.cantidad) || 0), 0);
  return {
    coleccion,
    id,
    creadoEn: d.creadoEn,
    cantidad: cantidadLinea,
    signo: coleccion === "entregas" ? 1 : -1,
    anulada: d.estado === "anulada",
    numeroComprobante: d.numeroComprobante || null,
    reemplazadoPorNumero: d.reemplazadoPorNumero || null,
    ciclo: d.ciclo ?? null,
    sesion: d.sesion ?? null,
    paciente: d.paciente || {}
  };
}

function renderizarAuditoriaStock(item, movimientos) {
  const contenedor = document.getElementById("modal-panel-auditoria");

  let acumulado = 0;
  const filas = movimientos
    .map((m) => {
      const etiquetaTipo = m.coleccion === "entregas" ? "entrega" : "tratamiento";
      const referencia = m.coleccion === "entregas"
        ? (m.numeroComprobante ? `N.° ${m.numeroComprobante}` : `ID ${m.id.slice(0, 8)}`)
        : `ciclo ${m.ciclo ?? "—"} / sesión ${m.sesion ?? "—"}`;
      const paciente = `${m.paciente.apellido || ""}, ${m.paciente.nombre || ""}`;
      const signoTexto = m.signo > 0 ? "+" : "−";

      if (m.anulada) {
        return `<tr style="opacity:0.55;">
          <td>${formatearFechaHoraStock(m.creadoEn)}</td>
          <td>${etiquetaTipo}</td>
          <td>${paciente}</td>
          <td>${referencia}</td>
          <td style="text-decoration:line-through;">${signoTexto}${formatearCantidad(m.cantidad)}</td>
          <td><span class="badge">anulada${m.reemplazadoPorNumero ? " · reemplazada" : ""}</span></td>
        </tr>`;
      }

      acumulado += m.signo * m.cantidad;
      return `<tr>
        <td>${formatearFechaHoraStock(m.creadoEn)}</td>
        <td>${etiquetaTipo}</td>
        <td>${paciente}</td>
        <td>${referencia}</td>
        <td>${signoTexto}${formatearCantidad(m.cantidad)}</td>
        <td>${formatearCantidad(acumulado)}</td>
      </tr>`;
    })
    .join("");

  const actual = Number(item.cantidad) || 0;
  const coincide = Math.abs(actual - acumulado) < 0.0001;

  contenedor.innerHTML = `
    <div class="modal-encabezado">
      <button type="button" class="modal-cerrar" onclick="cerrarAuditoriaStock()" aria-label="Cerrar">×</button>
    </div>
    <div class="titulo-bloque" style="margin-top:0;">movimientos de stock</div>
    <div style="font-size:13px;color:var(--color-muted);margin-bottom:14px;">
      ${item.droga || ""}${item.marca ? " — " + item.marca : ""} · ${item.unidadMedidaLabel || item.unidadMedida || ""} · ${item.deposito || ""}
    </div>
    <div style="overflow-x:auto;">
      <table class="tabla">
        <thead>
          <tr><th>Fecha</th><th>Tipo</th><th>Paciente</th><th>Referencia</th><th>Cantidad</th><th>Acumulado</th></tr>
        </thead>
        <tbody>${filas || '<tr><td colspan="6" style="color:var(--color-muted);">No hay movimientos registrados para esta combinación.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="tarjeta-confirmacion-stock" style="margin-top:4px;${coincide ? "" : "border-color:var(--color-danger);background:var(--color-danger-soft);"}">
      <div class="titulo-confirmacion-stock" style="${coincide ? "" : "color:var(--color-danger);"}">
        ${coincide ? "El total coincide con el stock actual" : "El total no coincide con el stock actual"}
      </div>
      <div class="texto-confirmacion-stock" style="margin-bottom:0;${coincide ? "" : "color:var(--color-danger);"}">
        Suma de movimientos activos: ${formatearCantidad(acumulado)}. Stock actual del sistema: ${formatearCantidad(actual)}.
      </div>
    </div>
  `;
}

function formatearCantidad(cantidad) {
  const numero = Number(cantidad) || 0;
  const texto = numero.toLocaleString("es-AR", { maximumFractionDigits: 3 });
  // Un valor negativo señala una carga para revisar (ver Handoff_etapa_6.md): no se oculta
  // ni se redondea a cero, se destaca en rojo para que salte a la vista.
  if (numero < 0) {
    return `<span style="color:var(--color-danger); font-weight:600;">${texto}</span>`;
  }
  return texto;
}

function exportarStockAExcel() {
  const filas = filasFiltradas().map((item) => ({
    Droga: item.droga || "",
    Marca: item.marca || "",
    "Unidad de medida": item.unidadMedidaLabel || item.unidadMedida || "",
    Depósito: item.deposito || "",
    Cantidad: Number(item.cantidad) || 0
  }));

  if (filas.length === 0) {
    alert("No hay datos para exportar con el filtro actual.");
    return;
  }

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Stock");

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `stock_quimioterapia_${fecha}.xlsx`);
}
