# Simulador de electrostática 2D

Aplicación web interactiva para construir configuraciones de carga y explorar su campo eléctrico, potencial y efecto sobre partículas de prueba. El simulador funciona por completo en el navegador y usa un canvas 2D para representar un mundo físico de `−10 m` a `10 m` en ambos ejes.

## Funciones principales

- Cargas puntuales positivas y negativas.
- Distribuciones lineales y superficiales con densidad, dimensiones y ángulo editables.
- Visualización independiente de vectores de campo, líneas de campo, mapa de potencial, curvas equipotenciales, grilla y ejes.
- Partículas de prueba con relación `q/m`, velocidad de simulación, pausa y trazas de movimiento.
- Inspector para seleccionar, mover, editar o eliminar fuentes.
- Cámara 2D con zoom bajo el cursor, desplazamiento, minimapa, encuadre automático y retorno al origen.
- Lectura en tiempo real de posición, componentes de **E**, magnitud del campo y potencial **V** bajo el cursor.
- Configuraciones rápidas: dipolo, cargas iguales, líneas opuestas y placas paralelas.
- Muestreo adaptativo de vectores y potencial para mantener una densidad visual estable durante la navegación.

## Inicio rápido

### Requisitos

- Node.js `20.19` o superior, o `22.12` o superior.
- npm `10` o superior.

Clona el repositorio, instala las dependencias y levanta el servidor de desarrollo:

```bash
git clone https://github.com/RafaVillas/Electrostatics-Simulator.git
cd Electrostatics-Simulator
npm ci
npm run dev
```

Vite mostrará la URL local, normalmente `http://localhost:5173`. La aplicación usa módulos JavaScript nativos, por lo que debe abrirse desde el servidor de desarrollo y no directamente mediante `file://`.

## Uso

1. Elige una carga, distribución o partícula en la sección **Elementos**.
2. Haz clic derecho dentro del área física para colocarla. La herramienta permanece activa para poder crear varios elementos.
3. Usa <kbd>Ctrl</kbd> + clic sobre una fuente para seleccionarla y editar sus propiedades.
4. Activa o desactiva las capas de visualización en la sección **Campo**.
5. Mueve el cursor sobre el canvas para consultar el campo y el potencial en cualquier punto.

### Controles

| Acción | Control |
| --- | --- |
| Desplazar la vista | Arrastrar con el botón izquierdo |
| Seleccionar una fuente | <kbd>Ctrl</kbd> + clic izquierdo |
| Mover una fuente | <kbd>Ctrl</kbd> + arrastrar |
| Colocar el elemento activo | Clic derecho |
| Acercar o alejar | Rueda del ratón o botones `+` / `−` |
| Centrar desde el minimapa | Clic o arrastre sobre el minimapa |
| Cancelar la herramienta activa | <kbd>Esc</kbd> |
| Eliminar la fuente seleccionada | <kbd>Supr</kbd>, <kbd>Retroceso</kbd> o el botón del inspector |

Los botones sobre el canvas permiten volver a la vista inicial y encuadrar todas las fuentes existentes.

## Modelo físico

El campo y el potencial se calculan mediante superposición:

```text
E(r) = k Σ dq · R / |R|³
V(r) = k Σ dq / |R|
E = −∇V
k = 8.9875517923 × 10⁹ N·m²/C²
```

Las cargas puntuales se evalúan con la ley de Coulomb. Las distribuciones lineales y superficiales se aproximan mediante sumas de elementos discretos `dq`. Una pequeña región alrededor de cada muestra se omite para evitar la singularidad numérica en `r = 0`.

Las partículas son sondas ideales: obedecen `a = (q/m)E`, pero no aportan carga al sistema ni modifican el campo. La visualización es un corte 2D pensado con fines educativos; no sustituye un solucionador electrostático de alta precisión.

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el servidor de desarrollo de Vite. |
| `npm test` | Ejecuta las pruebas automatizadas con Node.js. |
| `npm run build` | Genera la versión de producción en `dist/`. |
| `npm run preview` | Sirve localmente el contenido generado. |
| `npm run check` | Ejecuta las pruebas y luego compila el proyecto. |

Antes de confirmar cambios se recomienda ejecutar:

```bash
npm run check
```

## Estructura del proyecto

```text
index.html                    Interfaz y controles de la aplicación
src/
├── main.js                   Estado, renderizado y coordinación de eventos
├── camera.js                 Cámara 2D, transformaciones, límites y encuadre
├── config.js                 Constantes físicas y límites del mundo
├── interaction.js            Intención del puntero y detección de fuentes
├── physics.js                Campo, potencial y discretización de fuentes
├── potential-grid.js         Grilla escalar y extracción de equipotenciales
├── property-controls.js      Normalización y formato de propiedades
├── vector-grid.js            Distribución adaptativa de vectores
└── styles.css                Presentación visual y diseño adaptable
test/                         Pruebas unitarias de los módulos anteriores
vite.config.js                Configuración de Vite
```

## Producción

```bash
npm run build
npm run preview
```

El contenido estático listo para publicar queda en `dist/`. `npm run preview` solo permite revisar localmente la compilación; no está pensado como servidor de producción.

## Autor

Creado por [Rafael Villaseñor Carrasco](https://github.com/RafaVillas).
