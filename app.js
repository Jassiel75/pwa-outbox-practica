const formIncidencia = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado con scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

function actualizarIndicadorRed(){
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

function renderizarColaOutbox(){
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        const li = document.createElement('li');
        li.className = 'vacio';
        li.textContent = 'No hay registros en la bandeja';
        listaOutbox.appendChild(li);
        return;
      }

      registros.forEach((item) => {
        const li = document.createElement('li');

        const titulo = document.createElement('strong');
        titulo.textContent = item.titulo;

        const hora = document.createElement('span');
        hora.className = 'hora';
        hora.textContent = new Date(item.fechaCreacion).toLocaleTimeString();

        const estado = document.createElement('span');
        estado.className = 'estado ' + item.estado;
        estado.textContent = item.estado;

        li.appendChild(titulo);
        li.appendChild(hora);
        li.appendChild(estado);
        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('Error al leer IndexedDB:', error);
    });
}

function procesarEnvioReporte(datosFormulario){
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

function sincronizarPendientesFallback(){
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

formIncidencia.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .catch((error) => {
      console.error('Error al procesar el reporte:', error);
    });

  formIncidencia.reset();
});

btnPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('Error al purgar registros:', error);
    });
});

actualizarIndicadorRed();
renderizarColaOutbox();
