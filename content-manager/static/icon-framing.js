/* ---------- Resource icon framing: a crop square on the painting ----------

   The editor shows the whole painting with a square on it. Drag the square to move it; drag its corner (or use the
   Size slider) to resize it. Exactly what is inside the square is what the site shows as the icon. The square may
   reach past the painting's edge to fit a tall object whole; the icon's dark backdrop fills the rest.

   Stored as imageCrop { x, y, size, ratio }: the square's top-left corner and side in percent of the painting's
   width, and the painting's height / width (read from the image when it loads).

   Loaded before manager.js; iconFramingField() is called while the Resource form is drawn. */

const STAGE = 260;      // the editor's square, in pixels
const STAGE_PAD = 0.22; // room around the painting (in painting widths), so the square can reach past the edge

// A crop from any saved form: the crop square, or the older focus-and-zoom framing.
function normaliseCrop(crop = {}) {
  const ratio = Number(crop.ratio) > 0 ? Number(crop.ratio) : 1;
  if (Number.isFinite(Number(crop.size)) && crop.size !== undefined) {
    return { x: Number(crop.x) || 0, y: Number(crop.y) || 0, size: Number(crop.size), ratio };
  }
  const size = 100 / (Number(crop.zoom) > 0 ? Number(crop.zoom) : 1);
  return { x: (100 - size) / 2, y: (100 * ratio - size) / 2, size, ratio };
}

// The two quick choices: inside the painted frame (the usual icon), or the whole painting.
// The paintings carry a border of about 8% (a little more along the bottom); this square sits just inside it.
const insideFrameCrop = (ratio) => {
  if (ratio > 1.02) return { x: 8, y: Math.round((49 * ratio - 42) * 100) / 100, size: 84, ratio };
  const size = 84 * ratio;
  return { x: 50 - size / 2, y: 8 * ratio, size, ratio };
};
const wholeCrop = (ratio) => {
  const size = Math.max(1, ratio) * 100;
  return { x: (100 - size) / 2, y: (100 * ratio - size) / 2, size, ratio };
};

// The site's icon: the painting scaled and shifted so the square fills the box exactly.
const iconWindowStyle = ({ x, y, size, ratio }) => {
  const pct = (value) => `${Math.round(value * 1000) / 1000}%`;
  return `left: ${pct(-100 * x / size)}; top: ${pct(-100 * y / size)}; width: ${pct(10000 / size)}; height: ${pct(10000 * ratio / size)}`;
};

function iconFramingField(record) {
  const crop = normaliseCrop(record.imageCrop);
  const source = imageSource(record.image || "");
  return `<div class="field full icon-framing" data-icon-framing>
    <span class="field-label">Icon framing</span>
    <div class="framing-row">
      <div class="framing-stage" data-framing-stage style="width: ${STAGE}px; height: ${STAGE}px">
        ${source ? `<img data-framing-painting src="${escapeHtml(source)}" alt="" draggable="false" />
          <div class="framing-box" data-framing-box title="Drag to move"><span class="framing-handle" data-framing-handle title="Drag to resize"></span></div>`
          : '<span class="framing-empty">Upload a painting above, then choose the square to show.</span>'}
      </div>
      <div class="framing-side">
        <div class="framing-sizes" aria-label="How the icon looks on the site">
          <span class="framing-thumb is-88">${source ? `<img src="${escapeHtml(source)}" alt="" style="${iconWindowStyle(crop)}" />` : ""}</span>
          <span class="framing-thumb is-44">${source ? `<img src="${escapeHtml(source)}" alt="" style="${iconWindowStyle(crop)}" />` : ""}</span>
          <span class="helper">The icon, large and at the size the site shows it</span>
        </div>
        <label class="framing-control"><span>Size</span><input type="range" min="10" max="150" step="0.5" value="${crop.size}" data-framing-size /><output data-framing-out>${Math.round(crop.size)}%</output></label>
        <div class="framing-buttons">
          <button type="button" class="button button-secondary" data-framing-preset="inside">Inside the frame</button>
          <button type="button" class="button button-secondary" data-framing-preset="whole">Whole painting</button>
        </div>
      </div>
    </div>
    <span class="helper">Drag the square to move it and its corner to resize it. What is inside the square is the icon. It may reach past the edge of the painting to fit a tall object whole.</span>
    <input type="hidden" name="cropX" value="${crop.x}" /><input type="hidden" name="cropY" value="${crop.y}" />
    <input type="hidden" name="cropSize" value="${crop.size}" /><input type="hidden" name="cropRatio" value="${crop.ratio}" />
  </div>`;
}

const readCrop = (form) => normaliseCrop({
  x: form.querySelector('[name="cropX"]')?.value, y: form.querySelector('[name="cropY"]')?.value,
  size: form.querySelector('[name="cropSize"]')?.value, ratio: form.querySelector('[name="cropRatio"]')?.value,
});

// The stage shows the painting centred, with room around it; k is pixels per painting width.
const stageGeometry = (ratio) => {
  const view = Math.max(1, ratio) + 2 * STAGE_PAD;
  return { k: STAGE / view, left: 0.5 - view / 2, top: ratio / 2 - view / 2 };
};

