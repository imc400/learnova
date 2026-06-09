# Formulario de auditoría de YouTube — respuestas listas

**Proyecto:** Aulia · Project Number `81836469922` · Project ID `learnova-498716`
**Formulario:** YouTube API Services – Audit and Quota Extension Form
**Sección 1:** "Completar una auditoría de cumplimiento para solicitar un aumento de cuota"

> ⚠️ Antes de enviar: la app debe estar DESPLEGADA (URL pública), con /privacidad y /terminos vivas, y un demo grabado. Reemplazar https://learnova.app por el dominio real de Vercel.

---

## Sección 2 — Organización y contacto

Organization / Developer name: Aulia
Website / API Client URL: https://learnova.app (URL de producción en Vercel; reemplazar por el dominio en vivo al desplegar). Página que muestra la integración con YouTube: https://learnova.app/app/rutas/<id>/leccion/<id> (cada lección incrusta un video de YouTube con el reproductor IFrame oficial).
Contact email: igblancora@gmail.com
Country: Chile
Google Cloud Project Number: 81836469922
Project ID: learnova-498716
Describe your organization's work as it relates to YouTube: 'Aulia es una plataforma educativa B2C. Usamos la YouTube Data API v3 para curar e incrustar, mediante el reproductor IFrame oficial de YouTube, el mejor video educativo gratuito para cada paso de las rutas de aprendizaje personalizadas que generamos con IA. YouTube es la fuente del componente en video de cada lección.'

---

## Sección 3 — Modelo de negocio

Business model: SaaS educativo por suscripción (freemium). Plan Gratis (1 ruta), plan Pro mensual (USD 15) y compra de ruta única (USD 19). Pagos procesados con Flow.cl (Chile).
Does your API Client commercialize YouTube Data? No. No vendemos, sublicenciamos ni cobramos por los datos ni por los videos de YouTube. Los videos se muestran gratis e incrustados dentro de la experiencia educativa; lo que el usuario paga es la generación de rutas y el tutor de IA (valor independiente de Aulia). El contenido de YouTube no está detrás del paywall: se incrusta con el reproductor oficial, con ads habilitados y atribución a YouTube.
Independent value: Aulia aporta valor propio (currículum generado por IA, pruebas, tutor en vivo, seguimiento de progreso); no es un clon de YouTube ni reemplaza a YouTube. Beneficia a los creadores de YouTube al dirigir audiencia educativa cualificada a sus videos, con atribución y enlace 'Ver en YouTube'.
Metrics derived from YouTube data? No calculamos ni mostramos métricas propias derivadas de datos de YouTube. Solo usamos metadatos oficiales (título, canal, idioma, duración, subtítulos) para curar; cualquier estadística (views/likes) se usa transitoriamente en memoria para el ranking y no se almacena ni se muestra al usuario.

---

## Sección 4 — Clientes de API (API Clients)

API Client name: Aulia (aplicación web Next.js).
Where can we find the API Client? https://learnova.app — integración visible en cualquier lección: https://learnova.app/app/rutas/<pathId>/leccion/<lessonId>
Project Number: 81836469922 · Project ID: learnova-498716
Is this publicly or privately available? Privately (tras registro/login gratuito). Proveeremos una cuenta demo a los revisores.
Login / Demo account access: Cuenta demo: demo@learnova.app / (contraseña que se entrega en el formulario). Pasos: 1) iniciar sesión, 2) 'Crear mi ruta', 3) responder el cuestionario (ej. tema 'Python', nivel principiante, idioma español), 4) abrir cualquier lección → se muestra el video de YouTube incrustado con atribución y enlace 'Ver en YouTube'.
API Client use case category: 'Video discovery / education' (descubrimiento y reproducción incrustada de videos educativos). YouTube API Services used: YouTube Data API v3 (search.list, videos.list) + reproductor IFrame.
Uses OAuth / Google credential auth? No. Solo API Key server-side; no accedemos a cuentas de usuarios de Google/YouTube.
Multiple platforms? Solo web (responsive) por ahora.
Uses YouTube Reporting/Analytics API? No.

---

## Sección 5 — Casos prácticos y cuota

