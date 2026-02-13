import {
  getLayers,
  getSelectedLayerId,
  addLayer,
  updateLayer,
  selectLayer,
  pushUndo,
  saveState,
  on,
  getViewBox,
  setViewBox,
  getZoomLevel,
  setZoom,
  getInitialDimensions,
  setInitialDimensions,
  storeImage,
  getImageSync,
} from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

class PastyCanvas extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._spaceDown = false;
    this._isPanning = false;
    this._dragLayerId = null;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._layerStartX = 0;
    this._layerStartY = 0;
    this._panStartX = 0;
    this._panStartY = 0;
    this._viewBoxStart = null;
    this._resizeTimeout = null;

    // Transform mode state (Alt+drag scale, Alt+R rotate)
    this._transformMode = null;  // 'scale' | 'scale-locked' | 'rotate' | null
    this._transformLayerId = null;
    this._transformStartX = 0;
    this._transformStartY = 0;
    this._layerStartW = 0;
    this._layerStartH = 0;
    this._layerStartRot = 0;
    this._rKeyDown = false;
  }

  get svgElement() {
    return this.shadowRoot?.querySelector('svg') ?? null;
  }

  connectedCallback() {
    this._buildShadowDOM();
    this._attachEventListeners();
    this._setupStateListeners();
    this.renderSVG();
  }

  disconnectedCallback() {
    if (this._boundPaste) document.removeEventListener('paste', this._boundPaste);
    if (this._boundKeyDown) document.removeEventListener('keydown', this._boundKeyDown);
    if (this._boundKeyUp) document.removeEventListener('keyup', this._boundKeyUp);
    if (this._boundResize) window.removeEventListener('resize', this._boundResize);
    if (this._boundMouseMove) document.removeEventListener('mousemove', this._boundMouseMove);
    if (this._boundMouseUp) document.removeEventListener('mouseup', this._boundMouseUp);
    if (this._stateChangedHandler) {
      document.removeEventListener('state-changed', this._stateChangedHandler);
      document.removeEventListener('layer-selected', this._stateChangedHandler);
    }
    if (this._zoomResetHandler) document.removeEventListener('zoom-reset', this._zoomResetHandler);
  }

  _buildShadowDOM() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; width: 100%; height: 100%; }
        .canvas-wrapper {
          width: 100%; height: 100%;
          background-color: #fff;
          background-image:
            linear-gradient(45deg, #ccc 25%, transparent 25%),
            linear-gradient(-45deg, #ccc 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #ccc 75%),
            linear-gradient(-45deg, transparent 75%, #ccc 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        }
        svg { display: block; width: 100%; height: 100%; }
        .paste-hint {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          color: #e33; font-size: 18px; font-weight: 600; pointer-events: none; text-align: center;
          text-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        .zoom-controls {
          position: absolute; bottom: 12px; left: 12px;
          display: flex; align-items: center; gap: 8px;
          background: rgba(0,0,0,0.6); color: #fff; padding: 4px 10px;
          border-radius: 4px; font-size: 12px;
        }
        .fit-zoom {
          background: none; border: 1px solid rgba(255,255,255,0.3);
          color: #fff; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
        }
        .fit-zoom:hover { background: rgba(255,255,255,0.15); }
      </style>
      <div class="canvas-wrapper">
        <svg xmlns="${SVG_NS}"></svg>
      </div>
      <div class="paste-hint">Paste an image (Ctrl+V) or drag & drop a file to get started</div>
      <div class="zoom-controls">
        <span class="zoom-level">100%</span>
        <button class="fit-zoom">Fit</button>
      </div>
    `;
  }

  _attachEventListeners() {
    const svg = this.svgElement;

    this._boundPaste = (e) => this._onPaste(e);
    this._boundKeyDown = (e) => this._onKeyDown(e);
    this._boundKeyUp = (e) => this._onKeyUp(e);
    this._boundResize = () => this._onResize();
    this._boundMouseMove = (e) => this._onMouseMove(e);
    this._boundMouseUp = (e) => this._onMouseUp(e);

    document.addEventListener('paste', this._boundPaste);
    document.addEventListener('keydown', this._boundKeyDown);
    document.addEventListener('keyup', this._boundKeyUp);
    window.addEventListener('resize', this._boundResize);

    // Drag-drop on SVG
    svg.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    svg.addEventListener('drop', (e) => this._onDrop(e));

    // Canvas drag (mouse)
    svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
    document.addEventListener('mousemove', this._boundMouseMove);
    document.addEventListener('mouseup', this._boundMouseUp);

    // Touch events
    svg.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    document.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    document.addEventListener('touchend', (e) => this._onTouchEnd(e));

    // Zoom (wheel)
    svg.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // Fit button
    this.shadowRoot.querySelector('.fit-zoom').addEventListener('click', () => this._resetZoom());
  }

  _setupStateListeners() {
    this._stateChangedHandler = () => this.renderSVG();
    this._zoomResetHandler = () => this._resetZoom();
    on('state-changed', this._stateChangedHandler);
    on('layer-selected', this._stateChangedHandler);
    on('zoom-reset', this._zoomResetHandler);
  }

  renderSVG() {
    const svg = this.svgElement;
    if (!svg) return;

    const vb = getViewBox();
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    svg.innerHTML = '';

    const layers = getLayers();
    const selectedId = getSelectedLayerId();
    const zoomLevel = getZoomLevel();
    const strokeWidth = Math.max(0.5, 2 / zoomLevel);

    for (const layer of layers) {
      if (!layer.visible) continue;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-layer-id', layer.id);
      g.setAttribute('opacity', String(layer.opacity));
      g.style.mixBlendMode = layer.blendMode || 'normal';
      g.style.display = layer.visible ? '' : 'none';
      if (layer.locked) g.style.pointerEvents = 'none';

      // Apply rotation around the layer's center
      const rot = layer.rotation || 0;
      if (rot !== 0) {
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        g.setAttribute('transform', `rotate(${rot}, ${cx}, ${cy})`);
      }

      const img = document.createElementNS(SVG_NS, 'image');
      const dataUrl = getImageSync(layer.imageId);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl || '');
      img.setAttribute('x', String(layer.x));
      img.setAttribute('y', String(layer.y));
      img.setAttribute('width', String(layer.width));
      img.setAttribute('height', String(layer.height));
      g.appendChild(img);

      if (layer.id === selectedId) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(layer.x));
        rect.setAttribute('y', String(layer.y));
        rect.setAttribute('width', String(layer.width));
        rect.setAttribute('height', String(layer.height));
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#4a90d9');
        rect.setAttribute('stroke-width', String(strokeWidth));
        rect.setAttribute('pointer-events', 'none');
        g.appendChild(rect);
      }

      svg.appendChild(g);
    }

    // Show/hide paste hint
    const pasteHint = this.shadowRoot.querySelector('.paste-hint');
    pasteHint.style.display = layers.length === 0 ? 'block' : 'none';

    // Update zoom text
    const zoomEl = this.shadowRoot.querySelector('.zoom-level');
    zoomEl.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  _clientToSvg(clientX, clientY) {
    const svg = this.svgElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vb = getViewBox();
    const x = vb.x + ((clientX - rect.left) / rect.width) * vb.w;
    const y = vb.y + ((clientY - rect.top) / rect.height) * vb.h;
    return { x, y };
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const item = Array.from(items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();

    const file = item.getAsFile();
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      const imageId = crypto.randomUUID();
      const img = new Image();
      img.src = base64;
      img.onload = async () => {
        await storeImage(imageId, base64);
        pushUndo();
        addLayer({
          id: crypto.randomUUID(),
          name: `Layer ${getLayers().length + 1}`,
          imageId,
          x: 0,
          y: 0,
          width: img.naturalWidth,
          height: img.naturalHeight,
          opacity: 1,
          visible: true,
          locked: false,
          blendMode: 'normal',
        });
        saveState();
      };
    };
    reader.readAsDataURL(file);
  }

  async _onDrop(e) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) return;

    const layers = getLayers();
    for (let i = 0; i < files.length; i++) {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(files[i]);
      });
      const imageId = crypto.randomUUID();
      const img = new Image();
      img.src = base64;
      await new Promise((res) => {
        img.onload = res;
      });
      await storeImage(imageId, base64);
      pushUndo();
      addLayer({
        id: crypto.randomUUID(),
        name: `Layer ${layers.length + i + 1}`,
        imageId,
        x: 0,
        y: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
        opacity: 1,
        visible: true,
        locked: false,
        blendMode: 'normal',
      });
    }
    saveState();
  }

  _onMouseDown(e) {
    if (this._spaceDown) return;
    const layerId = e.target.closest('[data-layer-id]')?.getAttribute('data-layer-id');
    if (!layerId) return;
    const layer = getLayers().find((l) => l.id === layerId);
    if (layer?.locked) return;

    selectLayer(layerId);

    // Alt held = transform mode (scale or rotate)
    if (e.altKey) {
      e.preventDefault();
      this._transformLayerId = layerId;
      this._transformStartX = e.clientX;
      this._transformStartY = e.clientY;
      this._layerStartW = layer.width;
      this._layerStartH = layer.height;
      this._layerStartRot = layer.rotation || 0;

      if (this._rKeyDown) {
        this._transformMode = 'rotate';
        this.style.cursor = 'crosshair';
      } else if (e.shiftKey) {
        this._transformMode = 'scale-locked';
        this.style.cursor = 'nesw-resize';
      } else {
        this._transformMode = 'scale';
        this.style.cursor = 'ew-resize';
      }
      return;
    }

    // Normal drag (move)
    const pt = this._clientToSvg(e.clientX, e.clientY);
    this._dragLayerId = layerId;
    this._dragStartX = pt.x;
    this._dragStartY = pt.y;
    this._layerStartX = layer.x;
    this._layerStartY = layer.y;
  }

  _onMouseMove(e) {
    // Pan mode (space + drag)
    if (this._spaceDown && (e.buttons & 1)) {
      if (!this._isPanning) {
        this._isPanning = true;
        this._panStartX = e.clientX;
        this._panStartY = e.clientY;
        this._viewBoxStart = getViewBox();
      }
      const vb = this._viewBoxStart;
      const dx = ((e.clientX - this._panStartX) / this.svgElement.getBoundingClientRect().width) * vb.w;
      const dy = ((e.clientY - this._panStartY) / this.svgElement.getBoundingClientRect().height) * vb.h;
      setViewBox({ x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h });
      this.renderSVG();
      return;
    }

    // Transform mode (Alt+drag scale or Alt+R rotate)
    if (this._transformMode && this._transformLayerId) {
      const dxPx = e.clientX - this._transformStartX;
      const dyPx = e.clientY - this._transformStartY;

      if (this._transformMode === 'scale') {
        // Horizontal delta scales width, vertical delta scales height
        const newW = Math.max(10, this._layerStartW + dxPx);
        const newH = Math.max(10, this._layerStartH + dyPx);
        updateLayer(this._transformLayerId, { width: newW, height: newH });
      } else if (this._transformMode === 'scale-locked') {
        // Horizontal delta scales both axes proportionally
        const ratio = this._layerStartH / this._layerStartW;
        const newW = Math.max(10, this._layerStartW + dxPx);
        const newH = Math.max(10, Math.round(newW * ratio));
        updateLayer(this._transformLayerId, { width: newW, height: newH });
      } else if (this._transformMode === 'rotate') {
        // Compute angle from layer center to mouse position
        const layer = getLayers().find((l) => l.id === this._transformLayerId);
        if (layer) {
          const svgPt = this._clientToSvg(e.clientX, e.clientY);
          const cx = layer.x + layer.width / 2;
          const cy = layer.y + layer.height / 2;
          const angle = Math.atan2(svgPt.y - cy, svgPt.x - cx) * (180 / Math.PI);
          updateLayer(this._transformLayerId, { rotation: Math.round(angle) });
        }
      }
      this.renderSVG();
      return;
    }

    // Normal drag (move layer)
    if (this._dragLayerId) {
      const pt = this._clientToSvg(e.clientX, e.clientY);
      const dx = pt.x - this._dragStartX;
      const dy = pt.y - this._dragStartY;
      updateLayer(this._dragLayerId, {
        x: this._layerStartX + dx,
        y: this._layerStartY + dy,
      });
      this.renderSVG();
    }
  }

  _onMouseUp(e) {
    if (this._isPanning) {
      this._isPanning = false;
      return;
    }
    // End transform mode
    if (this._transformMode && this._transformLayerId) {
      pushUndo();
      saveState();
      this._transformMode = null;
      this._transformLayerId = null;
      this.style.cursor = '';
      return;
    }
    // End normal drag
    if (this._dragLayerId) {
      pushUndo();
      saveState();
      this._dragLayerId = null;
    }
  }

  _onKeyDown(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      this._spaceDown = true;
      this.style.cursor = 'grab';
    }
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
      this._rKeyDown = true;
    }
  }

  _onKeyUp(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      this._spaceDown = false;
      this._isPanning = false;
      this.style.cursor = '';
    }
    if (e.code === 'KeyR') {
      this._rKeyDown = false;
    }
  }

  _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const layerId = e.target.closest('[data-layer-id]')?.getAttribute('data-layer-id');
    if (!layerId) return;
    const layer = getLayers().find((l) => l.id === layerId);
    if (layer?.locked) return;
    e.preventDefault();

    const rect = this.svgElement.getBoundingClientRect();
    const vb = getViewBox();
    const pt = {
      x: vb.x + ((touch.clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((touch.clientY - rect.top) / rect.height) * vb.h,
    };
    this._dragLayerId = layerId;
    this._dragStartX = pt.x;
    this._dragStartY = pt.y;
    this._layerStartX = layer.x;
    this._layerStartY = layer.y;
    this._touchStartClientX = touch.clientX;
    this._touchStartClientY = touch.clientY;
    selectLayer(layerId);
  }

  _onTouchMove(e) {
    if (e.touches.length !== 1 || !this._dragLayerId) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.svgElement.getBoundingClientRect();
    const vb = getViewBox();
    const pt = {
      x: vb.x + ((touch.clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((touch.clientY - rect.top) / rect.height) * vb.h,
    };
    const dx = pt.x - this._dragStartX;
    const dy = pt.y - this._dragStartY;
    updateLayer(this._dragLayerId, {
      x: this._layerStartX + dx,
      y: this._layerStartY + dy,
    });
    this.renderSVG();
  }

  _onTouchEnd(e) {
    if (this._dragLayerId && e.touches.length === 0) {
      pushUndo();
      saveState();
      this._dragLayerId = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const svg = this.svgElement;
    const rect = svg.getBoundingClientRect();
    const vb = getViewBox();
    const cursorX = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
    const cursorY = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;

    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    let newW = vb.w * factor;
    const initW = getInitialDimensions().w;
    const minW = initW / 10;   // 1000% max zoom
    const maxW = initW * 10;   // 10% min zoom
    newW = Math.max(minW, Math.min(maxW, newW));

    const scale = newW / vb.w;
    const newX = cursorX - (cursorX - vb.x) * scale;
    const newY = cursorY - (cursorY - vb.y) * scale;

    setViewBox({ x: newX, y: newY, w: newW, h: vb.h * (newW / vb.w) });
    setZoom(getInitialDimensions().w / newW);
    this.renderSVG();
  }

  _resetZoom() {
    const { w, h } = getInitialDimensions();
    setViewBox({ x: 0, y: 0, w, h });
    setZoom(1);
    this.renderSVG();
  }

  _onResize() {
    if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
    this._resizeTimeout = setTimeout(() => {
      const rect = this.svgElement?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const vb = getViewBox();
      const { w: initW, h: initH } = getInitialDimensions();
      const newW = vb.w * (rect.width / initW);
      const newH = vb.h * (rect.height / initH);
      setInitialDimensions(rect.width, rect.height);
      setViewBox({ x: vb.x, y: vb.y, w: newW, h: newH });
      setZoom(rect.width / newW);
      this.renderSVG();
      this._resizeTimeout = null;
    }, 100);
  }
}

customElements.define('pasty-canvas', PastyCanvas);
