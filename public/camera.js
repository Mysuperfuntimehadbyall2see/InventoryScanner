// Camera mode: reads barcodes from the phone's (or laptop's) camera with the
// zxing-wasm decoder (ZXing-C++ compiled to WebAssembly). The decoder is
// served by this app from /vendor; nothing is fetched from the internet.
// The page loads this file only when Camera mode is first used.
//
// Every barcode in view is read, in these families: Code 128 (including
// GS1-128), Code 39, Code 93, Codabar, ITF, EAN/UPC, GS1 DataBar, Data Matrix
// (including GS1 DataMatrix), QR Code, PDF417 and Aztec. That covers the
// labels on Dell hardware and boxes.
//
// Frames alternate between the whole picture (finds several codes at once)
// and the middle of it at full detail (finds small codes, such as the Data
// Matrix on a Dell label). The middle area is outlined on the picture.

import { prepareZXingModule, readBarcodes, formatToLabel } from './vendor/zxing-wasm/es/reader/index.js';

const WASM_URL = new URL('./vendor/zxing-wasm/zxing_reader.wasm', import.meta.url).href;
// One shared object: the decoder compares it to decide whether to reload.
const ZXING_OVERRIDES = {
  locateFile: (file, prefix) => (file.endsWith('.wasm') ? WASM_URL : prefix + file),
};

const READER_OPTIONS = {
  formats: ['Code128', 'Code39', 'Code93', 'Codabar', 'ITF', 'EANUPC', 'DataBar', 'DataMatrix', 'QRCode', 'PDF417', 'Aztec'],
  textMode: 'HRI', // GS1 data as "(01)…(21)…" instead of hidden separator characters
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 16,
};

const MAX_DECODE_SIDE = 1280; // pixels; larger frames are scaled down first
const CENTRE_SHARE = 0.6; // the middle 60% of the picture, read at full detail
const PAUSE_BETWEEN_FRAMES_MS = 60;
const OUTLINE_KEEP_MS = 700;

// Everyday names for variants the decoder reports in technical terms.
const PLAIN_NAMES = { Code39Std: 'Code 39', QRCodeModel1: 'QR Code', QRCodeModel2: 'QR Code', AztecCode: 'Aztec' };

// "GS1 DataMatrix", "GS1-128", "Code 39", "QR Code", "EAN-13", ...
export function formatName(result) {
  const gs1 = result.contentType === 'GS1';
  if (result.format === 'Code128') return gs1 ? 'GS1-128' : 'Code 128';
  if (result.format === 'DataMatrix') return gs1 ? 'GS1 DataMatrix' : 'Data Matrix';
  const label = PLAIN_NAMES[result.format] ?? formatToLabel(result.format);
  return gs1 && !label.startsWith('DataBar') ? `GS1 ${label}` : label;
}

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// Plain-English reason for a failed camera start.
function explain(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('missing', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app. Close it, then try again.');
    default:
      return new CameraError('other', `The camera could not start (${err?.message ?? err}).`);
  }
}

