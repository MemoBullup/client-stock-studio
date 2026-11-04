# Aly · Inventario — Arquitectura y decisiones

Especificación completa del cliente: [`docs/especificacion.md`](./especificacion.md).

## Pila
- **Interfaz**: TanStack Start (React 19) + Tailwind v4. Todo en español, formato es-MX, moneda configurable (MXN).
- **Servidor y datos**: Lovable Cloud (PostgreSQL, autenticación y almacenamiento de archivos).
- **Permisos**: se aplican en la base de datos (políticas por fila y funciones del servidor), no solo en la interfaz.

## Entidades
| Entidad | Tabla | Notas |
|---|---|---|
| Producto / modelo | `products` | Agrupa variantes. Categoría comercial (`category_id`, nula = «Por clasificar») y tipo de producto. No guarda existencias. |
| Variante inventariable (SKU) | `variants` | ID interno estable (`id`, UUID) + `sku` legible. Estados separados: registro, revisión, fotografía. Unidad base explícita. |
| Atributos | `attributes`, `product_type_attributes`, `variant_attribute_values` | Texto, número, selección, selección múltiple. Por tipo: obligatorio / define variante. Valor real, «No aplica» o «Dato pendiente». |
| Existencia | `stock_levels` | Cantidad por variante y ubicación (≥ 0). Sin fila = pendiente de conteo; fila con 0 = contado sin existencias. |
| Conteo inicial | `stock_counts` + `inventory_sessions` | Un solo conteo confirmado por SKU + ubicación + sesión. Un segundo intento queda «en revisión», nunca se suma. |
| Niveles mínimos | `stock_minimums` | Mínimo por SKU y ubicación, en la unidad base. Lo define el Administrador; todos ven las alertas. Alerta = existencia contada menor al mínimo; sin conteo = pendiente (no alerta). |
| Ajustes | `stock_adjustments`, `stock_adjustment_requests` | Solo el Administrador aplica, con motivo e historial; requiere conteo previo y nunca deja negativos. El Editor envía solicitudes (pueden venir del asistente de IA) que el Administrador aprueba o rechaza. |
| Costos privados | `variant_costs`, `cost_history` | Tabla separada, accesible solo para Administrador. Sin fila = costo pendiente (nunca 0). |
| Imágenes | `variant_images` | Varias por SKU, principal, orden, miniatura, texto alternativo. Ligadas al ID estable. |
| Categorías / ubicaciones | `categories`, `locations` | Árboles editables. El servidor impide ciclos y limita niveles (categorías: configurable, 4 por defecto). |
| Historial | `audit_log` | Registro automático de cambios (sin costos). Solo Administrador. |
| Configuración | `app_settings` | Nombre, logotipo, moneda, prefijo de SKU, URL base de QR, meta, tamaño de etiqueta. |

## SKU
- Se genera en el servidor al confirmar el registro (`draft → registered`), con una secuencia de PostgreSQL: única, sin colisiones con altas simultáneas y sin reutilizar números (ni de archivados).
- Formato `PREFIJO + consecutivo` (ej. `ALY-000001`). El prefijo aplica a nuevas altas.
- No contiene categoría, ubicación ni precio, y nunca cambia (un disparador lo bloquea).

## Roles
- **Administrador** y **Editor** (tabla `user_roles`, un rol por persona). Nadie puede asignarse su rol.
- Cuentas autorizadas: el registro público está desactivado; el Administrador crea las cuentas desde «Usuarios y configuración».
- Una cuenta sin rol o desactivada ve «Cuenta pendiente de autorización» y no puede leer datos.
- El Editor no puede leer `variant_costs`, `cost_history`, `audit_log` ni `stock_adjustments`; no puede editar registros confirmados, archivar, validar ni aprobar fotografías (lo impide la base de datos).

## Procedimiento seguro para crear al primer Administrador
1. En Lovable: **Cloud → Users → Add user** y crea la cuenta con correo y contraseña (queda confirmada).
2. Desde la base de datos (lo hace el equipo técnico; no existe forma de hacerlo desde la app):
   ```sql
   select public.bootstrap_first_admin('correo@ejemplo.com');
   ```
   La función solo funciona si todavía no existe ningún Administrador y no puede ejecutarse desde el navegador.
3. Ese Administrador crea el resto de las cuentas y asigna roles desde la aplicación. Siempre debe quedar al menos un Administrador activo.

## QR y dominio
Los QR usarán la URL base configurada (`app_settings.qr_base_url`) + el ID interno de la variante. Las etiquetas definitivas deben imprimirse con el dominio de producción, no con enlaces de vista previa.

## Datos demostrativos
Categorías y ubicaciones de ejemplo llevan `is_demo = true` y se muestran con la etiqueta DEMO. Los 30 SKU ficticios (prefijo DEMO-) ya están cargados. Todas las tablas operativas tienen `is_demo` para poder retirar solo lo demostrativo.

## Bloque B · Captura, variantes, conteos e inventario
- **Capturar SKU** (`/capturar`): búsqueda previa, producto existente o nuevo, campos según el tipo, categoría con selectores por nivel («Por clasificar» permitido), características comunes y una fila por variante (o tabla de combinaciones donde solo se crean las marcadas), unidad base, presentación con contenido conocido o desconocido, ubicación, resumen y guardado. Todo se guarda en una sola operación del servidor (`save_capture`) con claves de guardado: un doble clic o reintento no duplica nada. El SKU se asigna al confirmar.
- **Duplicados**: si todos los atributos que distinguen variantes están respondidos y coinciden con otra variante del mismo producto, el servidor lo bloquea. Si solo coinciden los datos capturados, la pantalla avisa con enlace al registro.
- **Conteos**: rollos completos + sueltos solo con factor conocido; «Pendiente de conteo» ≠ 0. Un segundo conteo del mismo SKU en la misma ubicación queda «en revisión» y el Administrador decide en «Revisiones» cuál conservar (nunca se suman). Contar en otra ubicación no crea SKU.
- **Inventario** (`/inventario`): tabla o tarjetas, búsqueda sin acentos y filtros combinables en el servidor, paginación de 25. Costos solo para Administrador.
- **Ficha** (`/inventario/:id`): existencias por ubicación y total, características con «Dato pendiente»/«No aplica», otras variantes, historial de conteos/ajustes/correcciones; acciones según rol (registrar conteo, variante del mismo modelo, duplicar como plantilla, solicitar corrección; el Administrador valida, archiva, ajusta con motivo y captura el costo).
- El QR y las etiquetas corresponden al bloque C.

## Ajustes asistidos con IA
Retirados de la interfaz a petición del cliente (2026-11-03). Las funciones de ajuste del Administrador se conservan y se usan desde la ficha del SKU.

## Asistente de inventario
Chat en lenguaje natural para Administradores y Editores. Una conversación por persona, guardada en la base de datos. El modelo consulta datos actuales mediante herramientas de solo lectura (resumen, búsqueda de SKU, existencias por SKU y por ubicación, alertas y mínimos, ubicaciones, pendientes de conteo) que usan los permisos de quien pregunta. No ve costos ni puede modificar el inventario.

## Accesos y datos de demostración
- Cuentas demo: `admin.demo@example.com` (Administrador) y `editor.demo@example.com` (Editor). Desactívalas desde «Usuarios y configuración» antes de trabajar con datos reales.
- 30 SKU ficticios con prefijo `DEMO-`, marcados `is_demo`; los SKU reales empiezan en `ALY-000001`.
