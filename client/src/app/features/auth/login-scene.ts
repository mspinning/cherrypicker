import gsap from 'gsap';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CHERRY_HEIGHT, CherryAnchor } from './cherry-anchor';

export type SceneMood = 'idle' | 'busy' | 'error';

const COLOR = {
  coral: new THREE.Color('#FF7A55'),
  cream: new THREE.Color('#F4F1EA'),
  lime: new THREE.Color('#C8F169'),
};

/** Logo coordinates (30×30 SVG, y down) → scene units centred on the logo. */
const v = (x: number, y: number, z = 0) => new THREE.Vector3((x - 15) / 10, -(y - 15) / 10, z);

/** Where both stems meet; the cherries swing around this point. */
const STEM_TOP = v(21, 4.5);

const PARTICLE_COUNT = 1600;

const particleVertex = /* glsl */ `
  uniform float uFlow;
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aSeed;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    p.y = mod(p.y + uFlow * (0.35 + aSeed * 0.65) + 8.0, 16.0) - 8.0;
    p.x += sin(uTime * 0.3 + aSeed * 6.2831) * 0.22;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (9.0 / -mv.z);
    vColor = aColor;
    vAlpha = aAlpha * smoothstep(8.0, 6.0, abs(p.y));
  }
`;

const particleFragment = /* glsl */ `
  uniform float uFade;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.08, d) * vAlpha * uFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uOpacity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

/**
 * The login backdrop: the Cherrypick logo as a glossy 3D cherry pair floating in
 * a slow field of particles – the few things that matter, picked out of the noise.
 */
export class LoginScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pmrem: THREE.PMREMGenerator;

  /** Positioned by layout + float + shake */
  private readonly hero = new THREE.Group();
  /** Rotated towards the pointer; scaled by intro / success */
  private readonly cherries = new THREE.Group();
  private readonly swingA = new THREE.Group();
  private readonly swingB = new THREE.Group();
  private readonly leaf = new THREE.Group();
  private readonly berryA: THREE.Mesh;
  private readonly berryB: THREE.Mesh;

  private readonly particleUniforms = {
    uFlow: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uFade: { value: 0 },
  };
  private readonly glowUniforms = {
    uColor: { value: COLOR.cream.clone() },
    uOpacity: { value: 0 },
  };

  private readonly pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private readonly ndc = new THREE.Vector2();
  /** Tweened by moods / interactions */
  private readonly motion = { swing: 1, speed: 1, kickA: 0, kickB: 0, spin: 0, shake: 0 };
  private readonly layout = { x: 0, y: 0, scale: 1 };
  private anchor: CherryAnchor | null = null;
  private time = 0;
  private flow = 0;
  private hovering = false;
  private moodTween?: gsap.core.Timeline;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.camera.position.set(0, 0, 7);

    this.addLights();
    this.addGlow();
    [this.berryA, this.berryB] = this.addCherries();
    this.addParticles();
    this.scene.add(this.hero);
    this.hero.add(this.cherries);
    this.cherries.scale.setScalar(0.001);

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.setAnimationLoop(this.tick);
  }

  /** Cherries pop in, particles fade up. */
  intro(): gsap.core.Timeline {
    const tl = gsap.timeline();
    const duration = this.reducedMotion ? 0 : 1;
    tl.to(this.cherries.scale, { x: 1, y: 1, z: 1, duration: duration * 1.6, ease: 'elastic.out(1, 0.55)' }, 0.15)
      .fromTo(this.cherries.rotation, { y: -1.4 }, { y: 0, duration: duration * 1.8, ease: 'power3.out' }, 0.15)
      .to(this.particleUniforms.uFade, { value: 1, duration: duration * 1.4, ease: 'power2.out' }, 0)
      .to(this.glowUniforms.uOpacity, { value: 0.07, duration: duration * 1.2 }, 0.2);
    return tl;
  }

  /** Pins the cherries to a spot on the page (CSS px), e.g. above the headline. `null` = default layout. */
  setAnchor(anchor: CherryAnchor | null): void {
    this.anchor = anchor;
    this.resize();
  }

  setMood(mood: SceneMood): void {
    this.moodTween?.kill();
    const tl = (this.moodTween = gsap.timeline());
    if (mood === 'busy') {
      tl.to(this.motion, { swing: 2.6, speed: 3.2, duration: 0.6, ease: 'power2.out' }, 0)
        .to(this.glowUniforms.uColor.value, { ...rgb(COLOR.lime), duration: 0.4 }, 0)
        .to(this.glowUniforms.uOpacity, { value: 0.14, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }, 0);
    } else if (mood === 'error') {
      tl.to(this.motion, { swing: 1, speed: 1, duration: 0.5 }, 0)
        .to(this.glowUniforms.uColor.value, { ...rgb(COLOR.coral), duration: 0.2 }, 0)
        .to(this.glowUniforms.uOpacity, { value: 0.2, duration: 0.2 }, 0)
        .fromTo(this.motion, { shake: 1 }, { shake: 0, duration: 0.7, ease: 'power2.out' }, 0)
        .to(this.glowUniforms.uColor.value, { ...rgb(COLOR.cream), duration: 1.2 }, 1.1)
        .to(this.glowUniforms.uOpacity, { value: 0.07, duration: 1.2 }, 1.1);
    } else {
      tl.to(this.motion, { swing: 1, speed: 1, duration: 0.8 }, 0)
        .to(this.glowUniforms.uColor.value, { ...rgb(COLOR.cream), duration: 0.8 }, 0)
        .to(this.glowUniforms.uOpacity, { value: 0.07, duration: 0.8 }, 0);
    }
  }

  /** Signed in: the cherries spin, grow and rush towards the viewer. */
  celebrate(): gsap.core.Timeline {
    this.moodTween?.kill();
    const tl = gsap.timeline();
    tl.to(this.glowUniforms.uColor.value, { ...rgb(COLOR.lime), duration: 0.3 }, 0)
      .to(this.glowUniforms.uOpacity, { value: 0.4, duration: 0.4 }, 0)
      .to(this.motion, { speed: 14, swing: 3, duration: 1.1, ease: 'power2.in' }, 0)
      .to(this.motion, { spin: Math.PI * 2, duration: 1.3, ease: 'power3.inOut' }, 0.1)
      .to(this.cherries.scale, { x: 2.6, y: 2.6, z: 2.6, duration: 1.2, ease: 'power3.in' }, 0.25)
      .to(this.camera.position, { z: 3.2, duration: 1.2, ease: 'power3.in' }, 0.25);
    return tl;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    document.body.style.cursor = '';
    this.moodTween?.kill();
    gsap.killTweensOf([this.motion, this.cherries.scale, this.cherries.rotation, this.camera.position]);
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }

  // ---------- Build ----------

  private addLights(): void {
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 4, 5);
    const rim = new THREE.PointLight(COLOR.lime, 14, 8, 1.6);
    rim.position.set(1.4, 1.6, -2);
    const fill = new THREE.PointLight(COLOR.coral, 6, 8, 1.6);
    fill.position.set(2.5, -2, 2);
    this.scene.add(key, rim, fill, new THREE.AmbientLight(0xffffff, 0.15));
  }

  private addGlow(): void {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShaderMaterial({
        uniforms: this.glowUniforms,
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.z = -1.6;
    this.hero.add(glow);
  }

  private addCherries(): [THREE.Mesh, THREE.Mesh] {
    const gloss = { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 };
    const coral = new THREE.MeshPhysicalMaterial({ color: COLOR.coral, ...gloss, sheen: 0.4, sheenColor: new THREE.Color('#FFB199') });
    const cream = new THREE.MeshPhysicalMaterial({ color: COLOR.cream, ...gloss, roughness: 0.3 });
    const stem = new THREE.MeshStandardMaterial({ color: COLOR.cream, roughness: 0.55 });
    const leafMat = new THREE.MeshStandardMaterial({
      color: COLOR.lime,
      roughness: 0.45,
      emissive: COLOR.lime,
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    });

    const berry = (center: THREE.Vector3, radius: number, material: THREE.Material, stemCurve: THREE.Curve<THREE.Vector3>, pivot: THREE.Group) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), material);
      mesh.position.copy(center).sub(STEM_TOP);
      // a hint of the dimple where the stem enters
      mesh.scale.set(1, 0.96, 1);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 64, 0.034, 12), stem);
      tube.position.copy(STEM_TOP).negate();
      pivot.position.copy(STEM_TOP);
      pivot.add(mesh, tube);
      this.cherries.add(pivot);
      return mesh;
    };

    const a = berry(
      v(9, 22.5, 0.16),
      0.58,
      coral,
      new THREE.CubicBezierCurve3(v(9.5, 17.5, 0.16), v(10.5, 12.5, 0.1), v(14.5, 7.5, 0.04), STEM_TOP),
      this.swingA,
    );
    const b = berry(
      v(20.8, 23, -0.16),
      0.53,
      cream,
      new THREE.CubicBezierCurve3(v(20.5, 18.5, -0.16), v(19.5, 13, -0.1), v(19.8, 8.5, -0.04), STEM_TOP),
      this.swingB,
    );

    // Leaf, traced from the logo path
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.32, 0.04, 0.56, -0.09, 0.68, -0.32);
    shape.bezierCurveTo(0.41, -0.42, 0.15, -0.35, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 3,
      curveSegments: 24,
    });
    this.leaf.add(new THREE.Mesh(leafGeo, leafMat));
    this.leaf.position.copy(STEM_TOP);
    this.leaf.rotation.set(0.3, -0.35, 0.05);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), stem);
    knot.position.copy(STEM_TOP);
    this.cherries.add(this.leaf, knot);

    // Centre the pair around its visual middle
    this.cherries.children.forEach((c) => c.position.add(new THREE.Vector3(0, 0.15, 0)));
    return [a, b];
  }

  private addParticles(): void {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const seeds = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 16, -12 + Math.random() * 13.5], i * 3);
      const roll = Math.random();
      // ~94 % grey noise, a few picked-out accents
      const accent = roll > 0.965 ? COLOR.lime : roll > 0.94 ? COLOR.coral : null;
      (accent ?? COLOR.cream).toArray(colors, i * 3);
      sizes[i] = accent ? 2.4 + Math.random() * 2.4 : 0.8 + Math.random() * 1.8;
      alphas[i] = accent ? 0.75 + Math.random() * 0.25 : 0.12 + Math.random() * 0.38;
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.particleUniforms,
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    points.frustumCulled = false;
    this.scene.add(points);
  }

  // ---------- Loop ----------

  private readonly tick = (timestamp: number) => {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const m = this.reducedMotion ? 0 : 1;
    this.time += dt * m;
    this.flow += dt * this.motion.speed * 0.12 * m;
    const t = this.time;

    // Smooth pointer
    this.pointer.sx += (this.pointer.x - this.pointer.sx) * 0.05;
    this.pointer.sy += (this.pointer.y - this.pointer.sy) * 0.05;
    const { sx, sy } = this.pointer;

    this.particleUniforms.uFlow.value = this.flow;
    this.particleUniforms.uTime.value = t;

    const shake = Math.sin(t * 60) * 0.09 * this.motion.shake;
    this.hero.position.set(this.layout.x + shake, this.layout.y + Math.sin(t * 0.9) * 0.06, 0);
    this.hero.scale.setScalar(this.layout.scale);

    this.cherries.rotation.y += (Math.sin(t * 0.25) * 0.35 + sx * 0.55 + this.motion.spin - this.cherries.rotation.y) * 0.06;
    this.cherries.rotation.x += (-sy * 0.22 + Math.sin(t * 0.4) * 0.04 - this.cherries.rotation.x) * 0.06;

    const swing = 0.05 * this.motion.swing;
    this.swingA.rotation.z = Math.sin(t * 1.4) * swing + this.motion.kickA;
    this.swingB.rotation.z = Math.sin(t * 1.4 + 0.9) * swing * 0.9 + this.motion.kickB;
    this.swingA.rotation.x = Math.cos(t * 1.1) * swing * 0.5;
    this.swingB.rotation.x = Math.cos(t * 1.1 + 1.3) * swing * 0.5;
    this.leaf.rotation.z = 0.05 + Math.sin(t * 1.7) * 0.06 * this.motion.swing;

    this.camera.position.x = sx * 0.3;
    this.camera.position.y = sy * 0.18;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  };

  // ---------- Events ----------

  private readonly resize = () => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.particleUniforms.uPixelRatio.value = pixelRatio;

    // Visible area at z = 0
    const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    const visibleW = visibleH * this.camera.aspect;
    if (this.anchor) {
      const worldPerPx = visibleH / height;
      this.layout.x = (this.anchor.x / width - 0.5) * visibleW;
      this.layout.y = -(this.anchor.y / height - 0.5) * visibleH;
      this.layout.scale = (this.anchor.height * worldPerPx) / CHERRY_HEIGHT;
    } else if (width >= 1024) {
      // Upper part of the left column, above the headline
      this.layout.x = -visibleW * 0.2;
      this.layout.y = visibleH * 0.17;
      this.layout.scale = Math.min(0.78, visibleH * 0.16);
    } else {
      // Top of the screen (≈ 8–30 % of the height), above the headline
      this.layout.x = 0;
      this.layout.y = visibleH * 0.31;
      this.layout.scale = Math.min(visibleW * 0.26, visibleH * 0.09);
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
    if (event.pointerType !== 'mouse') return;
    const hover = !this.isOverUi(event) && this.hitBerry(event) !== null;
    if (hover !== this.hovering) {
      this.hovering = hover;
      document.body.style.cursor = hover ? 'pointer' : '';
    }
  };

  /** Poke a cherry: it squashes and swings. */
  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.isOverUi(event)) return;
    const berry = this.hitBerry(event);
    if (!berry) return;
    const kick = berry === this.berryA ? 'kickA' : 'kickB';
    gsap.fromTo(berry.scale, { x: 1.14, y: 0.8, z: 1.14 }, { x: 1, y: 0.96, z: 1, duration: 1.1, ease: 'elastic.out(1, 0.3)' });
    gsap.fromTo(this.motion, { [kick]: berry === this.berryA ? -0.45 : 0.45 }, { [kick]: 0, duration: 2.2, ease: 'elastic.out(1, 0.2)' });
  };

  private isOverUi(event: PointerEvent): boolean {
    return (event.target as HTMLElement | null)?.closest('[data-ui]') != null;
  }

  private hitBerry(event: PointerEvent): THREE.Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects([this.berryA, this.berryB], false)[0];
    return (hit?.object as THREE.Mesh | undefined) ?? null;
  }
}

function rgb(color: THREE.Color) {
  return { r: color.r, g: color.g, b: color.b };
}
