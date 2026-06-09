// Contenido legal de Aulia (Markdown). Renderizado en /privacidad y /terminos.
// Generado por el workflow de auditoría de YouTube; editar aquí si cambian las políticas.

export const PRIVACY_MD = `# Política de Privacidad de Aulia

**Última actualización: 8 de junio de 2026**

Esta Política de Privacidad describe cómo Aulia ("Aulia", "nosotros", "nuestro") recopila, usa, almacena y comparte información cuando utilizas nuestro sitio web y nuestra aplicación (en conjunto, el "Servicio"). Aulia es una plataforma educativa que crea rutas de aprendizaje personalizadas con inteligencia artificial.

Al usar el Servicio aceptas las prácticas descritas en esta Política. Si no estás de acuerdo, por favor no utilices el Servicio.

---

## 1. Quiénes somos y cómo contactarnos

Aulia es operado desde Chile. El responsable del tratamiento de tus datos es Aulia.

- **Correo de contacto y privacidad:** igblancora@gmail.com

Para cualquier consulta, solicitud de acceso o eliminación de datos, escríbenos a esa dirección.

---

## 2. Uso de los Servicios de la API de YouTube (declaración obligatoria)

Aulia utiliza los **Servicios de la API de YouTube** ("YouTube API Services"). Concretamente, usamos la **YouTube Data API v3** para buscar y obtener metadatos públicos de videos (título, canal, duración, idioma, si tiene subtítulos) y para incrustar (embeber) videos públicos dentro de cada lección mediante el reproductor oficial de YouTube. No accedemos a tu cuenta de Google ni de YouTube, no solicitamos tu inicio de sesión de Google y no descargamos ni almacenamos los archivos de audio o video.

Al usar Aulia también quedas vinculado por los siguientes documentos de Google/YouTube:

- **Términos de Servicio de YouTube:** https://www.youtube.com/t/terms
- **Política de Privacidad de Google:** https://policies.google.com/privacy

Te recomendamos leer la **Política de Privacidad de Google** (https://policies.google.com/privacy) para entender cómo Google trata los datos cuando reproduces un video incrustado de YouTube. Google puede recopilar información a través del reproductor incrustado conforme a su propia política. Para limitar las cookies, usamos el dominio de privacidad mejorada \`youtube-nocookie.com\` en nuestros reproductores.

Si en algún momento Google revoca o termina nuestro acceso a la API de YouTube, dejaremos de usar y eliminaremos los datos obtenidos a través de dicha API conforme a sus Términos.

---

## 3. Qué información recopilamos

### 3.1. Información que nos das directamente
- **Datos de cuenta:** tu correo electrónico y, opcionalmente, tu nombre y foto de perfil (avatar), gestionados a través de nuestro proveedor de autenticación (Supabase).
- **Preferencias de aprendizaje:** el idioma que eliges, tu nivel declarado, tu objetivo de aprendizaje y las respuestas del cuestionario inicial (intake) que usamos para construir tu ruta.
- **Contenido que generas:** tus interacciones con el tutor de IA, tus respuestas a las pruebas (quizzes) y tu progreso de aprendizaje.

### 3.2. Información de pago
Si compras una suscripción Pro o una ruta única, el pago se procesa a través de **Flow.cl**. Aulia no almacena los datos completos de tu tarjeta; estos son tratados directamente por el procesador de pagos. Conservamos un identificador de la transacción, el estado del pago, el monto y la moneda para gestionar tu suscripción.

### 3.3. Datos obtenidos de la API de YouTube
Para cada lección recopilamos y almacenamos temporalmente metadatos públicos de los videos candidatos: el identificador del video de YouTube, el título, el nombre del canal, el idioma del audio, la duración y si tiene subtítulos. Estos datos provienen exclusivamente de la API oficial de YouTube; **no hacemos scraping** de YouTube ni de ningún otro sitio.

### 3.4. Datos técnicos
De forma estándar, nuestros proveedores de infraestructura pueden registrar datos técnicos (dirección IP, tipo de navegador, registros de error) con fines de seguridad y operación del Servicio.

---

## 4. Cómo usamos tu información

Usamos la información para:
- Crear, personalizar y entregar tus rutas de aprendizaje (incluido seleccionar los videos de YouTube más relevantes para cada paso).
- Operar el tutor de IA y corregir tus pruebas.
- Registrar y mostrar tu progreso.
- Gestionar tu cuenta, tu suscripción y tus pagos.
- Mantener la seguridad, prevenir abusos y cumplir obligaciones legales.
- Mejorar el Servicio.

No vendemos tus datos personales. No usamos tus datos personales para publicidad de terceros. Los metadatos de YouTube se usan únicamente para mostrarte y curar videos dentro de tu ruta.

---

## 5. Con quién compartimos tu información (terceros / encargados)

Compartimos datos únicamente con los proveedores que hacen posible el Servicio, cada uno bajo sus propias obligaciones de seguridad:

| Proveedor | Para qué | Política |
|---|---|---|
| **Supabase** | Base de datos, autenticación y almacenamiento (correo, nombre, progreso, rutas) | https://supabase.com/privacy |
| **Google / YouTube** | Búsqueda de videos y reproductor incrustado (YouTube Data API v3 + reproductor IFrame) | https://policies.google.com/privacy |
| **Anthropic (Claude)** | Generación de rutas, lecciones, pruebas y respuestas del tutor de IA | https://www.anthropic.com/legal/privacy |
| **Flow.cl** | Procesamiento de pagos en Chile | https://www.flow.cl/wp-content/uploads/2023/06/politica-de-privacidad.pdf |
| **Vercel** | Alojamiento (hosting) de la aplicación | https://vercel.com/legal/privacy-policy |

Cuando interactúas con el tutor de IA, el texto de tu consulta y el contexto de tu lección se envían a Anthropic para generar la respuesta. Anthropic procesa estos datos como encargado y, según sus políticas comerciales, no los utiliza para entrenar sus modelos.

También podemos divulgar información si la ley lo exige o para proteger nuestros derechos.

---

## 6. Almacenamiento y retención de datos

- **Datos de cuenta y de aprendizaje:** los conservamos mientras tu cuenta esté activa. Si solicitas la eliminación de tu cuenta, los borramos (ver Sección 7).
- **Metadatos de videos de YouTube:** conservamos los metadatos públicos (título, canal, idioma, duración) **solo el tiempo necesario y nunca más de 30 días naturales**. Antes de ese plazo, un proceso automático los **refresca volviendo a consultar la API de YouTube** o, si el video ya no está disponible, los **elimina/desactiva**. Esto cumple las políticas de almacenamiento de los Servicios de la API de YouTube.
- **Datos de pago:** se conservan el tiempo necesario para fines contables y legales.
- **Terminación del acceso a la API de YouTube:** si nuestro acceso a la API de YouTube termina, dejaremos de usar y eliminaremos los datos obtenidos a través de ella.

Mantenemos controles administrativos, organizativos y técnicos razonables para proteger tu información (cifrado en tránsito, control de acceso por usuario y aislamiento de datos por cuenta).

---

## 7. Tus derechos

Dependiendo de tu jurisdicción, tienes derecho a:
- **Acceder** a los datos personales que tenemos sobre ti.
- **Rectificar** datos inexactos.
- **Eliminar** tu cuenta y tus datos personales ("derecho al olvido").
- **Exportar** tus datos.
- **Oponerte o limitar** ciertos tratamientos.

Para ejercer cualquiera de estos derechos, escríbenos a **igblancora@gmail.com**. Responderemos dentro de los plazos que exija la ley aplicable. Al eliminar tu cuenta, borramos tus rutas, tu progreso, tus conversaciones con el tutor y tus datos de perfil.

### Usuarios de la Unión Europea
Si accedes al Servicio desde la Unión Europea, cumplimos con la **Política de Consentimiento de Usuarios de la UE de Google** (https://www.google.com/about/company/user-consent-policy.html) en relación con el contenido y los reproductores de YouTube, y con el RGPD respecto del tratamiento de tus datos personales. La base legal de nuestro tratamiento es la ejecución del contrato (prestarte el Servicio), tu consentimiento y nuestro interés legítimo en operar y mejorar la plataforma.

---

## 8. Cookies y tecnologías similares

Usamos cookies estrictamente necesarias para mantener tu sesión iniciada (autenticación). Los videos de YouTube se incrustan a través del dominio de privacidad mejorada **youtube-nocookie.com**, que reduce las cookies que YouTube coloca hasta que reproduces un video. Cuando reproduces un video, Google/YouTube puede establecer cookies conforme a la Política de Privacidad de Google. No utilizamos cookies publicitarias de terceros.

---

## 9. Menores de edad

El Servicio no está dirigido a menores de 14 años. Si eres menor de edad según la legislación de tu país, debes contar con la autorización de tu padre, madre o tutor para usar Aulia. No recopilamos conscientemente datos de menores sin dicha autorización.

---

## 10. Datos sensibles

No solicitamos ni requerimos datos sensibles (salud, origen racial o étnico, opiniones políticas, religión, orientación sexual, datos biométricos). Te pedimos que no incluyas información sensible en tus conversaciones con el tutor de IA.

---

## 11. Cambios a esta Política

Podemos actualizar esta Política de Privacidad. Publicaremos la versión vigente en esta misma página con su fecha de actualización. Mantendremos siempre una política de privacidad publicada y accesible mientras usemos los Servicios de la API de YouTube.

---

## 12. Contacto

¿Preguntas sobre privacidad? Escríbenos a **igblancora@gmail.com**.
`;

