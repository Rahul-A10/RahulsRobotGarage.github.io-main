// Interactive STL viewer for project pages.
// Each page sets window.NX_MODELS = [{ name: 'Label', url: 'assets/models/file.stl' }, ...]
// One model: no tabs. Several models: a tab per model. Empty list: the 3D section is hidden.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

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

  // Lighting
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x20262d, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
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

  function clearScene() {
    if (mesh) { scene.remove(mesh); mesh = null; }          // geometry is cached, so don't dispose
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
    readout.textContent = '';
  }

  function prepare(geometry) {
    if (geometry.userData.ready) return geometry;
    // Some CAD exports store empty (0,0,0) normals, which renders solid black,
    // so always recompute them from the triangles.
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const c = new THREE.Vector3();
    geometry.boundingBox.getCenter(c);
    geometry.translate(-c.x, -c.y, -c.z);
    geometry.userData = { ready: true, size };
    return geometry;
  }

  function showModel(geometry, label) {
    clearScene();
    prepare(geometry);
    const size = geometry.userData.size;

    mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // CAD is Z-up, three.js is Y-up
    scene.add(mesh);

    // Sit the model on the floor
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.y -= box.min.y;
    box.setFromObject(mesh);
    const dims = new THREE.Vector3(); box.getSize(dims);
    const radius = Math.max(dims.x, dims.y, dims.z);

    grid = new THREE.GridHelper(radius * 2.4, 24, 0x3a434e, 0x242b33);
    scene.add(grid);

    // Frame the camera
    const centre = new THREE.Vector3(0, dims.y / 2, 0);
    const dist = radius * 1.9;
    camera.position.set(dist * 0.8, dist * 0.65 + dims.y / 2, dist * 0.9);
    camera.near = radius / 100; camera.far = radius * 40;
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.update();
    home.pos.copy(camera.position); home.target.copy(centre);

    const tris = (geometry.attributes.position.count / 3).toLocaleString();
    readout.innerHTML =
      `<b>${label}</b> · ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} · ${tris} triangles`;
    stateEl.hidden = true;
  }

  // Loading, with a cache so switching tabs back is instant
  const loader = new STLLoader();
  const cache = new Map();
  let token = 0;

  function select(i) {
    const m = models[i];
    const mine = ++token;
    if (cache.has(m.url)) { showModel(cache.get(m.url), m.name); return; }

    clearScene();
    stateTitle.textContent = 'Loading model…';
    stateText.textContent = '';
    stateEl.hidden = false;

    loader.load(
      m.url,
      g => { cache.set(m.url, g); if (mine === token) showModel(g, m.name); },
      undefined,
      () => {
        if (mine !== token) return;
        stateTitle.textContent = 'Could not load this model';
        stateText.innerHTML = `Expected a file at <code></code>`;
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

  // Drag any .stl file onto the viewer to inspect it
  ['dragenter', 'dragover'].forEach(t => viewer.addEventListener(t, e => { e.preventDefault(); viewer.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => viewer.addEventListener(t, e => { e.preventDefault(); viewer.classList.remove('drag'); }));
  viewer.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (!file || !/\.stl$/i.test(file.name)) return;
    file.arrayBuffer().then(buf => {
      try { token++; showModel(new STLLoader().parse(buf), file.name); } catch { /* ignore unreadable files */ }
    });
  });

  // Controls
  btnRotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    btnRotate.setAttribute('aria-pressed', controls.autoRotate);
  });
  btnWire.addEventListener('click', () => {
    material.wireframe = !material.wireframe;
    btnWire.setAttribute('aria-pressed', material.wireframe);
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
