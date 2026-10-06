import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadDoc } from '../_shared/parseDoc.js';
import { findNode, listSealed, loadDemoPassword, openAll, tryUnlock } from '../_shared/unlock.js';
import { toggleFold, isCollapsed } from '../../dist/index.js';

let { doc } = await loadDoc(new URL('../cafe-map.md', import.meta.url));
const revealed = {};
const sealedIds = listSealed(doc.nodes).map((n) => n.id);
const demoPassword = sealedIds.length ? await loadDemoPassword() : null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0f);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// Node captions are HTML, kept over each sphere by CSS2DRenderer.
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = 'labels';
document.body.appendChild(labelRenderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(3, 5, 4);
scene.add(dir);

const SLOT = 2.4; // x gap between leaves
const DY = 2.6;
const DZ = 0.6;
const pickables = [];
const labels = [];
let halfWidth = 0;
let depth = 0;

const isLocked = (n) => n.flags?.includes('private') || n.flags?.includes('encrypted');

/** Leaves take the next x slot; a parent sits over its first and last child. */
function place(nodes, d, next, out) {
  const xs = [];
  for (const n of nodes) {
    const open = n.children?.length && !(n.id && isCollapsed(doc, n.id));
    const kids = open ? place(n.children, d + 1, next, out) : null;
    const x = kids ? (kids[0] + kids[kids.length - 1]) / 2 : next.slot++ * SLOT;
    out.push({ n, x, d });
    xs.push(x);
  }
  return xs;
}

function labelFor(n) {
  const el = document.createElement('div');
  el.className = 'label';
  el.dataset.id = n.id;
  el.textContent = n.title;
  let state = null;
  if (isLocked(n)) {
    el.dataset.state = revealed[n.id] != null ? 'unlocked' : 'locked';
    state = revealed[n.id] ?? '🔒 locked';
  } else if (n.id && isCollapsed(doc, n.id)) {
    state = '(+)';
  }
  if (state) {
    const s = document.createElement('span');
    s.className = 'state';
    s.textContent = state;
    el.append(s);
  }
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0); // top edge just under the sphere
  return obj;
}

function clearNodes() {
  for (const o of [...pickables, ...labels]) {
    scene.remove(o);
    o.geometry?.dispose();
    o.material?.dispose();
  }
  pickables.length = 0;
  labels.length = 0;
}

/**
 * Back the camera off until the tree fits the window, then cap label width at
 * one leaf slot on the deepest row so captions wrap, not overlap.
 */
function fit() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const z = Math.max(10, (halfWidth + SLOT / 2) / (t * camera.aspect), ((depth + 1) * DY) / 2 / t);
  camera.position.set(0, 1.5, z);
  camera.lookAt(0, (-depth * DY) / 2, (-depth * DZ) / 2);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const a = new THREE.Vector3(0, -depth * DY, -depth * DZ).project(camera);
  const b = new THREE.Vector3(SLOT, -depth * DY, -depth * DZ).project(camera);
  const slotPx = ((b.x - a.x) * innerWidth) / 2;
  labelRenderer.domElement.style.setProperty('--label-w', `${Math.floor(Math.min(160, slotPx - 12))}px`);
}

function rebuild() {
  clearNodes();
  const rows = [];
  const next = { slot: 0 };
  place(doc.nodes, 0, next, rows);
  halfWidth = ((next.slot - 1) * SLOT) / 2;
  depth = Math.max(...rows.map((r) => r.d));
  for (const { n, x, d } of rows) {
    const collapsed = n.id ? isCollapsed(doc, n.id) : false;
    const color = isLocked(n) && revealed[n.id] == null ? 0x444444 : collapsed ? 0xc9a227 : 0x44aa99;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 16),
      new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
    );
    mesh.position.set(x - halfWidth, -d * DY, -d * DZ);
    mesh.userData.id = n.id;
    const label = labelFor(n);
    label.position.set(mesh.position.x, mesh.position.y - 0.35, mesh.position.z);
    scene.add(mesh, label);
    pickables.push(mesh);
    labels.push(label);
  }
  fit();
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (ev) => {
  mouse.x = (ev.clientX / innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const id = raycaster.intersectObjects(pickables)[0]?.object.userData.id;
  if (!id) return;
  const node = findNode(doc.nodes, id);
  if (node?.sealed && revealed[id] == null) {
    void tryUnlock({ getDoc: () => doc, setDoc: (d) => (doc = d), id, revealed, refresh: rebuild, demoPassword });
    return;
  }
  doc = toggleFold(doc, id);
  rebuild();
});

if (demoPassword) {
  document.getElementById('demoPw').textContent = demoPassword;
  document.getElementById('demoUnlock').hidden = false;
  document.getElementById('btnUnlockAll').addEventListener('click', () => {
    void openAll({ getDoc: () => doc, setDoc: (d) => (doc = d), ids: sealedIds, revealed, refresh: rebuild, password: demoPassword });
  });
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  fit();
});

rebuild();
(function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
})();
