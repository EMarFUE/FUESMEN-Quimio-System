// Lógica compartida de autenticación y roles.
// Cada página protegida llama a requireAuth(callback) al cargar.
//
// Patrón de visibilidad unificado (Etapa 7):
// - El <body> de cada página protegida arranca con style="visibility:hidden"
// - requireAuth inyecta un spinner mientras espera la respuesta de Firestore
// - Al confirmar el rol, revela el body de una sola vez (visibility:visible)
// - Así ningún contenido protegido se muestra antes de resolver los permisos

function _inyectarSpinner() {
  const spinner = document.createElement("div");
  spinner.id = "auth-spinner";
  spinner.innerHTML = `
    <div style="
      position:fixed; inset:0; display:flex; align-items:center;
      justify-content:center; background:var(--color-fondo, #f5f7fa);
      z-index:9999;
    ">
      <div style="text-align:center; color:var(--color-muted, #888); font-size:14px; font-family:inherit;">
        <div style="
          width:28px; height:28px; border:3px solid var(--color-borde, #ddd);
          border-top-color:var(--color-primario, #5eb3e6);
          border-radius:50%; animation:auth-spin 0.7s linear infinite;
          margin:0 auto 12px;
        "></div>
        Verificando acceso…
      </div>
    </div>
    <style>
      @keyframes auth-spin { to { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(spinner);
}

function _quitarSpinner() {
  const spinner = document.getElementById("auth-spinner");
  if (spinner) spinner.remove();
}

function _revelarPagina() {
  document.body.style.visibility = "visible";
  _quitarSpinner();
}

/**
 * Verifica que haya una sesión activa y que el usuario tenga un rol
 * asignado en Firestore (colección "usuarios", documento = uid).
 * Si todo está OK, ejecuta callback(user, datosUsuario).
 * Si no hay sesión, redirige a login.html.
 * Si hay sesión pero no tiene rol asignado, muestra un aviso y no continúa.
 *
 * loginPath: ruta relativa a login.html desde la página que llama
 */
function requireAuth(callback, loginPath = "login.html") {
  _inyectarSpinner();

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = loginPath;
      return;
    }

    try {
      const doc = await db.collection("usuarios").doc(user.uid).get();

      if (!doc.exists) {
        _revelarPagina();
        mostrarErrorSinRol();
        return;
      }

      const datosUsuario = doc.data();

      if (datosUsuario.activo === false) {
        _revelarPagina();
        mostrarErrorSinRol("Este usuario fue dado de baja. Contactá al administrador.");
        return;
      }

      // El rol está confirmado: ejecutar el callback de la página,
      // luego revelar el body ya con los permisos aplicados.
      await callback(user, datosUsuario);
      _revelarPagina();

    } catch (error) {
      console.error("Error al obtener el rol del usuario:", error);
      _revelarPagina();
      mostrarErrorSinRol("No se pudo verificar el rol del usuario. Reintentá en unos segundos.");
    }
  });
}

function mostrarErrorSinRol(mensaje = "Tu usuario todavía no tiene un rol asignado. Contactá al administrador.") {
  document.body.innerHTML = `
    <div class="pantalla-error">
      <p>${mensaje}</p>
      <button onclick="cerrarSesion()">Cerrar sesión</button>
    </div>
  `;
}

function cerrarSesion(loginPath = "login.html") {
  auth.signOut().then(() => {
    window.location.href = loginPath;
  });
}

// Traduce los códigos de error de Firebase Auth a mensajes en español
function traducirErrorAuth(codigo) {
  const mensajes = {
    "auth/invalid-email": "El formato del email no es válido.",
    "auth/user-not-found": "No existe un usuario con ese email.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos fallidos. Esperá unos minutos y volvé a intentar.",
    "auth/user-disabled": "Este usuario fue deshabilitado.",
    "auth/network-request-failed": "Error de conexión. Revisá tu internet."
  };
  return mensajes[codigo] || "Ocurrió un error al iniciar sesión. Intentá de nuevo.";
}
