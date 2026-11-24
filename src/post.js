import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Cinematic grade: speed blur, chromatic aberration, split-toning, saturation/contrast, vignette, film grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uVig: { value: 0.38 }, uGrain: { value: 0.05 },
    uCA: { value: 0.0016 }, uSat: { value: 1.12 }, uContrast: { value: 1.1 },
    uHi: { value: new THREE.Vector3(1, 1, 1) }, uLo: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uVig, uGrain, uCA, uSat, uContrast; uniform vec3 uHi, uLo; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5; float d = length(c);
      float blur = uSpeed * 0.04 * smoothstep(0.08, 0.6, d);
      float ca = uCA * (0.3 + d * 2.2);
      vec3 col = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float t = float(i) / 5.0; vec2 o = -c * blur * t;
        col.r += texture2D(tDiffuse, vUv + o + c * ca).r;
        col.g += texture2D(tDiffuse, vUv + o).g;
        col.b += texture2D(tDiffuse, vUv + o - c * ca).b;
      }
      col /= 6.0;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = mix(col * uLo, col * uHi, smoothstep(0.0, 1.2, l));
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      col *= 1.0 - uVig * smoothstep(0.32, 0.95, d * 1.3);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5) * uGrain * (1.0 - clamp(l, 0.0, 1.0) * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Removes NaN / Infinity from the HDR buffer so one bad pixel can never smear into a black block through the bloom. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0); gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), 1.0); }',
};

export function createPost(renderer, scene, camera) {
  const post = { composer: null, bloom: null, grade: null, q: { msaa: 2 } };

  function build() {
    if (post.composer) {
      post.composer.renderTarget1.dispose(); post.composer.renderTarget2.dispose();
      post.composer.passes.forEach((p) => p.dispose?.());
    }
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: post.q.msaa });
    const composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr); composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new ShaderPass(SanitizeShader));
    post.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.7, 2.2);
    composer.addPass(post.bloom);
    post.grade = new ShaderPass(GradeShader);
    composer.addPass(post.grade);
    composer.addPass(new OutputPass());          // ACES tone mapping + sRGB
    post.composer = composer;
  }
  build();

  post.setQuality = (q) => { post.q = q; build(); };
  post.resize = (w, h) => { post.composer.setPixelRatio(renderer.getPixelRatio()); post.composer.setSize(w, h); };
  post.render = (dt) => post.composer.render(dt);
  return post;
}
