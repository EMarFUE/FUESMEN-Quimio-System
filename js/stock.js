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
  await cargarStock();
}

async function cargarStock() {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  tbody.innerHTML = `<tr><td colspan="5" style="color:var(--color-muted);">Cargando...</td></tr>`;

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
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--color-danger);">No se pudo cargar el stock.</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--color-muted);padding:16px 6px;">No hay stock cargado con ese filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados
    .map(
      (item) => `
        <tr>
          <td>${item.droga || ""}</td>
          <td>${item.marca ? item.marca : '<span style="color:var(--color-muted);">—</span>'}</td>
          <td>${item.unidadMedidaLabel || item.unidadMedida || ""}</td>
          <td>${item.deposito || ""}</td>
          <td>${formatearCantidad(item.cantidad)}</td>
        </tr>
      `
    )
    .join("");
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
