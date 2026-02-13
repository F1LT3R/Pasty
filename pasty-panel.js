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
    this._isDraggingSlider = false;
    this._isDraggingLayer = false;
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
        .panel-header { padding: 12px; font-size: 14px; font-weight: 600; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
        .help-btn {
          background: none; border: 1px solid #555; color: #888; cursor: pointer;
          width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; padding: 0;
        }
        .help-btn:hover { color: #fff; border-color: #888; }
        .help-modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 9999;
          display: flex; align-items: center; justify-content: center;
        }
        .help-modal-box {
          background: #2a2a2a; color: #ddd; border-radius: 8px; padding: 20px;
          max-width: 520px; width: 90vw; max-height: 80vh; overflow-y: auto;
        }
        .help-modal-box h3 { font-size: 16px; font-weight: 600; margin: 0 0 12px 0; }
        .help-modal-box table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .help-modal-box th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #444; color: #888; font-weight: 600; }
        .help-modal-box td { padding: 5px 8px; border-bottom: 1px solid #333; }
        .help-modal-box td:first-child { white-space: nowrap; }
        .help-modal-box kbd {
          background: #444; border: 1px solid #555; border-radius: 3px;
          padding: 1px 5px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
        }
        .help-close-btn {
          margin-top: 12px; padding: 6px 16px; background: #444; color: #ddd;
          border: none; border-radius: 4px; cursor: pointer; font-size: 12px; float: right;
        }
        .help-close-btn:hover { background: #555; }
        .help-hidden { display: none; }
        .layer-list { flex: 1; overflow-y: auto; }
        .layer-row { padding: 8px; border-bottom: 1px solid #2a2a2a; cursor: pointer; transition: background 0.1s; }
        .layer-row:hover { background: #2a2a2a; }
        .layer-row.selected { background: #1a3a5c; }
        .layer-row.locked { opacity: 0.6; }
        .layer-row.dragging { opacity: 0.4; }
        .drag-handle { cursor: grab; color: #555; font-size: 14px; line-height: 1; user-select: none; padding: 0 2px; flex-shrink: 0; }
        .drag-handle:hover { color: #999; }
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
        .row-transform { display: flex; align-items: center; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
        .transform-label { font-size: 10px; color: #888; min-width: 14px; text-align: right; }
        .transform-input {
          width: 52px; background: #333; color: #ddd; border: 1px solid #444;
          border-radius: 3px; padding: 2px 4px; font-size: 11px; text-align: right;
        }
        .transform-input:focus { outline: 1px solid #4a90d9; border-color: #4a90d9; }
      </style>
      <div class="panel-header">
        <span>Layers</span>
        <button class="help-btn" title="Keyboard shortcuts">?</button>
      </div>
      <div class="layer-list"></div>
      <pasty-export></pasty-export>

      <div class="help-modal-backdrop help-hidden">
        <div class="help-modal-box">
          <h3>Keyboard &amp; Mouse Shortcuts</h3>
          <table>
            <tr><th>Shortcut</th><th>Action</th></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd></td><td>Paste image as new layer</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Z</kbd></td><td>Undo</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></td><td>Redo</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>0</kbd></td><td>Reset zoom</td></tr>
            <tr><td><kbd>Arrow keys</kbd></td><td>Nudge layer 1px</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>Arrow keys</kbd></td><td>Nudge layer 10px</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>\u2191</kbd>/<kbd>\u2193</kbd></td><td>Reorder layer z-index</td></tr>
            <tr><td><kbd>Delete</kbd> / <kbd>Backspace</kbd></td><td>Delete selected layer</td></tr>
            <tr><td><kbd>Space</kbd> + drag</td><td>Pan canvas</td></tr>
            <tr><td>Scroll wheel</td><td>Zoom in/out</td></tr>
            <tr><td><kbd>Alt</kbd> + drag</td><td>Scale width (horiz) / height (vert)</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>Shift</kbd> + drag</td><td>Scale proportionally</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>R</kbd> + drag</td><td>Rotate layer</td></tr>
            <tr><td>Double-click layer name</td><td>Rename layer</td></tr>
          </table>
          <button class="help-close-btn">Close</button>
        </div>
      </div>
    `;

    // Help modal handlers
    const helpModal = this.shadowRoot.querySelector('.help-modal-backdrop');
    this.shadowRoot.querySelector('.help-btn').addEventListener('click', () => {
      helpModal.classList.remove('help-hidden');
    });
    this.shadowRoot.querySelector('.help-close-btn').addEventListener('click', () => {
      helpModal.classList.add('help-hidden');
    });
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) helpModal.classList.add('help-hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !helpModal.classList.contains('help-hidden')) {
        helpModal.classList.add('help-hidden');
      }
    });

    this._layerList = this.shadowRoot.querySelector('.layer-list');
    this._layerList.addEventListener('dragover', (e) => {
      if (this._dragLayerId && !e.target.closest('.layer-row')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this._dropIndex !== 0) {
          this._dropIndex = 0;
          this._updateDropIndicator();
        }
      }
    });
  }

  _setupStateListeners() {
    this._stateChangedHandler = () => {
      if (this._isDraggingSlider || this._isDraggingLayer) return;
      this.renderPanel();
    };
    this._layerSelectedHandler = () => {
      if (this._isDraggingSlider || this._isDraggingLayer) return;
      this.renderPanel();
    };
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
      row.dataset.layerId = layer.id;

      // Row click -> select
      row.addEventListener('click', (e) => {
        if (e.target.closest('.icon-btn') || e.target.closest('.blend-select') || e.target.closest('.opacity-slider') || e.target.closest('.layer-name') || e.target.closest('.transform-input')) return;
        selectLayer(layer.id);
      });

      // Drag handlers — only initiate drag from the grip handle
      let dragFromHandle = false;
      row.addEventListener('dragstart', (e) => {
        if (!dragFromHandle) {
          e.preventDefault();
          return;
        }
        this._onDragStart(e, layer.id);
      });
      row.addEventListener('dragover', (e) => this._onDragOver(e, row, arrayIdx));
      row.addEventListener('drop', (e) => this._onDrop(e));
      row.addEventListener('dragend', () => {
        dragFromHandle = false;
        row.draggable = false;
        this._onDragEnd();
      });

      // Row top
      const rowTop = document.createElement('div');
      rowTop.className = 'row-top';

      // Drag handle (grip icon) — only this element enables row dragging
      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.innerHTML = '⠿';
      dragHandle.title = 'Drag to reorder';
      dragHandle.addEventListener('mousedown', () => {
        dragFromHandle = true;
        row.draggable = true;
      });
      document.addEventListener('mouseup', () => {
        dragFromHandle = false;
        row.draggable = false;
      }, { once: false });
      rowTop.appendChild(dragHandle);

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

      // Transform controls (selected layer only)
      if (layer.id === selectedId) {
        const rowTransform = document.createElement('div');
        rowTransform.className = 'row-transform';

        // Width
        const wLabel = document.createElement('span');
        wLabel.className = 'transform-label';
        wLabel.textContent = 'W';
        rowTransform.appendChild(wLabel);

        const wInput = document.createElement('input');
        wInput.type = 'number';
        wInput.className = 'transform-input';
        wInput.value = String(Math.round(layer.width));
        wInput.min = '1';
        wInput.addEventListener('change', (e) => {
          e.stopPropagation();
          const newW = Math.max(1, Number(wInput.value));
          pushUndo();
          updateLayer(layer.id, { width: newW });
          saveState();
        });
        rowTransform.appendChild(wInput);

        // Height
        const hLabel = document.createElement('span');
        hLabel.className = 'transform-label';
        hLabel.textContent = 'H';
        rowTransform.appendChild(hLabel);

        const hInput = document.createElement('input');
        hInput.type = 'number';
        hInput.className = 'transform-input';
        hInput.value = String(Math.round(layer.height));
        hInput.min = '1';
        hInput.addEventListener('change', (e) => {
          e.stopPropagation();
          const newH = Math.max(1, Number(hInput.value));
          pushUndo();
          updateLayer(layer.id, { height: newH });
          saveState();
        });
        rowTransform.appendChild(hInput);

        // Rotation
        const rLabel = document.createElement('span');
        rLabel.className = 'transform-label';
        rLabel.textContent = 'R';
        rowTransform.appendChild(rLabel);

        const rInput = document.createElement('input');
        rInput.type = 'number';
        rInput.className = 'transform-input';
        rInput.value = String(Math.round(layer.rotation || 0));
        rInput.addEventListener('change', (e) => {
          e.stopPropagation();
          pushUndo();
          updateLayer(layer.id, { rotation: Number(rInput.value) % 360 });
          saveState();
        });
        rowTransform.appendChild(rInput);

        const degLabel = document.createElement('span');
        degLabel.className = 'transform-label';
        degLabel.textContent = '\u00B0';
        rowTransform.appendChild(degLabel);

        row.appendChild(rowTransform);
      }

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

      // Opacity label
      const opacityLabel = document.createElement('span');
      opacityLabel.className = 'opacity-label';
      opacityLabel.textContent = `${Math.round(layer.opacity * 100)}%`;

      // Suppress re-renders while slider is being dragged
      opacitySlider.addEventListener('pointerdown', () => {
        this._isDraggingSlider = true;
      });
      const endSliderDrag = () => {
        this._isDraggingSlider = false;
      };
      opacitySlider.addEventListener('pointerup', endSliderDrag);
      opacitySlider.addEventListener('pointercancel', endSliderDrag);
      // Also listen on document in case pointer is released outside the slider
      opacitySlider.addEventListener('lostpointercapture', endSliderDrag);

      // Live preview: update label and layer opacity in real time (canvas renders via state-changed)
      opacitySlider.addEventListener('input', (e) => {
        e.stopPropagation();
        opacityLabel.textContent = `${opacitySlider.value}%`;
        // Update opacity live on canvas — no undo push, no save, just visual feedback
        updateLayer(layer.id, { opacity: Number(opacitySlider.value) / 100 });
      });
      // Commit on release: push undo, update state, save
      opacitySlider.addEventListener('change', (e) => {
        e.stopPropagation();
        this._isDraggingSlider = false;
        const val = Number(opacitySlider.value) / 100;
        pushUndo();
        updateLayer(layer.id, { opacity: val });
        saveState();
      });
      rowBottom.appendChild(opacitySlider);
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
    this._isDraggingLayer = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layerId);
    // Apply dragging style without rebuilding DOM
    const row = e.target.closest('.layer-row');
    if (row) row.classList.add('dragging');
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
      // Update drop indicator without full rebuild
      this._updateDropIndicator();
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
    this._isDraggingLayer = false;
    this.renderPanel();
  }

  _onDragEnd() {
    this._dragLayerId = null;
    this._dropIndex = null;
    this._isDraggingLayer = false;
    this.renderPanel();
  }

  /** Lightweight update: show/move drop indicator without rebuilding the layer list */
  _updateDropIndicator() {
    // Remove existing indicators
    this._layerList.querySelectorAll('.drop-indicator').forEach((el) => el.remove());

    if (this._dropIndex === null || this._dragLayerId === null) return;

    const layers = getLayers();
    const n = layers.length;
    const rows = this._layerList.querySelectorAll('.layer-row');

    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';

    if (this._dropIndex === 0 && n > 0) {
      // Drop at the very bottom
      this._layerList.appendChild(indicator);
    } else {
      // Find the row that corresponds to this arrayIdx
      // Panel is reversed: displayIdx = n - 1 - arrayIdx
      const displayIdx = n - 1 - this._dropIndex;
      if (displayIdx >= 0 && displayIdx < rows.length) {
        rows[displayIdx].before(indicator);
      }
    }
  }
}

customElements.define('pasty-panel', PastyPanel);
