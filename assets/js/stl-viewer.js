// Interactive 3D viewer for project pages (STL and GLB/glTF).
// Each page sets window.NX_MODELS = [{ name: 'Label', url: 'assets/models/file.glb' }, ...]
// Formats are picked by file extension and can be mixed. One model: no tabs.
// Several models: a tab per model. Empty list: the 3D section is hidden.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const models = window.NX_MODELS || [];
const section = document.getElementById('nx-3d');

if (section && !models.length) section.hidden = true;
if (section && models.length) init();

function init() {
  const viewer = document.getElementById('nx-viewer');
  const wrap = document.getElementById('nx-canvas-wrap');
  const stateEl = document.getElementById('nx-state');
  const stateTitle = stateEl.querySelector('h3');
  const stateText = stateEl.querySelector('p');
  const readout = document.getElementById('nx-readout');
  const btnRotate = document.getElementById('nx-rotate');
  const btnWire = document.getElementById('nx-wire');
  const btnReset = document.getElementById('nx-reset');

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181d);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  wrap.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotateSpeed = 1.2;

  // Lighting: a soft studio environment so surfaces always have something to reflect,
  // plus direct lights for shape
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x20262d, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 2);
  const fill = new THREE.DirectionalLight(0xffd9a0, 0.6);
  fill.position.set(-3, 1, -2);
  scene.add(key, fill);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9ced6, metalness: 0.2, roughness: 0.55, side: THREE.DoubleSide
  });
  const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  let mesh = null, grid = null;

  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  let current = null;   // the object currently in the scene
  let wire = false;

  function clearScene() {
    if (current) { scene.remove(current); current = null; }   // loaded data is cached, so don't dispose
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
    readout.textContent = '';
  }

  function applyWire(obj) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.wireframe = wire; });
    });
  }

  const fmt = n => +n.toPrecision(3);

  // Frame an object: centre it, sit it on the floor, aim the camera
  function present(obj, label, sizeVec, tris) {
    clearScene();
    obj.position.set(0, 0, 0);
    scene.add(obj);
    current = obj;
    applyWire(obj);

    let box = new THREE.Box3().setFromObject(obj);
    obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    box.setFromObject(obj);
    const dims = new THREE.Vector3(); box.getSize(dims);
    const radius = Math.max(dims.x, dims.y, dims.z);

    grid = new THREE.GridHelper(radius * 2.4, 24, 0x3a434e, 0x242b33);
    scene.add(grid);

    const centre = new THREE.Vector3(0, dims.y / 2, 0);
    const dist = radius * 1.9;
    camera.position.set(dist * 0.8, dist * 0.65 + dims.y / 2, dist * 0.9);
    camera.near = radius / 100; camera.far = radius * 40;
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.update();
    home.pos.copy(camera.position); home.target.copy(centre);

    const sz = sizeVec || dims;
    readout.innerHTML =
      `<b>${label}</b> · ${fmt(sz.x)} × ${fmt(sz.y)} × ${fmt(sz.z)} · ${tris.toLocaleString()} triangles`;
    stateEl.hidden = true;
  }

  // ---- Format handling ----
  const stlLoader = new STLLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);          // Draco-compressed GLBs
  gltfLoader.setMeshoptDecoder(MeshoptDecoder); // meshopt-compressed GLBs

  function fromStlGeometry(geometry) {
    // Some CAD exports store empty (0,0,0) normals, which renders solid black,
    // so always recompute them from the triangles.
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // CAD is Z-up, three.js is Y-up
    const holder = new THREE.Group();   // keeps the rotation separate from placement
    holder.add(mesh);
    return { object: holder, size, tris: geometry.attributes.position.count / 3 };
  }

  function fromGltf(gltf) {
    const obj = gltf.scene;                // glTF is already Y-up with its own materials
    let tris = 0;
    obj.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { object: obj, size: null, tris };
  }

  const extOf = url => url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();

  function loadAny(url) {
    const ext = extOf(url);
    return new Promise((resolve, reject) => {
      if (ext === 'stl') stlLoader.load(url, g => resolve(fromStlGeometry(g)), undefined, reject);
      else if (ext === 'glb' || ext === 'gltf') gltfLoader.load(url, g => resolve(fromGltf(g)), undefined, reject);
      else reject(new Error('Unsupported format: .' + ext));
    });
  }

  // Loading, with a cache so switching tabs back is instant
  const cache = new Map();
  let token = 0;

  function select(i) {
    const m = models[i];
    const mine = ++token;
    if (cache.has(m.url)) { const e = cache.get(m.url); present(e.object, m.name, e.size, e.tris); return; }

    clearScene();
    stateTitle.textContent = 'Loading model…';
    stateText.textContent = '';
    stateEl.hidden = false;

    loadAny(m.url).then(
      e => { cache.set(m.url, e); if (mine === token) present(e.object, m.name, e.size, e.tris); },
      () => {
        if (mine !== token) return;
        stateTitle.textContent = 'Could not load this model';
        stateText.innerHTML = `Expected a .stl or .glb file at <code></code>`;
        stateText.querySelector('code').textContent = m.url;
      }
    );
  }

  // Tabs (only when there is more than one model)
  if (models.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'nx-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '3D models');
    const buttons = models.map((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nx-tab';
      b.setAttribute('role', 'tab');
      b.textContent = m.name;
      b.addEventListener('click', () => activate(i));
      tabs.appendChild(b);
      return b;
    });
    function activate(i, focus) {
      buttons.forEach((b, j) => {
        b.setAttribute('aria-selected', j === i);
        b.tabIndex = j === i ? 0 : -1;
      });
      if (focus) buttons[i].focus();
      select(i);
    }
    tabs.addEventListener('keydown', e => {
      const cur = buttons.findIndex(b => b.getAttribute('aria-selected') === 'true');
      if (e.key === 'ArrowRight') { e.preventDefault(); activate((cur + 1) % buttons.length, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); activate((cur - 1 + buttons.length) % buttons.length, true); }
    });
    viewer.insertBefore(tabs, viewer.firstChild);
    activate(0);
  } else {
    select(0);
  }

  // Drag an .stl or .glb file onto the viewer to inspect it
  ['dragenter', 'dragover'].forEach(t => viewer.addEventListener(t, e => { e.preventDefault(); viewer.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => viewer.addEventListener(t, e => { e.preventDefault(); viewer.classList.remove('drag'); }));
  viewer.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = extOf(file.name);
    if (ext !== 'stl' && ext !== 'glb') return;
    file.arrayBuffer().then(buf => {
      token++;
      if (ext === 'stl') {
        try { const r = fromStlGeometry(stlLoader.parse(buf)); present(r.object, file.name, r.size, r.tris); } catch { /* unreadable */ }
      } else {
        gltfLoader.parse(buf, '', g => { const r = fromGltf(g); present(r.object, file.name, r.size, r.tris); }, () => {});
      }
    });
  });

  // Controls
  btnRotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    btnRotate.setAttribute('aria-pressed', controls.autoRotate);
  });
  btnWire.addEventListener('click', () => {
    wire = !wire;
    if (current) applyWire(current);
    btnWire.setAttribute('aria-pressed', wire);
  });
  btnReset.addEventListener('click', () => {
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
  });

  // Only render while the viewer is on screen
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(wrap);

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    controls.update();
    renderer.render(scene, camera);
  });
}