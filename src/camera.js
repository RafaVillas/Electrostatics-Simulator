const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

function validateBounds(bounds, { allowZeroSpan = false } = {}) {
  const invalidX = allowZeroSpan
    ? bounds?.xmin > bounds?.xmax
    : bounds?.xmin >= bounds?.xmax;
  const invalidY = allowZeroSpan
    ? bounds?.ymin > bounds?.ymax
    : bounds?.ymin >= bounds?.ymax;
  if (
    !bounds ||
    !Number.isFinite(bounds.xmin) ||
    !Number.isFinite(bounds.xmax) ||
    !Number.isFinite(bounds.ymin) ||
    !Number.isFinite(bounds.ymax) ||
    invalidX ||
    invalidY
  ) {
    throw new TypeError("Camera bounds must describe a finite area");
  }
}

export class Camera2D {
  constructor({
    bounds,
    x = 0,
    y = 0,
    zoom = 200,
    minZoom = 24,
    maxZoom = 900,
  }) {
    validateBounds(bounds);
    if (!(minZoom > 0) || maxZoom < minZoom) {
      throw new RangeError("Camera zoom limits are invalid");
    }

    this.bounds = { ...bounds };
    this.defaultState = { x, y, zoom: clamp(zoom, minZoom, maxZoom) };
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.width = 1;
    this.height = 1;
    this.x = x;
    this.y = y;
    this.zoom = this.defaultState.zoom;
    this.constrain();
  }

  setViewport(width, height) {
    if (!(width > 0) || !(height > 0)) {
      throw new RangeError("Camera viewport dimensions must be positive");
    }
    this.width = width;
    this.height = height;
    this.constrain();
    return this;
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.x) * this.zoom + this.width / 2,
      y: (this.y - y) * this.zoom + this.height / 2,
    };
  }

  screenToWorld(pixelX, pixelY) {
    return {
      x: this.x + (pixelX - this.width / 2) / this.zoom,
      y: this.y - (pixelY - this.height / 2) / this.zoom,
    };
  }

  getVisibleBounds() {
    const halfWidth = this.width / (2 * this.zoom);
    const halfHeight = this.height / (2 * this.zoom);
    return {
      xmin: this.x - halfWidth,
      xmax: this.x + halfWidth,
      ymin: this.y - halfHeight,
      ymax: this.y + halfHeight,
    };
  }

  getVisibleWorldBounds() {
    const visible = this.getVisibleBounds();
    return {
      xmin: Math.max(visible.xmin, this.bounds.xmin),
      xmax: Math.min(visible.xmax, this.bounds.xmax),
      ymin: Math.max(visible.ymin, this.bounds.ymin),
      ymax: Math.min(visible.ymax, this.bounds.ymax),
    };
  }

  setCenter(x, y) {
    this.x = x;
    this.y = y;
    this.constrain();
    return this;
  }

  panByPixels(deltaX, deltaY) {
    this.x -= deltaX / this.zoom;
    this.y += deltaY / this.zoom;
    this.constrain();
    return this;
  }

  zoomAt(pixelX, pixelY, requestedZoom) {
    const anchor = this.screenToWorld(pixelX, pixelY);
    this.zoom = clamp(requestedZoom, this.minZoom, this.maxZoom);
    this.x = anchor.x - (pixelX - this.width / 2) / this.zoom;
    this.y = anchor.y + (pixelY - this.height / 2) / this.zoom;
    this.constrain();
    return this.zoom;
  }

  reset() {
    this.x = this.defaultState.x;
    this.y = this.defaultState.y;
    this.zoom = this.defaultState.zoom;
    this.constrain();
    return this;
  }

  fitBounds(target, { padding = 48, minimumSpan = 0.8 } = {}) {
    validateBounds(target, { allowZeroSpan: true });
    const safePadding = clamp(
      padding,
      0,
      Math.max(0, Math.min(this.width, this.height) / 2 - 1),
    );
    const availableWidth = Math.max(1, this.width - safePadding * 2);
    const availableHeight = Math.max(1, this.height - safePadding * 2);
    const spanX = Math.max(target.xmax - target.xmin, minimumSpan);
    const spanY = Math.max(target.ymax - target.ymin, minimumSpan);

    this.zoom = clamp(
      Math.min(availableWidth / spanX, availableHeight / spanY),
      this.minZoom,
      this.maxZoom,
    );
    this.x = (target.xmin + target.xmax) / 2;
    this.y = (target.ymin + target.ymax) / 2;
    this.constrain();
    return this;
  }

  constrain() {
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.x = this.constrainAxis(
      this.x,
      this.bounds.xmin,
      this.bounds.xmax,
      this.width / (2 * this.zoom),
    );
    this.y = this.constrainAxis(
      this.y,
      this.bounds.ymin,
      this.bounds.ymax,
      this.height / (2 * this.zoom),
    );
  }

  constrainAxis(value, minimum, maximum, halfViewport) {
    const center = (minimum + maximum) / 2;
    const halfWorld = (maximum - minimum) / 2;
    if (halfViewport >= halfWorld) return center;
    return clamp(value, minimum + halfViewport, maximum - halfViewport);
  }
}