// video: the <video> element; overlay: a <canvas> on top of it.
// onResults(list) is called after every frame with the codes in it:
//   [{ text, format, corners: [{x, y} ×4] }]
// isSaved(text, format) tells the outline colour: green when saved.
export function createCameraScanner({ video, overlay, onResults, isSaved }) {
  const frameCanvas = document.createElement('canvas');
  const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
  const overlayContext = overlay.getContext('2d');
  let stream = null;
  let track = null;
  let running = false;
  let timer = 0;
  let frame = 0;
  let outlines = []; // [{corners, text, format, at}]

  async function start(deviceId) {
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('unsupported', 'This browser cannot use the camera here. Open the page over https.');
    }
    // Start loading the decoder while the camera starts.
    const decoderReady = prepareZXingModule({ overrides: ZXING_OVERRIDES, fireImmediately: true });
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
      });
    } catch (err) {
      throw explain(err);
    }
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    // Muted inline video. Some browsers settle play() late or never; the loop
    // below waits for real frames anyway, so don't wait on it for long.
    await Promise.race([video.play().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
    try {
      await decoderReady;
    } catch (err) {
      stop();
      throw new CameraError('decoder', `The barcode reader did not load (${err?.message ?? err}). Reload the page.`);
    }
    running = true;
    loop();
    return { deviceId: track.getSettings?.().deviceId ?? null, label: track.label };
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    track = null;
    video.srcObject = null;
    outlines = [];
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  }

  async function loop() {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const found = await decodeFrame(frame++);
        if (!running) return;
        const now = performance.now();
        outlines = outlines.filter((o) => now - o.at < OUTLINE_KEEP_MS);
        for (const f of found) outlines.push({ ...f, at: now });
        drawOverlay();
        onResults(found);
      } catch (err) {
        running = false;
        onResults([], new CameraError('decoder', `The barcode reader stopped (${err?.message ?? err}).`));
        return;
      }
    }
    timer = setTimeout(loop, PAUSE_BETWEEN_FRAMES_MS);
  }

  async function decodeFrame(n) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (n % 2 === 1) {
      sw = Math.round(vw * CENTRE_SHARE);
      sh = Math.round(vh * CENTRE_SHARE);
      sx = Math.round((vw - sw) / 2);
      sy = Math.round((vh - sh) / 2);
    }
    const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(sw, sh));
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    if (frameCanvas.width !== dw || frameCanvas.height !== dh) {
      frameCanvas.width = dw;
      frameCanvas.height = dh;
    }
    frameContext.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    const results = await readBarcodes(frameContext.getImageData(0, 0, dw, dh), READER_OPTIONS);
    return results
      .filter((r) => r.isValid && r.text)
      .map((r) => ({
        text: r.text,
        format: formatName(r),
        corners: ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
          .map((k) => ({ x: sx + r.position[k].x / scale, y: sy + r.position[k].y / scale })),
      }));
  }

  // Outlines found codes (green = saved, amber = not saved) and the middle area.
  function drawOverlay() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (overlay.width !== vw || overlay.height !== vh) {
      overlay.width = vw;
      overlay.height = vh;
    }
    const ctx = overlayContext;
    ctx.clearRect(0, 0, vw, vh);
    const line = Math.max(3, Math.round(Math.max(vw, vh) / 300));
    ctx.lineWidth = Math.max(2, Math.round(line / 2));
    ctx.setLineDash([line * 3, line * 2]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    const cw = vw * CENTRE_SHARE;
    const ch = vh * CENTRE_SHARE;
    ctx.strokeRect((vw - cw) / 2, (vh - ch) / 2, cw, ch);
    ctx.setLineDash([]);
    ctx.lineWidth = line;
    for (const o of outlines) {
      ctx.strokeStyle = isSaved(o.text, o.format) ? '#2fbf62' : '#f2b233';
      ctx.beginPath();
      o.corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Torch and zoom exist on many Android phones; iPhones and laptops usually
  // offer neither, and the page then hides the buttons.
  function capabilities() {
    const caps = track?.getCapabilities?.() ?? {};
    return {
      torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
      zoom: caps.zoom && caps.zoom.max > caps.zoom.min
        ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: track.getSettings?.().zoom ?? caps.zoom.min }
        : null,
    };
  }

  async function setTorch(on) {
    await track?.applyConstraints({ advanced: [{ torch: on }] });
  }

  async function setZoom(value) {
    await track?.applyConstraints({ advanced: [{ zoom: value }] });
  }

  // Cameras have names only after the user has allowed camera access once.
  async function listCameras() {
    const devices = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
    return devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  return {
    start,
    stop,
    capabilities,
    setTorch,
    setZoom,
    listCameras,
    get running() {
      return running;
    },
    redraw: drawOverlay,
  };
}
