Desarrolla una plataforma web de captura, clasificación y consulta de inventario para “Aly — Creaciones con estilo”, un negocio de listones, productos impresos y aplicaciones decorativas.

El nombre, logotipo y datos del negocio deben ser configurables.

OBJETIVO

Crear desde cero un catálogo de aproximadamente 5,000 SKU mediante el trabajo simultáneo de varios empleados.

La prioridad es una captura rápida, clara y confiable para personas sin conocimientos técnicos. El flujo principal debe permitir:

Buscar si el producto ya existe → registrar el producto o su variante → capturar cantidad y ubicación → guardar → generar SKU y QR → continuar con el siguiente producto.

Esta misma base servirá posteriormente para organizar fotografías y alimentar un ecommerce. Debemos conservar los identificadores y las relaciones entre productos durante todas esas etapas.

Construye una aplicación funcional con autenticación, base de datos persistente y permisos reales. Los datos deben conservarse al cerrar sesión o cambiar de dispositivo.

Toda la interfaz debe estar en español. Utiliza formato de México y MXN como moneda inicial configurable.

1. PRODUCTOS, VARIANTES Y SKU

Distingue estas entidades:

- Producto o modelo: agrupa variantes de un mismo diseño.
- Variante inventariable: combinación específica de características que recibe un SKU.
- Existencia: cantidad de una variante en una ubicación física.

Ejemplo ficticio:

Producto: Listón arcoíris con borde decorativo.
Variante A: ancho de 25 mm.
Variante B: ancho de 38 mm.

Cada variante tiene un SKU diferente. Varias unidades idénticas comparten SKU. Un mismo SKU puede existir en distintas ubicaciones.

El producto padre no debe acumular existencias adicionales a las de sus variantes.

Genera automáticamente códigos legibles como ALY-000001, con prefijo configurable para nuevas altas.

Reglas:
- Asignar el SKU al confirmar el registro.
- Generarlo en el servidor y garantizar su unicidad en la base de datos.
- Soportar altas simultáneas sin colisiones.
- No reutilizar códigos de productos archivados.
- No incorporar categorías, ubicaciones o precios al código.
- Mantenerlo aunque cambien el nombre, la clasificación o la ubicación.
- Usar además un identificador interno estable para relaciones y enlaces.
- Guardar códigos del proveedor o códigos anteriores en campos separados.

2. USUARIOS Y PERMISOS

Solo habrá dos roles: Administrador y Editor.

ADMINISTRADOR
- Consultar y modificar todos los productos.
- Ver, capturar y modificar costos.
- Administrar categorías, atributos, unidades y ubicaciones.
- Corregir conteos y registrar ajustes con motivo.
- Archivar productos.
- Descargar informes y la base completa del catálogo.
- Gestionar usuarios y asignar roles.
- Revisar actividad e historial de cambios.
- Gestionar fotografías y estados de revisión.

EDITOR
- Consultar el catálogo, características, ubicaciones y existencias.
- Buscar y filtrar productos.
- Crear nuevos productos y variantes.
- Capturar cantidades iniciales como parte del levantamiento.
- Guardar y editar sus propios borradores.
- Consultar QR y generar etiquetas individuales de los registros capturados.
- Después de confirmar un registro, solicitar correcciones al Administrador.

El Editor no puede:
- Ver, registrar ni modificar costos o valoraciones.
- Editar libremente registros ya confirmados.
- Ajustar existencias confirmadas.
- Eliminar o archivar productos.
- Administrar categorías, usuarios o configuración.
- Descargar el catálogo completo ni informes.

Los registros creados por un Editor quedan con costo pendiente para el Administrador. No usar cero para representar un costo desconocido.

Aplicar permisos en servidor y base de datos, además de la interfaz. Los costos no deben enviarse al navegador del Editor ni exponerse mediante consultas, exportaciones, historial o endpoints alternativos.

Utilizar una tabla privada para costos o una protección equivalente que controle el acceso a esos campos. Ocultar una columna visualmente no es suficiente.

El acceso será por cuentas autorizadas. El usuario no puede elegir ni modificar su propio rol. Documentar el procedimiento seguro para crear al primer Administrador.

3. CATEGORÍAS FLEXIBLES

