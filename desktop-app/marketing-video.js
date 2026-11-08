"use strict";

// Renders a reel plan (*.reel.md) into a vertical video, in the page, with no extra software: each shot is drawn
// on a 1080×1920 canvas and recorded as it plays (MediaRecorder), so a 35-second reel takes 35 seconds.
//
// From the storyboard's Shots table:
// - Visual: a picture in the reel's folder (`overview-gate.png`), plus "pan left", "pan right", "zoom in" or
//   "zoom out" if you like. No picture: a title card on the house colours.
// - On-screen text: fades in over the lower part; " / " starts a new line. Title cards centre it, first line large.
// - Time: "0–5s" sets when each shot starts and ends.
// No sound: add music in Instagram or TikTok, as most reels do.

const ReelVideo = (() => {
  const W = 1080;
  const H = 1920;
  const FPS = 30;
  const FADE = 0.6; // seconds of crossfade between shots
  const INK = "#f3ece0";
  const ACCENT = "#e8a530";
  const BG = "#141210";

  const plain = (s) => s.replace(/[*_`]/g, "").trim();

  function mimeType() {
    for (const type of ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "";
  }

  function plan(text) {
    const reel = Render.parseReel(text);
    let at = 0;
    const shots = reel.shots.map((s, i) => {
      const start = s.start ?? at;
      const end = s.end && s.end > start ? s.end : start + 4;
      at = end;
      const image = (s.visual.match(/[\w.-]+\.(?:png|jpe?g|webp|gif)/i) || [])[0] || null;
      const motion = (s.visual.match(/pan left|pan right|zoom in|zoom out/i) || [])[0]?.toLowerCase() || ["pan right", "zoom in", "pan left", "zoom out"][i % 4];
      return { ...s, start, end, image, motion, lines: plain(s.text).split(/\s+\/\s+/).filter(Boolean) };
    });
    return { title: reel.title, shots, length: Math.max(0, ...shots.map((s) => s.end)) };
  }

  // Draws a picture filling the frame, moving slowly through the shot (t: 0 → 1).
  function drawPicture(ctx, img, motion, t) {
    const cover = Math.max(W / img.width, H / img.height);
    let scale = cover * 1.04;
    let cx = 0.5;
    const ease = t * t * (3 - 2 * t);
    if (motion === "zoom in") scale = cover * (1.04 + 0.12 * ease);
    if (motion === "zoom out") scale = cover * (1.16 - 0.12 * ease);
    if (motion === "pan right") cx = 0.15 + 0.7 * ease;
    if (motion === "pan left") cx = 0.85 - 0.7 * ease;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = -(w - W) * cx;
    const y = -(h - H) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function wrap(ctx, text, width) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawCaption(ctx, shot, alpha) {
    if (!shot.lines.length) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(0, H * 0.48, 0, H);
    grad.addColorStop(0, "rgba(20,18,16,0)");
    grad.addColorStop(1, "rgba(20,18,16,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.48, W, H * 0.52);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.font = "700 74px Georgia, 'Times New Roman', serif";
    const rows = shot.lines.flatMap((l) => wrap(ctx, l, W - 180));
    let y = H * 0.78 - ((rows.length - 1) * 92) / 2;
    ctx.fillStyle = INK;
    for (const row of rows) {
      ctx.fillText(row, W / 2, y);
      y += 92;
    }
    ctx.restore();
  }

  function drawTitleCard(ctx, shot, alpha, backdrop) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (backdrop) {
      ctx.globalAlpha = alpha * 0.22;
      drawPicture(ctx, backdrop, "zoom in", 0.5);
      ctx.globalAlpha = alpha;
    }
    ctx.textAlign = "center";
    const [first, ...rest] = shot.lines;
    let y = H * 0.44;
    ctx.fillStyle = INK;
    ctx.font = "700 104px Georgia, 'Times New Roman', serif";
    for (const row of wrap(ctx, first || "", W - 160)) {
      ctx.fillText(row, W / 2, y);
      y += 120;
    }
    ctx.fillStyle = ACCENT;
    ctx.fillRect(W / 2 - 90, y - 50, 180, 6);
    y += 60;
    ctx.font = "500 52px 'Segoe UI', system-ui, sans-serif";
    rest.forEach((line, i) => {
      ctx.fillStyle = i === rest.length - 1 && rest.length > 1 ? ACCENT : INK;
      for (const row of wrap(ctx, line, W - 200)) {
        ctx.fillText(row, W / 2, y);
        y += 70;
      }
      y += 16;
    });
    ctx.restore();
  }

  function drawShot(ctx, shot, time, alpha, images, backdrop) {
    const t = Math.min(1, Math.max(0, (time - shot.start) / Math.max(0.1, shot.end - shot.start)));
    const img = shot.image && images.get(shot.image);
    if (!img) return drawTitleCard(ctx, shot, alpha, backdrop);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawPicture(ctx, img, shot.motion, t);
    ctx.restore();
    const local = time - shot.start;
    const textAlpha = Math.min(1, Math.max(0, (local - 0.3) / 0.5), Math.max(0, (shot.end - time - 0.1) / 0.5));
    drawCaption(ctx, shot, alpha * textAlpha);
  }

  function frame(ctx, reel, time, images, backdrop) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const i = reel.shots.findIndex((s) => time >= s.start && time < s.end);
    const index = i < 0 ? reel.shots.length - 1 : i;
    const shot = reel.shots[index];
    const prev = reel.shots[index - 1];
    const into = time - shot.start;
    if (prev && into < FADE) {
      drawShot(ctx, prev, time, 1, images, backdrop);
      drawShot(ctx, shot, time, into / FADE, images, backdrop);
    } else drawShot(ctx, shot, time, 1, images, backdrop);
  }

  // canvas: where it plays while recording (shown scaled down); loadImage(name) → ImageBitmap or null.
  // onProgress(seconds, total); signal: { cancelled } to stop early. Resolves { blob, ext } or null if cancelled.
  async function render(text, canvas, loadImage, onProgress, signal = {}) {
    const reel = plan(text);
    if (!reel.shots.length) throw new Error("This reel plan has no shots yet: fill in the Shots table.");
    const images = new Map();
    for (const name of new Set(reel.shots.map((s) => s.image).filter(Boolean))) {
      const img = await loadImage(name);
      if (img) images.set(name, img);
    }
    const backdrop = [...images.values()].pop() || null;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    frame(ctx, reel, 0, images, backdrop);
    const type = mimeType();
    if (!type) throw new Error("This version of the app can't record video.");
    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(1000);
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        const time = (performance.now() - started) / 1000;
        if (signal.cancelled || time >= reel.length + 0.3) {
          clearInterval(tick);
          resolve();
          return;
        }
        frame(ctx, reel, Math.min(time, reel.length - 0.001), images, backdrop);
        onProgress?.(Math.min(time, reel.length), reel.length);
      }, 1000 / FPS);
    });
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    if (signal.cancelled) return null;
    return { blob: new Blob(chunks, { type: type.split(";")[0] }), ext: type.startsWith("video/mp4") ? "mp4" : "webm" };
  }

  return { render, plan };
})();
