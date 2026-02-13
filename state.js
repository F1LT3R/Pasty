// ============================================================================
// state.js — Shared state module for Pasty
//
// All state is accessed through getter/setter functions.
// Two-tier storage: layer metadata in localStorage, image data in IndexedDB.
// ============================================================================

// ---------------------------------------------------------------------------
// Internal state (private)
// ---------------------------------------------------------------------------

/** @type {Array<{id:string, name:string, imageId:string, x:number, y:number, width:number, height:number, rotation:number, opacity:number, visible:boolean, locked:boolean, blendMode:string}>} */
let _layers = [];

/** @type {{x:number, y:number, w:number, h:number}} */
let _viewBox = { x: 0, y: 0, w: 800, h: 600 };

let _initialW = 800;
let _initialH = 600;

/** Derived: _initialW / _viewBox.w */
let _zoomLevel = 1;

/** @type {string|null} */
let _selectedLayerId = null;

/** @type {string[]} — each entry is JSON.stringify(_layers) snapshot */
let _undoStack = [];

/** @type {string[]} */
let _redoStack = [];

/** Runtime cache: imageId -> base64 data URL */
let _imageCache = new Map();

/** Cached IndexedDB database handle */
let _dbPromise = null;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

/**
 * Open (or return cached) IndexedDB database.
 * Database: "pasty-db", version 1, object store: "images" (keyPath: "imageId")
 */
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('pasty-db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('images', { keyPath: 'imageId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/**
 * Store an image in IndexedDB and update the runtime cache.
 * @param {string} imageId
 * @param {string} base64DataUrl  e.g. "data:image/png;base64,..."
 */
export async function storeImage(imageId, base64DataUrl) {
  _imageCache.set(imageId, base64DataUrl);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put({ imageId, data: base64DataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get an image by ID. Checks runtime cache first, then IndexedDB.
 * @param {string} imageId
 * @returns {Promise<string>} base64 data URL
 */
export async function getImage(imageId) {
  if (_imageCache.has(imageId)) return _imageCache.get(imageId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const req = tx.objectStore('images').get(imageId);
    req.onsuccess = () => {
      const result = req.result;
      if (result) {
        _imageCache.set(imageId, result.data);
        resolve(result.data);
      } else {
        resolve('');
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Synchronous cache lookup. Returns empty string if not yet cached.
 * Safe to use in render paths because loadState() pre-fills the cache.
 * @param {string} imageId
 * @returns {string}
 */
export function getImageSync(imageId) {
  return _imageCache.get(imageId) || '';
}

/**
 * Return a Map of ALL images stored in IndexedDB.
 * @returns {Promise<Map<string,string>>}
 */
export async function getAllImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const map = new Map();
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const cursor = store.openCursor();
    cursor.onsuccess = (e) => {
      const c = e.target.result;
      if (c) {
        map.set(c.value.imageId, c.value.data);
        c.continue();
      } else {
        resolve(map);
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

/**
 * Delete a single image from IndexedDB and the runtime cache.
 * @param {string} imageId
 */
export async function deleteImage(imageId) {
  _imageCache.delete(imageId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').delete(imageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove any images from IndexedDB that are not referenced by
 * current layers, undo stack, or redo stack.
 */
export async function collectGarbageImages() {
  // Gather all referenced imageIds
  const referenced = new Set();

  for (const layer of _layers) {
    if (layer.imageId) referenced.add(layer.imageId);
  }

  const parseAndCollect = (stack) => {
    for (const snapshot of stack) {
      try {
        const layers = JSON.parse(snapshot);
        for (const layer of layers) {
          if (layer.imageId) referenced.add(layer.imageId);
        }
      } catch (_) {
        // skip malformed snapshots
      }
    }
  };

  parseAndCollect(_undoStack);
  parseAndCollect(_redoStack);

  // Get all stored imageIds from IndexedDB
  const allImages = await getAllImages();

  // Delete unreferenced
  for (const imageId of allImages.keys()) {
    if (!referenced.has(imageId)) {
      await deleteImage(imageId);
    }
  }
}

// ---------------------------------------------------------------------------
// Accessors (read-only snapshots)
// ---------------------------------------------------------------------------

/** @returns {Array} shallow copy of layers array */
export function getLayers() {
  return [..._layers];
}

/** @returns {object|null} the currently selected layer, or null */
export function getSelectedLayer() {
  return _layers.find((l) => l.id === _selectedLayerId) || null;
}

/** @returns {string|null} */
export function getSelectedLayerId() {
  return _selectedLayerId;
}

/** @returns {{x:number, y:number, w:number, h:number}} */
export function getViewBox() {
  return { ..._viewBox };
}

/** @returns {number} */
export function getZoomLevel() {
  return _zoomLevel;
}

/** @returns {{w:number, h:number}} */
export function getInitialDimensions() {
  return { w: _initialW, h: _initialH };
}

// ---------------------------------------------------------------------------
// Mutators (each dispatches 'state-changed' unless noted otherwise)
// ---------------------------------------------------------------------------

/**
 * Add a layer to the top of the stack.
 * @param {object} layerObj
 */
export function addLayer(layerObj) {
  if (layerObj.rotation === undefined) layerObj.rotation = 0;
  _layers.push(layerObj);
  dispatch('state-changed');
}

/**
 * Remove a layer by ID. Auto-selects nearest layer if removed layer was selected.
 * @param {string} id
 */
export function removeLayer(id) {
  const idx = _layers.findIndex((l) => l.id === id);
  if (idx === -1) return;

  _layers.splice(idx, 1);

  // If the removed layer was selected, pick nearest or null
  if (_selectedLayerId === id) {
    if (_layers.length === 0) {
      _selectedLayerId = null;
    } else {
      const newIdx = Math.min(idx, _layers.length - 1);
      _selectedLayerId = _layers[newIdx].id;
    }
  }

  dispatch('state-changed');
}

/**
 * Merge properties into an existing layer.
 * @param {string} id
 * @param {object} propsObj
 */
export function updateLayer(id, propsObj) {
  const layer = _layers.find((l) => l.id === id);
  if (layer) {
    Object.assign(layer, propsObj);
    dispatch('state-changed');
  }
}

/**
 * Move a layer to a new z-index position.
 * @param {string} id
 * @param {number} newIndex
 */
export function reorderLayer(id, newIndex) {
  const oldIndex = _layers.findIndex((l) => l.id === id);
  if (oldIndex === -1) return;

  const [layer] = _layers.splice(oldIndex, 1);
  const clampedIndex = Math.max(0, Math.min(newIndex, _layers.length));
  _layers.splice(clampedIndex, 0, layer);

  dispatch('state-changed');
}

/**
 * Select a layer by ID. Dispatches 'layer-selected'.
 * @param {string} id
 */
export function selectLayer(id) {
  _selectedLayerId = id;
  dispatch('layer-selected', { id });
}

/**
 * Set the SVG viewBox. Recomputes zoom level.
 * @param {{x:number, y:number, w:number, h:number}} vb
 */
export function setViewBox(vb) {
  _viewBox = { ...vb };
  _zoomLevel = _initialW / _viewBox.w;
  dispatch('state-changed');
}

/**
 * Directly set zoom level (without recomputing viewBox).
 * @param {number} level
 */
export function setZoom(level) {
  _zoomLevel = level;
}

/**
 * Store initial canvas dimensions (used for zoom calculations).
 * @param {number} w
 * @param {number} h
 */
export function setInitialDimensions(w, h) {
  _initialW = w;
  _initialH = h;
}

// ---------------------------------------------------------------------------
// Undo / Redo (no max history)
// ---------------------------------------------------------------------------

/** Push current layer metadata onto the undo stack. Clears redo stack. */
export function pushUndo() {
  _undoStack.push(JSON.stringify(_layers));
  _redoStack = [];
}

/** Undo: pop from undo stack, push current state to redo, restore layers. */
export function undo() {
  if (_undoStack.length === 0) return;
  _redoStack.push(JSON.stringify(_layers));
  _layers = JSON.parse(_undoStack.pop());
  dispatch('state-changed');
}

/** Redo: pop from redo stack, push current state to undo, restore layers. */
export function redo() {
  if (_redoStack.length === 0) return;
  _undoStack.push(JSON.stringify(_layers));
  _layers = JSON.parse(_redoStack.pop());
  dispatch('state-changed');
}

// ---------------------------------------------------------------------------
// Persistence (localStorage for metadata, IndexedDB for images)
// ---------------------------------------------------------------------------

/**
 * Synchronously save layer metadata + stacks to localStorage.
 * No image data is saved here — images live in IndexedDB.
 */
export function saveState() {
  localStorage.setItem(
    'pasty-state',
    JSON.stringify({
      layers: _layers,
      viewBox: _viewBox,
      selectedLayerId: _selectedLayerId,
      undoStack: _undoStack,
      redoStack: _redoStack,
    })
  );
}

/**
 * Async load: restore metadata from localStorage, then pre-fill image cache
 * from IndexedDB so that getImageSync() works in render paths.
 */
export async function loadState() {
  // 1. Restore metadata from localStorage
  try {
    const raw = localStorage.getItem('pasty-state');
    if (raw) {
      const parsed = JSON.parse(raw);
      _layers = parsed.layers || [];
      _viewBox = parsed.viewBox || { x: 0, y: 0, w: 800, h: 600 };
      _selectedLayerId = parsed.selectedLayerId || null;
      _undoStack = parsed.undoStack || [];
      _redoStack = parsed.redoStack || [];
    }
  } catch (_) {
    // Corrupted localStorage — start fresh
    _layers = [];
    _viewBox = { x: 0, y: 0, w: 800, h: 600 };
    _selectedLayerId = null;
    _undoStack = [];
    _redoStack = [];
  }

  // 2. Pre-fill runtime image cache from IndexedDB
  try {
    const allImages = await getAllImages();
    for (const [imageId, data] of allImages) {
      _imageCache.set(imageId, data);
    }
  } catch (_) {
    // IndexedDB unavailable — cache stays empty
  }
}

// ---------------------------------------------------------------------------
// Project Import / Export
// ---------------------------------------------------------------------------

/**
 * Export the full project as a JSON-serializable object.
 * Each layer gets a temporary `imageData` field with the full base64 inlined.
 * @returns {Promise<object>}
 */
export async function exportProject() {
  const layersWithImages = [];

  for (const layer of _layers) {
    const imageData =
      _imageCache.get(layer.imageId) || (await getImage(layer.imageId));
    layersWithImages.push({
      ...layer,
      imageData,
    });
  }

  return {
    version: 1,
    layers: layersWithImages,
    viewBox: { ..._viewBox },
    selectedLayerId: _selectedLayerId,
  };
}

/**
 * Import a project from a JSON object. Replaces all current state.
 * @param {object} jsonObj — must have `version` and `layers` array
 */
export async function importProject(jsonObj) {
  if (!jsonObj || !jsonObj.version || !Array.isArray(jsonObj.layers)) {
    throw new Error('Invalid project file: must have version and layers array');
  }

  // Clear current state
  _layers = [];
  _undoStack = [];
  _redoStack = [];

  // Process each layer: extract and store image data separately
  for (const layer of jsonObj.layers) {
    if (layer.imageData) {
      await storeImage(layer.imageId, layer.imageData);
      delete layer.imageData; // remove from layer object
    }
    _layers.push(layer);
  }

  _viewBox = jsonObj.viewBox || { x: 0, y: 0, w: 800, h: 600 };
  _selectedLayerId = jsonObj.selectedLayerId || null;

  saveState();
  dispatch('state-changed');
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

/**
 * Dispatch a custom event on document.
 * @param {string} eventName
 * @param {object} [detail]
 */
export function dispatch(eventName, detail) {
  document.dispatchEvent(new CustomEvent(eventName, { detail }));
}

/**
 * Listen for a custom event on document.
 * @param {string} eventName
 * @param {function} handler
 */
export function on(eventName, handler) {
  document.addEventListener(eventName, handler);
}