Implementa un árbol editable de categorías con hasta cuatro niveles inicialmente.

No obligar a completar los cuatro niveles si una clasificación necesita menos.

Ejemplos ficticios para demostrar el funcionamiento:
- Listones > Textiles > Estampados > Escolares.
- Listones > Decorativos > Lentejuelas > Reversibles.
- Aplicaciones > Figuras decorativas > Temáticas > Navidad.
- Accesorios > Dijes > Miniaturas > Audífonos.
- Productos impresos > Aplicaciones > Temáticos > Regionales.

Estas categorías son demostrativas y deben poder reemplazarse por las reales.

El Administrador puede crear, renombrar, mover, ordenar y desactivar categorías. Impedir ciclos en el árbol y exigir reasignación antes de eliminar una categoría con productos.

No programar las categorías como listas fijas dentro del código.

Mantener por separado:
- Categoría comercial.
- Tipo de producto y sus atributos.
- Ubicación física.

Los colores, medidas y acabados deben manejarse principalmente como atributos, evitando crear una categoría para cada combinación.

Permitir “Por clasificar” cuando todavía no se conoce la categoría correcta y mostrarlo como pendiente de revisión.

4. FICHA Y ATRIBUTOS DEL PRODUCTO

Datos generales:
- SKU automático.
- Nombre.
- Producto o modelo al que pertenece.
- Tipo de producto.
- Ruta de categorías.
- Descripción breve.
- Usos o aplicaciones mediante etiquetas.
- Código de proveedor opcional.
- Observaciones.
- Usuario y fecha de captura.

Características configurables según el tipo:
- Diseño o modelo.
- Color principal y colores secundarios.
- Material.
- Acabado: mate, brillante, glitter, lentejuela u otros.
- Ancho, alto, largo, diámetro o grosor cuando corresponda.
- Unidad de cada medida.
- Presentación.
- Contenido por presentación, cuando se conozca.
- Otros atributos definidos por el Administrador.

Ejemplos:
- Listones: ancho, material, diseño, acabado y color.
- Aplicaciones decorativas: alto, ancho, diseño, material y acabado.
- Dijes: forma, color, acabado y dimensiones.
- Productos impresos: formato, dimensiones, material y diseño.

Especificaciones de cada SKU (todos los tipos, solicitadas por el cliente el 2026-11-03):
- Tipo de empaque: Unitario, En conjunto o Por caja (obligatorio al confirmar; admite «Dato pendiente»).
- Peso del producto, en gramos o kilogramos.
- Medidas del producto en centímetros: largo, ancho y alto.
- Ubicación: rack o lugar del almacén donde se encuentra (usa el árbol de ubicaciones).
- Cantidad en existencia: lo que hay en almacén, en la unidad base del SKU (piezas, metros, etc.).

Permitir atributos de texto, número, selección y selección múltiple. Configurar cuáles son obligatorios y cuáles distinguen variantes.

Mostrar únicamente los campos relevantes para el tipo seleccionado.

Distinguir entre “No aplica”, “Dato pendiente” y un valor real. No inventar medidas ni obligar a completar información desconocida para avanzar.

Datos de inventario:
- Unidad base.
- Cantidad en existencia (contada) o estado “Pendiente de conteo”.
- Ubicación física (rack del almacén).
- Fecha y responsable del conteo.

Datos privados del Administrador:
- Costo por unidad base.
- Moneda.
- Fecha de actualización del costo.

Las fotografías y el costo no son obligatorios para registrar un SKU.

5. UNIDADES Y CONTEO

Cada SKU debe tener una unidad base explícita, por ejemplo pieza, metro, rollo o paquete.

Mostrar siempre la unidad junto a la cantidad y el costo:
- 35.5 metros.
- 12 piezas.
- $8.50 por metro.

Permitir decimales para unidades divisibles e impedir fracciones cuando la unidad requiera enteros.

No sumar metros, rollos y piezas directamente.

Cuando un producto se controle en metros, permitir capturar rollos completos y metros sueltos únicamente si existe un factor de conversión conocido.

Ejemplo:
2 rollos de 20 metros + 5 metros sueltos = 45 metros.

Si se desconoce el contenido de un rollo, no inventar la conversión. Marcar la información pendiente.