export const TERMS_MD = `# Términos y Condiciones de Aulia

**Última actualización: 8 de junio de 2026**

Bienvenido a Aulia. Estos Términos y Condiciones ("Términos") regulan el uso de nuestro sitio web y aplicación (el "Servicio"), operados desde Chile. Al crear una cuenta o utilizar el Servicio, aceptas estos Términos. Si no estás de acuerdo, no uses el Servicio.

---

## 1. Qué es Aulia

Aulia es una plataforma educativa que utiliza inteligencia artificial para crear **rutas de aprendizaje personalizadas**: módulos paso a paso, lecciones, pruebas, un tutor de IA y videos educativos gratuitos curados desde YouTube para cada paso de tu ruta.

Aulia es una herramienta de apoyo al aprendizaje. No es una institución educativa acreditada y no otorga títulos oficiales. El contenido generado por IA puede contener errores; úsalo con criterio.

---

## 2. Tu cuenta

- Debes proporcionar información veraz al registrarte y mantenerla actualizada.
- Eres responsable de la confidencialidad de tus credenciales y de toda actividad en tu cuenta.
- Debes tener al menos 14 años, o contar con autorización de tu tutor legal si la ley de tu país lo exige.
- Puedes cerrar tu cuenta en cualquier momento escribiéndonos a igblancora@gmail.com.

---

## 3. Contenido de YouTube y Términos de Servicio de YouTube

Aulia muestra videos de YouTube dentro de las lecciones usando el **reproductor incrustado (IFrame) oficial de YouTube** y los **Servicios de la API de YouTube** ("YouTube API Services"). Los videos son propiedad de sus respectivos creadores y de YouTube; Aulia no es dueño de ese contenido ni lo aloja.

**Al usar Aulia aceptas quedar vinculado por los Términos de Servicio de YouTube, disponibles en https://www.youtube.com/t/terms.** Te recomendamos leerlos. El uso del contenido de YouTube dentro de Aulia está sujeto a dichos Términos y a la Política de Privacidad de Google (https://policies.google.com/privacy).

No descargamos, redistribuimos ni modificamos el contenido audiovisual de YouTube, y no permitimos descargarlo ni reproducirlo fuera del reproductor oficial.

---

## 4. Planes, precios y pagos

- Aulia ofrece un plan **Gratis**, un plan **Pro** (suscripción mensual) y la compra de **rutas únicas**.
- Los pagos se procesan a través de **Flow.cl**. Los precios se muestran en la moneda indicada en el Servicio e incluyen los impuestos cuando corresponda.
- Las suscripciones se renuevan automáticamente hasta que las canceles. Puedes cancelar en cualquier momento; el acceso Pro continúa hasta el final del período ya pagado.
- Salvo que la ley aplicable disponga lo contrario, los pagos ya realizados no son reembolsables. Para consultas de facturación, escríbenos a igblancora@gmail.com.

---

## 5. Uso aceptable

Te comprometes a no:
- Usar el Servicio para fines ilegales o no autorizados.
- Intentar descargar, copiar, redistribuir o re-alojar el contenido audiovisual de YouTube.
- Interferir con la atribución, el reproductor o las funciones de YouTube.
- Realizar ingeniería inversa, raspado (scraping) automatizado, o sobrecargar la infraestructura del Servicio.
- Compartir tu cuenta de forma que eluda los límites de los planes.
- Subir contenido ilegal, ofensivo o que infrinja derechos de terceros al tutor de IA o a cualquier campo de texto.

Podemos suspender o cerrar cuentas que incumplan estos Términos.

---

## 6. Propiedad intelectual

- La plataforma Aulia, su software, diseño, marca y los materiales generados por nuestra IA para tu ruta se entregan para tu uso personal de aprendizaje.
- Los videos de YouTube pertenecen a sus creadores y a YouTube. Las marcas "YouTube" y su logotipo son propiedad de Google LLC.
- No adquieres ningún derecho de propiedad sobre el contenido de terceros mostrado en el Servicio.

---

## 7. Contenido generado por IA

Las rutas, lecciones, pruebas y respuestas del tutor se generan con modelos de inteligencia artificial (Anthropic Claude). Aunque buscamos calidad y precisión, el contenido puede contener imprecisiones. No constituye asesoría profesional (médica, legal, financiera u otra). Verifica la información crítica con fuentes oficiales.

---

## 8. Disponibilidad del Servicio

Nos esforzamos por mantener el Servicio disponible, pero no garantizamos su funcionamiento ininterrumpido. Podemos modificar, suspender o discontinuar funciones (incluida la disponibilidad de un video específico si es eliminado de YouTube) sin responsabilidad.

---

## 9. Limitación de responsabilidad

En la máxima medida permitida por la ley, Aulia se entrega "tal cual" y "según disponibilidad". No seremos responsables por daños indirectos, incidentales o consecuentes derivados del uso del Servicio o del contenido de terceros. Nada en estos Términos limita responsabilidades que no puedan excluirse legalmente.

---

## 10. Privacidad

El tratamiento de tus datos personales se rige por nuestra [Política de Privacidad](/privacidad), que forma parte integral de estos Términos.

---

## 11. Ley aplicable y jurisdicción

Estos Términos se rigen por las leyes de la República de Chile. Cualquier controversia se someterá a los tribunales competentes de Chile, sin perjuicio de los derechos irrenunciables que la ley de tu país de residencia te otorgue como consumidor.

---

## 12. Cambios a estos Términos

Podemos actualizar estos Términos. Publicaremos la versión vigente en esta página con su fecha. El uso continuado del Servicio tras un cambio implica tu aceptación.

---

## 13. Contacto

Para cualquier consulta sobre estos Términos, escríbenos a **igblancora@gmail.com**.
`;
