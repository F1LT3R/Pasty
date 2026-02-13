import {
  getLayers,
  getViewBox,
  exportProject,
  importProject,
  saveState,
  dispatch,
} from './state.js';

class PastyExport extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._buildShadowDOM();
    this._attachHandlers();
  }

  _buildShadowDOM() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 12px; border-top: 1px solid #333; flex-shrink: 0; }
        h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 8px 0; font-weight: 600; }
        .checkbox-row { display: flex; gap: 16px; margin-bottom: 10px; }
        label { color: #ddd; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
        input[type="checkbox"] { accent-color: #4a90d9; }
        .btn {
          width: 100%; padding: 8px; border: none; border-radius: 4px;
          cursor: pointer; font-size: 12px; font-weight: 500; margin-bottom: 6px;
        }
        .btn-primary { background: #3a7bd5; color: white; }
        .btn-primary:hover { background: #4a8be5; }
        .btn-secondary { background: #444; color: #ddd; }
        .btn-secondary:hover { background: #555; }
        .btn-row { display: flex; gap: 6px; }
        .btn-row .btn { flex: 1; }

        /* Modal styles */
        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 9999;
          display: flex; align-items: center; justify-content: center;
        }
        .modal-box {
          background: #2a2a2a; color: #ddd; border-radius: 8px; padding: 20px;
          max-width: 600px; width: 90vw; max-height: 80vh; display: flex;
          flex-direction: column; gap: 12px;
        }
        .modal-title { font-size: 16px; font-weight: 600; margin: 0; }
        .modal-textarea {
          flex: 1; min-height: 300px; resize: vertical;
          background: #1e1e1e; color: #ccc; border: 1px solid #444; border-radius: 4px;
          padding: 10px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
          line-height: 1.4; white-space: pre; overflow: auto;
        }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .modal-actions .btn { width: auto; padding: 8px 16px; }
        .hidden { display: none; }
      </style>

      <h3>Export</h3>
      <div class="checkbox-row">
        <label><input type="checkbox" class="export-svg" checked> SVG</label>
        <label><input type="checkbox" class="export-png" checked> PNG</label>
      </div>
      <button class="btn btn-primary export-btn">Export Image</button>

      <h3 style="margin-top: 12px;">Project</h3>
      <div class="btn-row">
        <button class="btn btn-secondary save-project-btn">Save</button>
        <button class="btn btn-secondary load-project-btn">Load</button>
      </div>

      <!-- Save Modal (hidden by default) -->
      <div class="modal-backdrop save-modal hidden">
        <div class="modal-box">
          <h3 class="modal-title">Save Project</h3>
          <textarea class="modal-textarea save-textarea" readonly></textarea>
          <div class="modal-actions">
            <button class="btn btn-primary copy-btn">Copy to Clipboard</button>
            <button class="btn btn-secondary close-save-btn">Close</button>
          </div>
        </div>
      </div>

      <!-- Load Modal (hidden by default) -->
      <div class="modal-backdrop load-modal hidden">
        <div class="modal-box">
          <h3 class="modal-title">Load Project</h3>
          <textarea class="modal-textarea load-textarea" placeholder="Paste your project JSON here..."></textarea>
          <div class="modal-actions">
            <button class="btn btn-primary load-confirm-btn">Load</button>
            <button class="btn btn-secondary close-load-btn">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  _attachHandlers() {
    const root = this.shadowRoot;

    root.querySelector('.export-btn').addEventListener('click', () => this._onExportClick());
    root.querySelector('.save-project-btn').addEventListener('click', () => this._onSaveProjectClick());
    root.querySelector('.load-project-btn').addEventListener('click', () => this._onLoadProjectClick());
    root.querySelector('.copy-btn').addEventListener('click', () => this._onCopyClick());
    root.querySelector('.close-save-btn').addEventListener('click', () => this._closeSaveModal());
    root.querySelector('.load-confirm-btn').addEventListener('click', () => this._onLoadConfirmClick());
    root.querySelector('.close-load-btn').addEventListener('click', () => this._closeLoadModal());

    root.querySelector('.save-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) this._closeSaveModal();
    });
    root.querySelector('.load-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) this._closeLoadModal();
    });
  }

  /** Find <pasty-canvas> by traversing up through shadow DOM boundaries */
  _getCanvas() {
    // Walk up from this element through shadow roots to find the app shell
    let node = this.getRootNode();
    while (node) {
      const canvas = node.querySelector?.('pasty-canvas');
      if (canvas) return canvas;
      // Move up: if we're in a shadow root, get the host and try its root
      if (node instanceof ShadowRoot) {
        node = node.host.getRootNode();
      } else {
        break;
      }
    }
    return null;
  }

  _onExportClick() {
    const svgChecked = this.shadowRoot.querySelector('.export-svg').checked;
    const pngChecked = this.shadowRoot.querySelector('.export-png').checked;
    if (svgChecked) this.exportSVG();
    if (pngChecked) this.exportPNG();
  }

  exportSVG() {
    const canvas = this._getCanvas();
    const svg = canvas?.svgElement;
    if (!svg) return;

    const clone = svg.cloneNode(true);
    clone.querySelectorAll('rect[stroke="#4a90d9"]').forEach((r) => r.remove());
    const serializer = new XMLSerializer();
    let str = serializer.serializeToString(clone);
    str = '<?xml version="1.0" encoding="UTF-8"?>\n' + str;
    const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    this._triggerDownload(blob, 'pasty-export.svg');
  }

  exportPNG() {
    const canvas = this._getCanvas();
    const svg = canvas?.svgElement;
    if (!svg) return;

    const vb = getViewBox();
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('rect[stroke="#4a90d9"]').forEach((r) => r.remove());
    clone.setAttribute('width', String(vb.w));
    clone.setAttribute('height', String(vb.h));
    const serializer = new XMLSerializer();
    const str = serializer.serializeToString(clone);
    const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = vb.w;
      c.height = vb.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      c.toBlob((pngBlob) => {
        if (pngBlob) this._triggerDownload(pngBlob, 'pasty-export.png');
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = url;
  }

  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _onSaveProjectClick() {
    const data = await exportProject();
    const json = JSON.stringify(data, null, 2);
    const textarea = this.shadowRoot.querySelector('.save-textarea');
    textarea.value = json;
    this.shadowRoot.querySelector('.save-modal').classList.remove('hidden');
  }

  async _onCopyClick() {
    const textarea = this.shadowRoot.querySelector('.save-textarea');
    await navigator.clipboard.writeText(textarea.value);
    const btn = this.shadowRoot.querySelector('.copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }

  _closeSaveModal() {
    this.shadowRoot.querySelector('.save-modal').classList.add('hidden');
  }

  _onLoadProjectClick() {
    this.shadowRoot.querySelector('.load-textarea').value = '';
    this.shadowRoot.querySelector('.load-modal').classList.remove('hidden');
  }

  async _onLoadConfirmClick() {
    const json = this.shadowRoot.querySelector('.load-textarea').value.trim();
    try {
      const data = JSON.parse(json);
      await importProject(data);
      this.shadowRoot.querySelector('.load-modal').classList.add('hidden');
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
    }
  }

  _closeLoadModal() {
    this.shadowRoot.querySelector('.load-modal').classList.add('hidden');
  }
}

customElements.define('pasty-export', PastyExport);