Use case (concreto): 'Por cada ruta de aprendizaje que un usuario genera, la IA crea entre ~25 y 45 lecciones. Para cada lección hacemos UNA búsqueda search.list (100 unidades) para encontrar videos candidatos y UNA llamada videos.list por lote de 50 IDs (1 unidad) para obtener metadatos y filtrar por idioma/duración/embebibilidad. Luego incrustamos el mejor video con el reproductor IFrame oficial.'
MATEMÁTICA DE CUOTA POR RUTA: ~45 lecciones × (100 u search.list + 1 u videos.list) ≈ 45 × 101 ≈ 4.545 → redondeamos a ~4.600 unidades por ruta generada.
MITIGACIONES YA IMPLEMENTADAS (uso eficiente): (a) caché de búsquedas youtube_search_cache que guarda IDs por query+idioma (TTL 21 días) → búsquedas repetidas no consumen las 100 u; (b) 'caché de cabeza gruesa' (skeleton_cache) que reutiliza el currículum entre usuarios del mismo tema/nivel/idioma, maximizando aciertos de la caché de búsquedas; (c) parámetro fields para pedir solo los campos usados; (d) batch de 50 IDs por videos.list.
VOLUMEN Y PROYECCIÓN: Hoy en lanzamiento. Plan de crecimiento vía paid ads (Meta) en Chile/LatAm. Proyección a 6 meses: ~150-200 rutas nuevas/día. 200 rutas/día × 4.600 u ≈ 920.000 unidades/día (sin contar el job diario de refresco de metadatos, ~1.000 u/día con decenas de miles de videos).
CUOTA SOLICITADA: 1.000.000 unidades/día. Justificación: cubre ~200 rutas/día de generación + el job de cumplimiento (refresco/borrado de metadatos a <30 días) + picos de campañas de adquisición, con margen razonable para el crecimiento proyectado. La cuota por defecto (10.000 u/día) solo alcanza para ~2 rutas/día, lo que bloquea el producto.
Data refresh frequency: metadatos de video refrescados/borrados automáticamente cada día (cutoff 25 días, máximo de retención 30 días). Búsquedas (solo IDs) cacheadas hasta 21 días.

---

## Sección 6 — Pruebas y documentación

Adjuntar: (1) Screencast (60-90 s) mostrando el flujo: crear ruta → abrir lección → video de YouTube incrustado con el reproductor IFrame oficial, atribución 'Video proporcionado por YouTube' con logo clicable y enlace 'Ver en YouTube'. (2) Screenshots: pantalla de lección con el embed y la atribución; el footer con la mención a los Servicios de la API de YouTube + enlaces a Términos de YouTube (https://www.youtube.com/t/terms) y Política de Privacidad de Google (https://policies.google.com/privacy); la página /privacidad publicada; la página /terminos publicada. (3) Enlaces vivos: https://learnova.app/privacidad y https://learnova.app/terminos.
Credenciales demo: demo@learnova.app + contraseña (en el campo correspondiente del formulario) con instrucciones paso a paso para llegar a una lección con video.
Declaración de cumplimiento de código: usamos solo API Key server-side (sin OAuth), reproductor IFrame sin modificar (youtube-nocookie.com), NO hacemos scraping, NO descargamos ni re-alojamos audio/video, y refrescamos/borramos los metadatos antes de 30 días.

---

## Sección 7 — Declaraciones (Attestations)

Confirmamos que: (1) Cumplimos los YouTube API Services Terms of Service y las Developer Policies. (2) Mantenemos publicada y accesible una Política de Privacidad (https://learnova.app/privacidad) que notifica el uso de los Servicios de la API de YouTube y enlaza la Política de Privacidad de Google. (3) Nuestros Términos (https://learnova.app/terminos) enlazan los Términos de Servicio de YouTube y declaran que al usar la app el usuario los acepta. (4) Mostramos las YouTube Brand Features y la atribución a YouTube en toda página que muestra contenido de YouTube, con el logo clicable de vuelta a YouTube, sin modificar el reproductor ni ocultar la atribución. (5) NO almacenamos contenido audiovisual; almacenamos metadatos públicos por un máximo de 30 días, con refresco/borrado automático y desactivación de videos caídos. (6) NO hacemos scraping ni eludimos límites de cuota. (7) Si Google termina nuestro acceso, cesaremos el uso y eliminaremos los datos de la API. (8) Cumplimos la EU User Consent Policy de Google para usuarios de la UE. (9) No solicitamos OAuth ni datos sensibles de usuarios.

---

