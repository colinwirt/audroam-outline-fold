import * as THREE from 'three';
import {
  parse,
  toggleFold,
  isCollapsed,
} from '../../dist/index.js';

const SAMPLE = `---
fold-: design, secret
---
- <id:design> Designing updates for Markmap (+)
  - <id:todo-1> Wire fold
  - <id:secret> <private> Payroll (+)
- <id:vault> <encrypted> Client keys
- <id:site> <kind:globe> Website
`;

let doc = parse(SAMPLE);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0f);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(3, 5, 4);
scene.add(dir);

const pickables = [];

function clearNodes() {
  for (const o of pickables) {
    scene.remove(o);
    o.geometry.dispose();
    o.material.dispose();
  }
  pickables.length = 0;
}

function addNodes(nodes, x, y, z, spread) {
  nodes.forEach((n, i) => {
    const collapsed = n.id ? isCollapsed(doc, n.id) : false;
    const locked = n.flags?.includes('private') || n.flags?.includes('encrypted');
    const color = locked ? 0x444444 : collapsed ? 0xc9a227 : 0x44aa99;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 16),
      new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
    );
    const px = x + (i - (nodes.length - 1) / 2) * spread;
    mesh.position.set(px, y, z);
    mesh.userData.id = n.id;
    scene.add(mesh);
    pickables.push(mesh);
    if (!collapsed && n.children?.length) {
      addNodes(n.children, px, y - 1.2, z - 1.4, spread * 0.7);
    }
  });
}

function rebuild() {
  clearNodes();
  addNodes(doc.nodes, 0, 2, 0, 3.2);
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (ev) => {
  mouse.x = (ev.clientX / innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickables);
  if (hits[0]?.object.userData.id) {
    doc = toggleFold(doc, hits[0].object.userData.id);
    rebuild();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

rebuild();
(function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
})();
