// ============================================================================
// pasty-app.js — Root Web Component for Pasty
//
// <pasty-app> is the top-level shell that lays out <pasty-canvas> and
// <pasty-panel>, bootstraps persistent state from localStorage + IndexedDB,
// and handles global keyboard shortcuts.
// ============================================================================

import {
  loadState,
  getSelectedLayer,
  getSelectedLayerId,
  getLayers,
  updateLayer,
  removeLayer,
  reorderLayer,
  pushUndo,
  saveState,
  undo,
  redo,
  dispatch,
  on,
  getZoomLevel,
} from './state.js';

class PastyApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100vw;
          height: 100vh;
        }

        .app-layout {
          display: flex;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
        }

        pasty-canvas {
          flex: 1;
        }

        pasty-panel {
          width: 280px;
          flex-shrink: 0;
        }
      </style>
      <div class="app-layout">
        <pasty-canvas></pasty-canvas>
        <pasty-panel></pasty-panel>
      </div>
    `;
  }

  async connectedCallback() {
    // Bootstrap: load metadata from localStorage + images from IndexedDB
    await loadState();

    // Signal all components to render initial state
    dispatch('state-changed');

    // Install global keyboard dispatcher
    this._initKeyboard();
  }

  // -------------------------------------------------------------------------
  // Global keyboard shortcut dispatcher
  // -------------------------------------------------------------------------

  _initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isEditable =
        document.activeElement?.getAttribute('contenteditable') === 'true';
      const isTextInput = tag === 'input' || tag === 'textarea' || isEditable;

      const ctrl = e.ctrlKey || e.metaKey;

      // ── Undo / Redo (always available, even in text inputs) ───────
      if (ctrl && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        saveState();
        return;
      }

      if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        redo();
        saveState();
        return;
      }

      // All remaining shortcuts are suppressed when a text field is focused
      if (isTextInput) return;

      // ── Zoom reset: Ctrl+0 / Cmd+0 ───────────────────────────────
      if (ctrl && e.key === '0') {
        e.preventDefault();
        dispatch('zoom-reset');
        return;
      }

      // ── Arrow key nudge (move selected layer) ─────────────────────
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
        !e.altKey &&
        !ctrl
      ) {
        const layer = getSelectedLayer();
        if (!layer || layer.locked) return;

        e.preventDefault();

        const step = e.shiftKey ? 10 : 1;
        const zoom = getZoomLevel() || 1;
        const adjustedStep = step / zoom;

        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -adjustedStep;
        if (e.key === 'ArrowDown') dy = adjustedStep;
        if (e.key === 'ArrowLeft') dx = -adjustedStep;
        if (e.key === 'ArrowRight') dx = adjustedStep;

        pushUndo();
        updateLayer(layer.id, {
          x: layer.x + dx,
          y: layer.y + dy,
        });
        saveState();
        return;
      }

      // ── Alt+Arrow: reorder layer z-index ──────────────────────────
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const selectedId = getSelectedLayerId();
        if (!selectedId) return;

        e.preventDefault();

        const layers = getLayers();
        const idx = layers.findIndex((l) => l.id === selectedId);
        if (idx === -1) return;

        const newIdx =
          e.key === 'ArrowUp'
            ? Math.min(idx + 1, layers.length - 1)
            : Math.max(idx - 1, 0);

        if (newIdx !== idx) {
          pushUndo();
          reorderLayer(selectedId, newIdx);
          saveState();
        }
        return;
      }

      // ── Delete / Backspace: remove selected layer ─────────────────
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const layer = getSelectedLayer();
        if (!layer || layer.locked) return;

        e.preventDefault();
        pushUndo();
        removeLayer(layer.id);
        saveState();
        return;
      }
    });
  }
}

customElements.define('pasty-app', PastyApp);
