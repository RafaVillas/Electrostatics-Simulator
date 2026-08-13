# Electrostatics Simulator

Simulador interactivo 2D de campos eléctricos, potencial eléctrico y partículas de prueba. La refactorización conserva el modelo y la interacción originales, pero separa la interfaz, los estilos y el cálculo físico para facilitar futuras extensiones.

El área física abarca de −10 m a 10 m en ambos ejes y se recorre mediante una cámara independiente: rueda para zoom bajo el cursor, botón central o <kbd>Espacio</kbd> + arrastre para desplazar la vista. Los controles sobre el canvas permiten volver al origen, encuadrar las fuentes y usar zoom sin rueda.

## Requisitos

- Node.js 20.19 o superior, o 22.12 o superior
- npm 10 o superior

## Desarrollo local

```bash
npm install
npm run dev
```

Vite mostrará la URL HTTP local, normalmente `http://localhost:5173`. Se recomienda este flujo en vez de abrir el HTML mediante `file://`, ya que la aplicación usa módulos JavaScript nativos.

## Comprobaciones

```bash
npm run test
npm run build
```

También pueden ejecutarse ambas con `npm run check`.

## Despliegue

```bash
npm run build
npm run preview
```

El contenido listo para producción queda en `dist/` y puede publicarse en cualquier hosting de archivos estáticos. `npm run preview` sirve únicamente para revisar localmente ese resultado; no es un servidor de producción.

## Estructura

```text
index.html            Entrada de la aplicación
src/main.js           Estado, render, controles e interacción
src/camera.js         Cámara 2D, transformaciones, límites y encuadre
src/physics.js        Modelo físico y discretización de fuentes
src/config.js         Constantes compartidas
src/styles.css        Presentación visual
test/camera.test.js   Pruebas de transformaciones y navegación
test/physics.test.js  Pruebas de regresión del núcleo físico
```