Evitar registrar el mismo inventario simultáneamente como metros y como rollos independientes. Una presentación diferente solo debe generar otro SKU cuando se administre realmente como una variante distinta.

Distinguir:
- Cero: se contó y no hay existencias.
- Pendiente: todavía no se ha contado.

Registrar el conteo inicial con responsable, fecha, ubicación y referencia de captura.

Para el levantamiento inicial, mantener un único conteo confirmado por SKU y ubicación dentro de la misma sesión de inventario. Si otra persona intenta registrar el mismo conteo, avisar y enviar a revisión; no sumar automáticamente.

Si se encuentra un SKU existente en otra ubicación, registrar su conteo en esa ubicación sin crear un nuevo SKU.

Los ajustes posteriores corresponden al Administrador, requieren motivo y conservan historial. No permitir sobrescrituras silenciosas ni existencias negativas.

6. PANEL DE CAPTURA RÁPIDA

Crear una pantalla “Capturar SKU” con:
- Búsqueda previa de coincidencias.
- Selección de producto existente o creación de uno nuevo.
- Formulario dinámico por tipo.
- Clasificación mediante selectores dependientes.
- Cantidad y ubicación.
- Información adicional desplegable.
- Resumen antes de confirmar.

Acciones principales:
- Guardar y capturar siguiente.
- Guardar y generar etiqueta.
- Guardar borrador.
- Crear variante del mismo modelo.

Funciones para acelerar el trabajo:
- Navegación completa con teclado.
- Orden lógico al usar Tab.
- Autocompletado.
- Categorías y ubicaciones recientes.
- Opción explícita para conservar categoría, tipo y ubicación.
- Valores repetidos visibles para que el usuario pueda verificarlos.
- Duplicar como plantilla.
- Crear varias variantes en una tabla de colores y medidas.
- Vista previa de las combinaciones antes de guardarlas.
- Mostrar los errores junto al campo correspondiente.

Al duplicar, conservar solo los datos descriptivos elegidos. Limpiar SKU, cantidades, costos y estado del conteo.

En captura de variantes, crear únicamente las combinaciones seleccionadas. No generar productos que no existen por combinar todas las opciones indiscriminadamente.

Detectar posibles duplicados por modelo y atributos relevantes. Avisar con coincidencias y permitir abrir el registro existente.

Bloquear combinaciones exactamente duplicadas dentro del mismo producto cuando sus atributos definitorios estén completos. La ubicación o categoría no debe convertir un producto idéntico en una nueva variante.

Guardar producto, variante y conteo inicial de manera consistente. Prevenir duplicaciones por doble clic o reintentos de conexión.

Mostrar “Guardado” únicamente cuando el servidor confirme. Ante un error, conservar lo capturado para reintentar.

7. CONSULTA DEL CATÁLOGO

Crear un panel “Inventario” con tabla y vista de tarjetas.

Búsqueda por:
- SKU.
- Nombre.
- Modelo o diseño.
- Código de proveedor.
- Color.
- Etiquetas de uso.
- Ubicación.

Ignorar diferencias de mayúsculas y acentos en las búsquedas.

Filtros combinables:
- Categorías y subcategorías.
- Tipo.
- Color.
- Medidas.
- Ubicación.
- Con existencia, sin existencia o pendiente de conteo.
- Con fotografía o sin fotografía.
- Estado de revisión.
- Responsable y fecha de captura.
- Costo pendiente, solo para Administrador.

Columnas:
Miniatura, SKU, nombre, variante, categoría, cantidad, unidad, ubicación y estado.

Mostrar costos únicamente al Administrador.

Al abrir un producto, mostrar su ficha completa, variantes, ubicaciones, QR e historial autorizado.

Implementar búsquedas, filtros, ordenamiento y paginación en servidor. Preparar el sistema para más de 5,000 SKU sin descargar todo el catálogo en cada pantalla.

8. QR Y ETIQUETAS

Generar automáticamente un QR al guardar cada SKU.

El QR debe contener una URL estable que abra la ficha de esa variante usando su identificador interno.

No incluir costos, cantidades ni otros datos que puedan cambiar dentro del QR.

Al escanear:
- Abrir la ficha si hay sesión iniciada.
- Solicitar acceso si no hay sesión y después regresar al producto.
- Respetar siempre los permisos del usuario.