function layoutFraming(editor, crop) {
  const form = editor.closest("form");
  crop = {
    ...crop,
    size: Math.min(150, Math.max(10, crop.size)),
    x: Math.min(100, Math.max(-75, crop.x)),
    y: Math.min(100 * crop.ratio, Math.max(-75, crop.y)),
  };
  for (const [key, value] of [["cropX", crop.x], ["cropY", crop.y], ["cropSize", crop.size], ["cropRatio", crop.ratio]]) {
    form.querySelector(`[name="${key}"]`).value = Math.round(value * 100) / 100;
  }
  const geometry = stageGeometry(crop.ratio);
  const painting = editor.querySelector("[data-framing-painting]");
  if (painting) {
    painting.style.cssText = `left: ${(-geometry.left) * geometry.k}px; top: ${(-geometry.top) * geometry.k}px; width: ${geometry.k}px; height: ${crop.ratio * geometry.k}px`;
  }
  const box = editor.querySelector("[data-framing-box]");
  if (box) {
    box.style.cssText = `left: ${(crop.x / 100 - geometry.left) * geometry.k}px; top: ${(crop.y / 100 - geometry.top) * geometry.k}px; width: ${crop.size / 100 * geometry.k}px; height: ${crop.size / 100 * geometry.k}px`;
  }
  editor.querySelectorAll(".framing-thumb img").forEach((img) => { img.style.cssText = iconWindowStyle(crop); });
  const range = editor.querySelector("[data-framing-size]");
  if (range && Number(range.value) !== crop.size) range.value = crop.size;
  const out = editor.querySelector("[data-framing-out]");
  if (out) out.textContent = `${Math.round(crop.size)}%`;
  if (typeof preview !== "undefined" && preview.open) schedulePreview();
  return crop;
}

// Draw the editor once its painting has loaded: its true proportions decide where everything goes.
function initFraming(editor) {
  const painting = editor?.querySelector("[data-framing-painting]");
  if (!painting) return;
  const ready = () => {
    const ratio = painting.naturalWidth ? painting.naturalHeight / painting.naturalWidth : 1;
    const crop = readCrop(editor.closest("form"));
    // A painting newly uploaded (or never framed) starts inside its painted frame.
    const fresh = editor.dataset.fresh === "true" || Math.abs(crop.ratio - ratio) > 0.01 && crop.size === 100 && crop.x === 0 && crop.y === 0;
    editor.dataset.fresh = "false";
    layoutFraming(editor, fresh ? insideFrameCrop(ratio) : { ...crop, ratio });
  };
  if (painting.complete && painting.naturalWidth) ready();
  else painting.addEventListener("load", ready, { once: true });
}

// The Resource form is drawn by manager.js; start the editor whenever one appears.
new MutationObserver(() => {
  const editor = document.querySelector("[data-icon-framing]:not([data-ready])");
  if (!editor) return;
  editor.dataset.ready = "true";
  initFraming(editor);
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("input", (event) => {
  const size = event.target.closest?.("[data-framing-size]");
  const editor = size?.closest("[data-icon-framing]");
  if (editor) {
    // Resize around the square's centre, so the subject stays put.
    const crop = readCrop(editor.closest("form"));
    const next = Number(size.value);
    layoutFraming(editor, { ...crop, x: crop.x + (crop.size - next) / 2, y: crop.y + (crop.size - next) / 2, size: next });
    return;
  }
  // A new painting in the Image field: redraw the editor and start it inside the frame.
  if (event.target.matches?.('#record-form [name="image"]')) {
    const framing = document.querySelector("[data-icon-framing]");
    if (!framing) return;
    const source = imageSource(event.target.value.trim());
    const stage = framing.querySelector("[data-framing-stage]");
    stage.innerHTML = source ? `<img data-framing-painting src="${escapeHtml(source)}" alt="" draggable="false" />
      <div class="framing-box" data-framing-box title="Drag to move"><span class="framing-handle" data-framing-handle title="Drag to resize"></span></div>` : "";
    framing.querySelectorAll(".framing-thumb").forEach((thumb) => { thumb.innerHTML = source ? `<img src="${escapeHtml(source)}" alt="" />` : ""; });
    framing.dataset.fresh = "true";
    initFraming(framing);
  }
});

document.addEventListener("click", (event) => {
  const preset = event.target.closest("[data-framing-preset]");
  if (!preset) return;
  const editor = preset.closest("[data-icon-framing]");
  const { ratio } = readCrop(editor.closest("form"));
  layoutFraming(editor, preset.dataset.framingPreset === "whole" ? wholeCrop(ratio) : insideFrameCrop(ratio));
});

// Dragging: the square moves with the pointer; its corner handle resizes it (the top-left corner stays put).
let framingDrag = null;
document.addEventListener("pointerdown", (event) => {
  const box = event.target.closest?.("[data-framing-box]");
  if (!box) return;
  const editor = box.closest("[data-icon-framing]");
  framingDrag = { editor, box, resize: Boolean(event.target.closest("[data-framing-handle]")), startX: event.clientX, startY: event.clientY, crop: readCrop(editor.closest("form")) };
  box.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener("pointermove", (event) => {
  if (!framingDrag) return;
  const { crop, editor } = framingDrag;
  const { k } = stageGeometry(crop.ratio);
  const dx = ((event.clientX - framingDrag.startX) / k) * 100;
  const dy = ((event.clientY - framingDrag.startY) / k) * 100;
  layoutFraming(editor, framingDrag.resize
    ? { ...crop, size: crop.size + Math.max(dx, dy) }
    : { ...crop, x: crop.x + dx, y: crop.y + dy });
});
document.addEventListener("pointerup", () => { framingDrag = null; });
