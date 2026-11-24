import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from './util.js';

export const WEATHER = {
  clear:  { cloud: 0.15, fog: 0.00022, rain: 0, wind: 0.2 },
  cloudy: { cloud: 0.6,  fog: 0.0004,  rain: 0, wind: 0.5 },
  fog:    { cloud: 0.5,  fog: 0.0055,  rain: 0, wind: 0.1 },
  rain:   { cloud: 0.85, fog: 0.0012,  rain: 0.7, wind: 0.6 },
  storm:  { cloud: 1.0,  fog: 0.0022,  rain: 1, wind: 1 },
};
const NAMES = Object.keys(WEATHER);

export class Environment {
  constructor(scene, renderer, camera) {
    this.scene = scene; this.renderer = renderer; this.camera = camera;
    this.time = 9.5; this.timeSpeed = 120; // game seconds per real second (24h = 12 min)
    this.weatherName = 'clear'; this.cur = { ...WEATHER.clear }; this.wetness = 0; this.night = 0; this.flash = 0;
    this.autoWeather = true; this.weatherT = 90; this.lightningT = 6; this.onThunder = null;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.sky = new Sky(); this.sky.scale.setScalar(10000); scene.add(this.sky);
    this.envSky = new Sky(); this.envSky.scale.setScalar(10000);
    this.envScene = new THREE.Scene(); this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer); this.envT = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -110; sc.right = sc.top = 110; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0.2);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4a3c, 0.6);
    scene.add(this.sun, this.sun.target, this.moon, this.hemi);
    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0003);

    this.sunDir = new THREE.Vector3(0, 1, 0);

    // stars
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y); v.multiplyScalar(9000); sp.set([v.x, v.y, v.z], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
    scene.add(this.stars);

    // clouds
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 14; i++) { const x = 30 + Math.random() * 68, y = 40 + Math.random() * 48, r = 18 + Math.random() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const ct = new THREE.CanvasTexture(c);
    this.clouds = [];
    for (let i = 0; i < 36; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
      s.userData = { bx: (Math.random() - 0.5) * 7000, bz: (Math.random() - 0.5) * 7000, hh: 650 + Math.random() * 450, vis: Math.random() };
      s.scale.set(1000 + Math.random() * 800, 500 + Math.random() * 300, 1); scene.add(s); this.clouds.push(s);
    }

    // rain
    const N = 4000, rp = new Float32Array(N * 6);
    this.rainBase = Array.from({ length: N }, () => [(Math.random() - 0.5) * 60, Math.random() * 40, (Math.random() - 0.5) * 60]);
    this.rainGeo = new THREE.BufferGeometry(); this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0xbfd0e0, transparent: true, opacity: 0.35, fog: false }));
    this.rain.frustumCulled = false; scene.add(this.rain);
    this.rainT = 0;
    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8f0ff, fog: false })); this.bolt.visible = false; this.bolt.frustumCulled = false; scene.add(this.bolt);
  }

  setWeather(name) { this.weatherName = name; }
  cycleWeather() { this.autoWeather = false; this.weatherName = NAMES[(NAMES.indexOf(this.weatherName) + 1) % NAMES.length]; }
  get clock() { const h = Math.floor(this.time) % 24, m = Math.floor((this.time % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  update(dt, focus, camPos) {
    this.time = (this.time + dt * this.timeSpeed / 3600) % 24;
    const T = WEATHER[this.weatherName], k = 1 - Math.exp(-0.25 * dt);
    for (const key of Object.keys(T)) this.cur[key] = lerp(this.cur[key], T[key], k);
    if (this.autoWeather) { this.weatherT -= dt; if (this.weatherT < 0) { this.weatherT = 90 + Math.random() * 90; const r = Math.random(); this.weatherName = r < 0.4 ? 'clear' : r < 0.6 ? 'cloudy' : r < 0.72 ? 'fog' : r < 0.9 ? 'rain' : 'storm'; } }
    this.wetness = clamp(this.wetness + (this.cur.rain > 0.15 ? 0.04 : -0.012) * dt, 0, 1);

    const ang = (this.time - 6) / 24 * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.9, Math.sin(ang), 0.35).normalize();
    this.sunDir.copy(dir);
    const dayF = smoothstep(-0.08, 0.25, dir.y);
    this.night = 1 - smoothstep(-0.12, 0.08, dir.y);
    const cloud = this.cur.cloud;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(dir); u.turbidity.value = lerp(3, 18, cloud); u.rayleigh.value = lerp(1.6, 0.4, cloud);
    u.mieCoefficient.value = lerp(0.005, 0.03, cloud); u.mieDirectionalG.value = 0.8;
    this.renderer.toneMappingExposure = lerp(0.55, 0.3, cloud * 0.6) * lerp(0.7, 1, dayF);
    this.sun.position.copy(focus).addScaledVector(dir, 250); this.sun.target.position.copy(focus);
    this.sun.intensity = 3.6 * dayF * lerp(1, 0.25, cloud * 0.9);
    this.sun.color.setRGB(1, lerp(0.55, 0.96, smoothstep(0, 0.4, dir.y)), lerp(0.3, 0.9, smoothstep(0, 0.4, dir.y)));
    this.moon.position.copy(focus).addScaledVector(dir, -250); this.moon.target = this.sun.target; this.moon.intensity = 0.25 * this.night;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.hemi.intensity = lerp(0.04, 0.7, dayF) * lerp(1, 0.6, cloud) + this.flash * 2;
    this.scene.environmentIntensity = (0.06 + 0.9 * dayF) * lerp(1, 0.7, cloud);
    this.stars.material.opacity = this.night * (1 - cloud);
    this.stars.position.copy(camPos);

    const horizon = new THREE.Color().setRGB(0.62, 0.72, 0.85).lerp(new THREE.Color(0.9, 0.55, 0.35), 1 - smoothstep(0, 0.35, dir.y) * 1).multiplyScalar(lerp(0.02, 1, dayF));
    horizon.lerp(new THREE.Color(0.5, 0.53, 0.57).multiplyScalar(lerp(0.03, 1, dayF)), cloud * 0.6);
    this.scene.fog.color.copy(horizon); this.scene.fog.density = this.cur.fog;

    // sky refresh for reflections
    this.envT -= dt;
    if (this.envT <= 0) {
      this.envT = 6;
      const e = this.envSky.material.uniforms;
      for (const k2 of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) e[k2].value = u[k2].value;
      e.sunPosition.value.copy(dir);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100000);
      if (this.envRT) this.envRT.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }

    // clouds
    const dayCol = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.35, 0.37, 0.42), cloud * 0.8).multiplyScalar(lerp(0.06, 1, dayF));
    for (const s of this.clouds) {
      const d = s.userData, wind = this.cur.wind * 20;
      d.bx += wind * dt;
      const rx = ((d.bx - focus.x + 3500) % 7000 + 7000) % 7000 - 3500, rz = ((d.bz - focus.z + 3500) % 7000 + 7000) % 7000 - 3500;
      s.position.set(focus.x + rx, d.hh, focus.z + rz);
      s.material.color.copy(dayCol);
      s.material.opacity = clamp((cloud * 1.3 - d.vis * 0.5), 0, 0.9) * (1 - Math.hypot(rx, rz) / 4800);
    }

    // rain
    const n = Math.floor(4000 * this.cur.rain);
    this.rainGeo.setDrawRange(0, n * 2);
    this.rain.visible = n > 0;
    if (n > 0) {
      this.rainT += dt * 28;
      const p = this.rainGeo.attributes.position.array, sl = this.cur.wind * 4;
      for (let i = 0; i < n; i++) {
        const b = this.rainBase[i], y = ((b[1] - this.rainT) % 40 + 40) % 40;
        const x = camPos.x + b[0] + y * sl * 0.1, z = camPos.z + b[2];
        p.set([x, camPos.y + y - 10, z, x - sl * 0.08, camPos.y + y - 10 + 0.8, z], i * 6);
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }
    // lightning
    if (this.weatherName === 'storm') {
      this.lightningT -= dt;
      if (this.lightningT < 0) {
        this.lightningT = 4 + Math.random() * 10; this.flash = 1;
        const a = Math.random() * 6.28, r = 600 + Math.random() * 800, pts = [];
        let x = camPos.x + Math.cos(a) * r, z = camPos.z + Math.sin(a) * r, y = 900;
        while (y > 0) { pts.push(new THREE.Vector3(x, y, z)); x += (Math.random() - 0.5) * 60; z += (Math.random() - 0.5) * 60; y -= 60; }
        this.bolt.geometry.setFromPoints(pts); this.bolt.visible = true; setTimeout(() => (this.bolt.visible = false), 140);
        if (this.onThunder) this.onThunder(r / 340);
      }
    }
  }
}