Usar una URL base configurable y documentar que las etiquetas definitivas deben imprimirse con el dominio de producción. Evitar imprimir enlaces temporales de vista previa.

Crear etiquetas con:
- QR legible.
- SKU en texto.
- Nombre corto.
- Características principales de la variante.

No imprimir costos por defecto.

Permitir:
- Impresión individual.
- Impresión por lotes para Administrador.
- Vista previa.
- Tamaño de etiqueta configurable.
- Reimpresión sin cambiar el identificador.

Incluir lectura por cámara cuando el dispositivo lo permita y búsqueda manual por SKU como alternativa.

El QR identifica la variante; no representa un número de serie distinto para cada pieza.

9. UBICACIONES Y PREPARACIÓN PARA FOTOGRAFÍA

Crear ubicaciones físicas configurables, por ejemplo:
Bodega > Pasillo A > Estante 03 > Caja 02.

El mismo SKU puede tener existencias en varias ubicaciones. Mostrar desglose y total en la unidad base.

Separar los estados:
- Registro: borrador, registrado, archivado.
- Revisión: pendiente, validado.
- Conteo: pendiente, realizado.
- Fotografía: pendiente, cargada, aprobada.

Permitir consultar una cola de productos pendientes de fotografía, agrupada por ubicación.

Preparar desde ahora una relación de varias imágenes por SKU con:
- Imagen principal.
- Galería ordenada.
- Archivo original.
- Miniatura.
- Texto alternativo.
- Fecha y responsable.

Ofrecer carga básica opcional de imágenes. El Editor puede adjuntar imágenes a sus propios borradores; el Administrador gestiona y aprueba las fotografías de registros confirmados.

Las fotos deben vincularse al identificador estable del SKU. Cambiar nombre o categoría no debe romper esa relación.

Las imágenes promocionales adjuntas sirven como referencia. Algunas muestran varios artículos: no asumir que cada imagen corresponde a un único SKU ni deducir medidas, materiales, costos o existencias como datos reales.

Preparar campos opcionales para futuro ecommerce: nombre comercial, descripción comercial, slug y estado de preparación. Toda publicación debe quedar desactivada inicialmente.

La tienda, carrito, pagos y sincronización comercial corresponden a una etapa posterior.

10. INFORMES Y DESCARGAS

Crear un apartado exclusivo del Administrador.

Permitir exportar en CSV UTF-8 y XLSX:
- Catálogo completo.
- Resultado de filtros.
- Inventario por ubicación.
- Productos pendientes de conteo.
- Productos pendientes de fotografía.
- Productos con datos incompletos.

El catálogo debe tener una fila por SKU e incluir:
- Identificador estable y SKU.
- Producto y variante.
- Categorías en columnas por nivel.
- Atributos y medidas con sus unidades.
- Cantidad total y unidad base.
- Estado del conteo.
- Costos y moneda cuando se soliciten.
- Estados de revisión y fotografía.
- Referencias de imágenes.
- URL del QR.
- Responsable y fechas.

El informe por ubicación debe tener una fila por SKU y ubicación, sin duplicar ni inflar los totales del catálogo.

Las descargas deben incluir todos los resultados seleccionados, no únicamente la página visible.

Permitir exportar sin costos. No incluir datos de autenticación ni información interna de seguridad.

11. DASHBOARD

Mostrar indicadores útiles para el levantamiento:
- SKU registrados.
- SKU pendientes de revisión.
- Pendientes de conteo.
- Pendientes de fotografía.
- Capturas de hoy.
- Avance por categoría.
- Meta editable, inicialmente 5,000 SKU.

Separar el número de SKU de las cantidades físicas. No sumar piezas y metros en un único indicador de “unidades”.

El Administrador también puede consultar:
- Costos pendientes.
- Valor estimado de existencias con costo y conteo conocidos.
- Cobertura de esa valoración.
- Actividad por capturista.

No presentar una valoración parcial como valor completo del inventario.

El Editor ve indicadores operativos autorizados, sin información económica.

12. DISEÑO Y EXPERIENCIA

Usa la captura de interfaz adjunta como inspiración visual.

