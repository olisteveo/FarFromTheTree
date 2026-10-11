// Injected before the game loads (tools/perf/prof.mjs): times every frame, the WebGL calls that cause
// hitches (texture uploads, shader compiles/links, buffer uploads), long tasks and the JS heap, and,
// once window.ffttViews exists, each view's update() and the render.
(() => {
  const P = (window.__perf = { frames: [], longtasks: [], big: [], progs: [], stack: [], renderUploads: [], bound: null, buf: {}, trackBuf: false, seenProgs: new Set(), cur: null, sections: {}, t0: performance.now() });
  const newFrame = () => ({ gl: {}, sec: {} });
  P.cur = newFrame();
  const add = (bucket, k, ms, bytes) => {
    const o = bucket[k] || (bucket[k] = { n: 0, ms: 0, bytes: 0 });
    o.n++; o.ms += ms; o.bytes += bytes || 0;
  };
  const sizeOf = (args) => { for (const a of args) if (a && a.byteLength !== undefined) return a.byteLength; for (const a of args) if (a && a.width && a.height) return a.width * a.height * 4; return 0; };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of ["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "texStorage2D", "texStorage3D", "compressedTexImage2D", "compressedTexSubImage2D", "generateMipmap", "compileShader", "linkProgram", "getProgramParameter", "getShaderParameter", "bufferData", "bufferSubData", "readPixels", "clientWaitSync", "finish", "getError"]) {
      const f = C.prototype[k];
      if (!f) continue;
      C.prototype[k] = function (...args) {
        const t = performance.now();
        const r = f.apply(this, args);
        const ms = performance.now() - t;
        const bytes = k.startsWith("tex") || k.startsWith("buffer") ? sizeOf(args) : 0;
        add(P.cur.gl, k, ms, bytes);
        if ((k === "texSubImage2D" || k === "texImage2D") && bytes > 5e5 && P.stack[P.stack.length - 1] === "RENDER") P.renderUploads.push({ t: performance.now() - P.t0, tex: P.bound, mb: bytes / 1e6, ms });
        if (P.stack.length) add(P.cur.glsec || (P.cur.glsec = {}), P.stack[P.stack.length - 1] + ":" + k, ms, bytes);
        if (k === "bufferSubData" && P.trackBuf) { const key = bytes; const o = P.buf[key] || (P.buf[key] = { n: 0, ms: 0, stack: (new Error().stack || "").split(String.fromCharCode(10)).slice(2, 12).map((l) => l.trim().replace(/https?:[/][/][^/]+[/]/, "")) }); o.n++; o.ms += ms; }
        if ((bytes > 1e6 || ms > 8) && P.big.length < 400) P.big.push({ t: performance.now() - P.t0, k, ms: +ms.toFixed(1), mb: +(bytes / 1e6).toFixed(1), dims: args.filter((a) => typeof a === "number").slice(0, 8).join(","), stack: (new Error().stack || "").split("\n").slice(2, 9).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, "")) });
        return r;
      };
    }
  }
  for (const C of [window.WebGL2RenderingContext]) { const f = C.prototype.bindTexture; C.prototype.bindTexture = function (t, tex) { P.bound = tex; return f.call(this, t, tex); }; }
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => raf((now) => {
    const t = performance.now();
    const R = window.fftt && window.fftt.stage && window.fftt.stage.renderer;
    if (R) { R.info.autoReset = false; R.info.reset(); }
    try { cb(now); } finally {
      const cpu = performance.now() - t;
      const f = P.cur;
      // several rAF callbacks in one frame (the game's loop, the facade uploader...) are one frame
      if (now === P.lastNow && P.frames.length) {
        const pf = P.frames[P.frames.length - 1];
        pf.cpu += cpu;
        for (const k of ["gl", "sec", "glsec"]) for (const [kk, v] of Object.entries(f[k] || {})) { const o = (pf[k] = pf[k] || {})[kk] || (pf[k][kk] = { n: 0, ms: 0, bytes: 0 }); o.n += v.n; o.ms += v.ms; o.bytes += v.bytes; }
        P.cur = newFrame();
        return;
      }
      P.lastNow = now;
      f.t = now - P.t0; f.dt = last ? now - last : 0; f.cpu = cpu;
      last = now;
      const m = performance.memory;
      f.heap = m ? m.usedJSHeapSize : 0;
      const r = window.fftt && window.fftt.stage && window.fftt.stage.renderer;
      if (r && r.info.programs && r.info.programs.length !== P.nProgs) {
        P.nProgs = r.info.programs.length;
        for (const p of r.info.programs) if (!P.seenProgs.has(p)) { P.seenProgs.add(p); P.progs.push({ t: now - P.t0, name: p.name, key: String(p.cacheKey).slice(0, 160) }); }
      }
      if (r) { f.calls = r.info.render.calls; f.progs = r.info.programs ? r.info.programs.length : 0; f.tex = r.info.memory.textures; f.geo = r.info.memory.geometries; f.tris = r.info.render.triangles; }
      if (window.fftt) P.frames.push(f);
      P.cur = newFrame();
    }
  });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ t: e.startTime - P.t0, d: e.duration }); }).observe({ entryTypes: ["longtask"] });
  } catch {}
  // wrap the views' update()s once the game exposes them
  P.wrap = () => {
    const V = window.ffttViews, G = window.fftt;
    if (!V || !G || P.wrapped) return !!P.wrapped;
    P.wrapped = true;
    const wrap = (obj, name, label) => {
      if (!obj || typeof obj[name] !== "function") return;
      const f = obj[name];
      obj[name] = function (...a) { const t = performance.now(); P.stack.push(label); try { return f.apply(this, a); } finally { P.stack.pop(); add(P.cur.sec, label, performance.now() - t); } };
    };
    for (const [k, v] of Object.entries(V)) wrap(v, "update", k);
    wrap(G.stage, "render", "RENDER");
    wrap(G.stage, "update", "stage.update");
    wrap(G.stage, "adapt", "stage.adapt");
    if (G.stage.warmup) wrap(G.stage.warmup, "frame", "warmup");
    wrap(G.leaf, "step", "leaf.step");
    wrap(G.flow.traffic, "update", "flow.traffic");
    wrap(G.flow.crowd, "update", "flow.crowd");
    wrap(V.ground, "updateFocus", "ground.focus");
    wrap(V.subwayArt, "update", "subwayArt");
    wrap(G.subway, "update", "subway");
    wrap(V.farCity, "update", "farCity");
    return true;
  };
  const iv = setInterval(() => { if (P.wrap()) clearInterval(iv); }, 50);
})();
