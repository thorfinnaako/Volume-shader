(() => {
  // Basic Three.js fullscreen shader plane
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Simple fullscreen quad
  const geometry = new THREE.PlaneGeometry(2,2);

  // Fragment shader: cheap "volumetric" looking FBM cloud
  const fragment = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;
    // Hash / noise (iq's)
    vec3 hash33(vec3 p){
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yzx + 19.19);
      return fract((p.xxy + p.yzz)*p.zyx);
    }
    float noise(vec3 x){
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f*f*(3.0-2.0*f);
      float n = mix(mix(mix(dot(hash33(p+vec3(0,0,0)), f-vec3(0,0,0)),
                          dot(hash33(p+vec3(1,0,0)), f-vec3(1,0,0)), f.x),
                      mix(dot(hash33(p+vec3(0,1,0)), f-vec3(0,1,0)),
                          dot(hash33(p+vec3(1,1,0)), f-vec3(1,1,0)), f.x), f.y),
                  mix(mix(dot(hash33(p+vec3(0,0,1)), f-vec3(0,0,1)),
                          dot(hash33(p+vec3(1,0,1)), f-vec3(1,0,1)), f.x),
                      mix(dot(hash33(p+vec3(0,1,1)), f-vec3(0,1,1)),
                          dot(hash33(p+vec3(1,1,1)), f-vec3(1,1,1)), f.x), f.y),
                  f.z);
      return n;
    }
    float fbm(vec3 p){
      float v = 0.0;
      float a = 0.5;
      for(int i=0;i<5;i++){
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
      }
      return v;
    }

    void main(){
      vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
      uv.x *= u_resolution.x / u_resolution.y;

      // Create moving 3D sample coords
      vec3 ro = vec3(0.0, 0.0, -2.5); // camera origin (simple)
      vec3 rd = normalize(vec3(uv.xy, 1.2));
      float t = 0.0;
      float sum = 0.0;
      // cheap ray march with few steps -> "fake volumetric"
      for(int i=0;i<36;i++){
        vec3 pos = ro + rd * (t + float(i)*0.08);
        float n = fbm(pos*1.2 + vec3(0.0, u_time*0.08, u_time*0.03));
        // shape the cloud band
        float density = smoothstep(0.35, 0.85, n - length(uv)*0.15);
        // accumulate
        sum += density * 0.08;
      }
      // Color mapping
      vec3 col = mix(vec3(0.02,0.03,0.05), vec3(0.9,0.95,1.0), pow(clamp(sum,0.0,1.0),1.3));
      // Add subtle vignetting and tint
      float vign = smoothstep(1.0, 0.2, length(uv));
      col *= mix(vec3(0.9,1.0,1.1), vec3(0.7,0.85,1.0), vign);
      // final tone & gamma
      col = pow(col, vec3(0.9));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const vertex = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      u_time: { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
    }
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Handles resize
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    material.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
  });

  // --- Fake FPS generator (smooth random walk between min and max) ---
  const fpsEl = document.getElementById('fps');
  const gpuEl = document.getElementById('gpu');
  const cpuEl = document.getElementById('cpu');

  function createFakeWalker(min, max, start){
    let v = start || (min + max) * 0.5;
    let vel = 0;
    return function(dt){
      // dt in seconds
      // random acceleration
      vel += (Math.random() - 0.5) * 40.0 * dt; // tweak smoothness
      v += vel * dt;
      // softly pull back into range
      if(v < min) { v = min + (Math.random()*4); vel *= -0.5; }
      if(v > max) { v = max - (Math.random()*4); vel *= -0.5; }
      // damp velocity
      vel *= 0.95;
      // small jitter
      const jitter = Math.sin((performance.now()/1000.0) * (0.4 + Math.random()*0.8)) * 0.8;
      return Math.round(v + jitter);
    };
  }

  const fakeFPS = createFakeWalker(80, 200, 120);
  let lastUpdate = performance.now();

  // Fake hardware strings (choose randomly for "look")
  const GPU_PRESETS = [
    "NVIDIA GeForce RTX 4090",
    "NVIDIA GeForce RTX 3080 Ti",
    "AMD Radeon RX 7900 XTX",
    "NVIDIA GeForce RTX 4080",
    "Intel Arc A770",
    "Apple M2 Max (simulated)"
  ];
  const CPU_PRESETS = [
    "Intel Core i9-13900K",
    "AMD Ryzen 9 7950X",
    "Apple M2 Max 12‑core",
    "Intel Core i7-13700K",
    "AMD Ryzen 7 7800X3D"
  ];
  // Attempt to read real renderer info where allowed (may be blocked by privacy)
  function detectRenderer(){
    const canvas = renderer.domElement;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if(!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if(dbg){
      const rendererStr = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || null;
      const vendorStr = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || null;
      return (rendererStr || vendorStr) ? `${rendererStr || vendorStr}` : null;
    }
    return null;
  }

  // Show either detected or simulated hardware (with label)
  const detected = detectRenderer();
  if(detected){
    gpuEl.textContent = detected + " (detected)";
  } else {
    // pick a plausible GPU string, but mark simulated
    const pick = GPU_PRESETS[Math.floor(Math.random() * GPU_PRESETS.length)];
    gpuEl.textContent = pick + " (simulated)";
  }
  const pickCpu = CPU_PRESETS[Math.floor(Math.random() * CPU_PRESETS.length)];
  cpuEl.textContent = pickCpu + " (simulated)";

  // Animation loop
  let start = performance.now();
  function animate(now){
    requestAnimationFrame(animate);
    const t = (now - start) / 1000;
    material.uniforms.u_time.value = t;
    renderer.render(scene, camera);

    // update fake fps at ~12Hz
    if(now - lastUpdate > 80){
      const dt = (now - lastUpdate) / 1000;
      lastUpdate = now;
      const val = fakeFPS(dt);
      fpsEl.textContent = val + " FPS";

      // small color pulse when fps is "high"
      const num = Math.max(0, Math.min(1, (val - 80) / (200 - 80)));
      const accent = Math.floor(120 + num*135);
      document.documentElement.style.setProperty('--accent', `rgb(${accent},${200},${255})`);
    }
  }
  requestAnimationFrame(animate);

  // Make the shader intentionally cheap by throttling internal resolution a bit
  // (already limited by pixel ratio). Nothing else needed.

})();