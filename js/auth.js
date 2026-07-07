// Lógica compartida de autenticación y roles.
// Cada página protegida llama a requireAuth(callback) al cargar.

/**
 * Verifica que haya una sesión activa y que el usuario tenga un rol
 * asignado en Firestore (colección "usuarios", documento = uid).
 * Si todo está OK, ejecuta callback(user, datosUsuario).
 * Si no hay sesión, redirige a login.html.
 * Si hay sesión pero no tiene rol asignado, muestra un aviso y no continúa.
 *
 * loginPath: ruta relativa a login.html desde la página que llama (por defecto "login.html")
 */
function requireAuth(callback, loginPath = "login.html") {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = loginPath;
      return;
    }

    try {
      const doc = await db.collection("usuarios").doc(user.uid).get();

      if (!doc.exists) {
        mostrarErrorSinRol();
        return;
      }

      const datosUsuario = doc.data();

      if (datosUsuario.activo === false) {
        mostrarErrorSinRol("Este usuario fue dado de baja. Contactá al administrador.");
        return;
      }

      callback(user, datosUsuario);
    } catch (error) {
      console.error("Error al obtener el rol del usuario:", error);
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
