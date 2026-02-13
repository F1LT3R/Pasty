import {
  getLayers,
  getSelectedLayer,
  getSelectedLayerId,
  updateLayer,
  removeLayer,
  reorderLayer,
  selectLayer,
  pushUndo,
  saveState,
  on,
  getImageSync,
} from './state.js';

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-darker',
  'plus-lighter',
];

class PastyPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._dragLayerId = null;
    this._dropIndex = null;
  }

  connectedCallback() {
    this._buildShadowDOM();
    this._setupStateListeners();
    this.renderPanel();
  }

  disconnectedCallback() {
    if (this._unsubStateChanged) this._unsubStateChanged();
    if (this._unsubLayerSelected) this._unsubLayerSelected();
  }

  _buildShadowDOM() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex; flex-direction: column;
          height: 100vh; background: #1e1e1e; color: #ddd;
          font-family: system-ui, sans-serif; font-size: 12px;
          border-left: 1px solid #333;
        }
        .panel-header { padding: 12px; font-size: 14px; font-weight: 600; border-bottom: 1px solid #333; flex-shrink: 0; }
        .layer-list { flex: 1; overflow-y: auto; }
        .layer-row { padding: 8px; border-bottom: 1px solid #2a2a2a; cursor: pointer; transition: background 0.1s; }
        .layer-row:hover { background: #2a2a2a; }
        .layer-row.selected { background: #1a3a5c; }
        .layer-row.locked { opacity: 0.6; }
        .layer-row.dragging { opacity: 0.4; }
        .row-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .row-bottom { display: flex; align-items: center; gap: 6px; }
        .icon-btn { background: none; border: none; color: #ddd; cursor: pointer; padding: 2px; font-size: 16px; line-height: 1; min-width: 20px; text-align: center; }
        .icon-btn:hover { color: #fff; }
        .icon-btn.dimmed { opacity: 0.3; }
        .icon-btn.disabled { opacity: 0.3; cursor: not-allowed; }
        .thumbnail { width: 40px; height: 40px; object-fit: contain; border-radius: 2px; background: #333; flex-shrink: 0; }
        .layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 4px; border-radius: 2px; }
        .layer-name:focus { background: #333; outline: 1px solid #4a90d9; }
        .blend-select { background: #333; color: #ddd; border: 1px solid #444; border-radius: 3px; padding: 2px 4px; font-size: 11px; max-width: 90px; }
        .opacity-slider { flex: 1; height: 4px; accent-color: #4a90d9; }
        .opacity-label { font-size: 10px; color: #888; min-width: 30px; text-align: right; }
        .drop-indicator { height: 2px; background: #4a90d9; margin: 0 8px; }
      </style>
      <div class="panel-header">Layers</div>
      <div class="layer-list"></div>
      <pasty-export></pasty-export>
    `;

    this._layerList = this.shadowRoot.querySelector('.layer-list');
    this._layerList.addEventListener('dragover', (e) => {
      if (this._dragLayerId && !e.target.closest('.layer-row')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this._dropIndex !== 0) {
          this._dropIndex = 0;
          this.renderPanel();
        }
      }
    });
  }

  _setupStateListeners() {
    this._stateChangedHandler = () => this.renderPanel();
    this._layerSelectedHandler = () => this.renderPanel();
    on('state-changed', this._stateChangedHandler);
    on('layer-selected', this._layerSelectedHandler);
  }

  renderPanel() {
    const layerList = this._layerList;
    if (!layerList) return;

    layerList.innerHTML = '';
    const layers = getLayers();
    const selectedId = getSelectedLayerId();
    const n = layers.length;

    // Reverse order: top layer first in panel
    const reversed = [...layers].reverse();

    for (let displayIdx = 0; displayIdx < reversed.length; displayIdx++) {
      const layer = reversed[displayIdx];
      const arrayIdx = n - 1 - displayIdx;

      // Drop indicator above this row (when dragging) - skip when dropping at very bottom (arrayIdx 0)
      if (this._dragLayerId !== null && this._dropIndex === arrayIdx && arrayIdx > 0) {
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        layerList.appendChild(indicator);
      }

      const row = document.createElement('div');
      row.className = 'layer-row';
      if (layer.id === selectedId) row.classList.add('selected');
      if (layer.locked) row.classList.add('locked');
      if (layer.id === this._dragLayerId) row.classList.add('dragging');
      row.draggable = true;
      row.dataset.layerId = layer.id;

      // Row click -> select
      row.addEventListener('click', (e) => {
        if (e.target.closest('.icon-btn') || e.target.closest('.blend-select') || e.target.closest('.opacity-slider') || e.target.closest('.layer-name')) return;
        selectLayer(layer.id);
      });

      // Drag handlers
      row.addEventListener('dragstart', (e) => this._onDragStart(e, layer.id));
      row.addEventListener('dragover', (e) => this._onDragOver(e, row, arrayIdx));
      row.addEventListener('drop', (e) => this._onDrop(e));
      row.addEventListener('dragend', () => this._onDragEnd());

      // Row top
      const rowTop = document.createElement('div');
      rowTop.className = 'row-top';

      // Eye (visibility)
      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'icon-btn' + (layer.visible ? '' : ' dimmed');
      eyeBtn.innerHTML = layer.visible ? '👁' : '👁‍🗨';
      eyeBtn.title = layer.visible ? 'Hide' : 'Show';
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndo();
        updateLayer(layer.id, { visible: !layer.visible });
        saveState();
      });
      rowTop.appendChild(eyeBtn);

      // Lock
      const lockBtn = document.createElement('button');
      lockBtn.className = 'icon-btn' + (layer.locked ? '' : ' dimmed');
      lockBtn.innerHTML = layer.locked ? '🔒' : '🔓';
      lockBtn.title = layer.locked ? 'Unlock' : 'Lock';
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndo();
        updateLayer(layer.id, { locked: !layer.locked });
        saveState();
      });
      rowTop.appendChild(lockBtn);

      // Thumbnail
      const thumb = document.createElement('img');
      thumb.className = 'thumbnail';
      thumb.src = getImageSync(layer.imageId) || '';
      thumb.alt = layer.name;
      rowTop.appendChild(thumb);

      // Name (contenteditable on dblclick)
      const nameEl = document.createElement('span');
      nameEl.className = 'layer-name';
      nameEl.textContent = layer.name;
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        nameEl.contentEditable = 'true';
        nameEl.focus();
      });
      nameEl.addEventListener('blur', () => {
        nameEl.contentEditable = 'false';
        const newName = nameEl.textContent.trim();
        if (newName && newName !== layer.name) {
          pushUndo();
          updateLayer(layer.id, { name: newName });
          saveState();
        } else {
          nameEl.textContent = layer.name;
        }
      });
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameEl.blur();
      });
      rowTop.appendChild(nameEl);

      // Blend select
      const blendSelect = document.createElement('select');
      blendSelect.className = 'blend-select';
      BLEND_MODES.forEach((mode) => {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode;
        if (layer.blendMode === mode) opt.selected = true;
        blendSelect.appendChild(opt);
      });
      blendSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        pushUndo();
        updateLayer(layer.id, { blendMode: blendSelect.value });
        saveState();
      });
      rowTop.appendChild(blendSelect);

      row.appendChild(rowTop);

      // Row bottom
      const rowBottom = document.createElement('div');
      rowBottom.className = 'row-bottom';

      // Opacity slider
      const opacitySlider = document.createElement('input');
      opacitySlider.type = 'range';
      opacitySlider.className = 'opacity-slider';
      opacitySlider.min = '0';
      opacitySlider.max = '100';
      opacitySlider.value = String(Math.round(layer.opacity * 100));
      opacitySlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = Number(opacitySlider.value) / 100;
        updateLayer(layer.id, { opacity: val });
      });
      opacitySlider.addEventListener('change', () => {
        pushUndo();
        saveState();
      });
      rowBottom.appendChild(opacitySlider);

      // Opacity label
      const opacityLabel = document.createElement('span');
      opacityLabel.className = 'opacity-label';
      opacityLabel.textContent = `${Math.round(layer.opacity * 100)}%`;
      opacitySlider.addEventListener('input', () => {
        opacityLabel.textContent = `${opacitySlider.value}%`;
      });
      rowBottom.appendChild(opacityLabel);

      // Delete
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn' + (layer.locked ? ' disabled' : '');
      deleteBtn.innerHTML = '🗑';
      deleteBtn.title = 'Delete';
      deleteBtn.disabled = layer.locked;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (layer.locked) return;
        pushUndo();
        removeLayer(layer.id);
        saveState();
      });
      rowBottom.appendChild(deleteBtn);

      row.appendChild(rowBottom);
      layerList.appendChild(row);
    }

    // Drop indicator at bottom (when dropping after last row)
    if (this._dragLayerId !== null && this._dropIndex === 0 && n > 0) {
      const indicator = document.createElement('div');
      indicator.className = 'drop-indicator';
      layerList.appendChild(indicator);
    }
  }

  _onDragStart(e, layerId) {
    this._dragLayerId = layerId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    e.dataTransfer.setDragImage(e.target, 0, 0);
    this.renderPanel();
  }

  _onDragOver(e, row, arrayIdx) {
    if (!this._dragLayerId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const layers = getLayers();
    const draggedIdx = layers.findIndex((l) => l.id === this._dragLayerId);
    if (draggedIdx === -1) return;

    const rect = row.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const inTopHalf = e.clientY < midY;

    let newIdx;
    if (inTopHalf) {
      newIdx = arrayIdx;
    } else {
      newIdx = arrayIdx > 0 ? arrayIdx - 1 : 0;
    }

    if (newIdx === draggedIdx) return;

    if (this._dropIndex !== newIdx) {
      this._dropIndex = newIdx;
      this.renderPanel();
    }
  }

  _onDrop(e) {
    e.preventDefault();
    if (!this._dragLayerId) return;
    const newIdx = this._dropIndex;
    if (newIdx !== null && newIdx >= 0) {
      pushUndo();
      reorderLayer(this._dragLayerId, newIdx);
      saveState();
    }
    this._dragLayerId = null;
    this._dropIndex = null;
    this.renderPanel();
  }

  _onDragEnd() {
    this._dragLayerId = null;
    this._dropIndex = null;
    this.renderPanel();
  }
}

customElements.define('pasty-panel', PastyPanel);