Dirección:
- Fondo gris claro con matices azulados.
- Tarjetas blancas y azul suave.
- Contenedores redondeados.
- Navegación compacta tipo cápsula.
- Acentos verde lima en acciones principales.
- Grafito en algunos paneles.
- Tipografía sans serif legible.
- Espaciado generoso y jerarquía clara.
- Fotografías de producto como miniaturas útiles.

Mantén suficiente contraste, etiquetas visibles y estados comprensibles sin depender únicamente del color.

Adapta la referencia a un inventario. Prioriza formularios y tablas fáciles de usar, con acciones principales siempre accesibles.

Navegación:
- Inicio.
- Capturar SKU.
- Inventario.
- Pendientes de fotografía.
- Categorías y ubicaciones: Administrador.
- Informes: Administrador.
- Usuarios y configuración: Administrador.

La aplicación debe funcionar en computadora, tablet y celular.

En móvil:
- Formularios de una columna.
- Botones cómodos.
- Barra de guardado accesible.
- Consulta mediante tarjetas.
- Acceso a cámara para QR y fotografías.

Incluir estados vacíos, carga, error y éxito con instrucciones claras en español.

13. BASE TÉCNICA Y DATOS DEMOSTRATIVOS

Usa el backend compatible con el proyecto de Lovable para autenticación, base relacional y almacenamiento de imágenes.

Modela al menos:
Usuarios y roles, categorías jerárquicas, tipos, atributos, productos, variantes/SKU, ubicaciones, conteos iniciales, movimientos de ajuste, costos privados, imágenes e historial.

Aplicar integridad referencial, validaciones en servidor, control de concurrencia y permisos de acceso.

Registrar quién creó o modificó información relevante. Mantener protegido cualquier historial relacionado con costos.

Crear aproximadamente 30 SKU ficticios variados que demuestren:
- Diferentes categorías y profundidades.
- Un producto con varias medidas o colores.
- Un SKU en varias ubicaciones.
- Inventario en piezas y metros.
- Datos pendientes.
- Productos sin fotografía.
- Productos con existencia cero.

Marcar el entorno y los datos como demostración. Mantenerlos separados de los datos reales y permitir retirar únicamente los registros demostrativos y sus dependencias.

Todas las medidas, cantidades y costos de muestra deben identificarse como ficticios.

No utilizar almacenamiento local del navegador como base definitiva. Puede utilizarse para recuperar un borrador, pero el registro confirmado debe persistir en el servidor.

14. CRITERIOS DE ACEPTACIÓN

Verifica que:
1. Dos usuarios puedan capturar simultáneamente sin repetir SKU.
2. Un doble clic o reintento no duplique productos ni conteos.
3. Un Editor pueda registrar un SKU sin conocer el costo.
4. Un Editor no pueda obtener costos ni exportar mediante accesos directos.
5. Un cambio de categoría no altere el SKU, QR o fotografías.
6. Un mismo modelo con dos anchos genere variantes distintas.
7. El mismo SKU en otra ubicación no se duplique.
8. Un segundo conteo de la misma ubicación no se sume automáticamente.
9. Las conversiones entre rollos y metros requieran un factor conocido.
10. “Pendiente de conteo” se distinga de existencia cero.
11. Los QR impresos abran la ficha correcta y exijan autenticación.
12. Las exportaciones incluyan todos los registros filtrados.
13. El catálogo pueda buscarse y filtrarse con 5,000 registros.
14. La captura principal funcione desde un celular.
15. Los datos persistan al cerrar sesión y volver a entrar.

ORDEN DE IMPLEMENTACIÓN

Trabaja por bloques y verifica cada uno antes de avanzar:

A. Modelo de datos, autenticación, permisos, categorías y estructura visual.
B. Captura rápida, variantes, conteos y consulta del inventario.
C. QR, etiquetas, informes y dashboard.
D. Ubicaciones, carga básica de fotografías y preparación para ecommerce.

Antes de implementar, resume la arquitectura y las decisiones principales. Después comienza por el bloque A.

Conserva esta especificación como referencia del proyecto. Al finalizar cada bloque, indica qué funciona, qué pruebas realizaste y qué falta.

Si alguna función necesita configuración externa, indícala con precisión. No presentes botones sin funcionamiento ni datos simulados como funcionalidades terminadas.