/**
 * Three presenter — roam demo only (not full quest/combat parity with Phaser).
 * Prefer Phaser scaffold for product worlds.
 */
import * as THREE from 'three';

type Vec2 = { x: number; y: number };
type WorldEntity = {
  id: string;
  kind: string;
  name: string;
  regionId: string;
  pos: Vec2;
  dialogueSeed?: string;
};
type WorldRegion = { id: string; name: string; width: number; height: number };
type WorldSpec = {
  meta: { title: string };
  styleAnchor?: { artStyle?: string; palette?: string[]; mood?: string };
  space: { regions: WorldRegion[]; startRegionId: string };
  entities: WorldEntity[];
  narrative: {
    quests: Array<{ title: string; status: string }>;
    flags: Record<string, boolean>;
  };
  presentation?: {
    agenticDiff?: { opsApplied: number; afterRegions: number; beforeRegions: number; afterQuests: number; beforeQuests: number };
    cinematicEnabled?: boolean;
    spatialAssets?: Record<string, { videoUrl?: string; assetUrl?: string }>;
  };
  timeHours: number;
};

type AssetBrief = {
  palette?: string[];
  assetQuality?: string;
  assets?: Array<{ role?: string; file?: string }>;
  placeholders?: Array<{ role?: string; file?: string }>;
  audio?: Array<{ id?: string; file?: string; role?: string }>;
};

async function loadWorld(): Promise<WorldSpec> {
  const res = await fetch('./world.json');
  return (await res.json()) as WorldSpec;
}

async function loadAssetBrief(): Promise<AssetBrief | null> {
  try {
    const res = await fetch('./ASSET_BRIEF.json');
    if (!res.ok) return null;
    return (await res.json()) as AssetBrief;
  } catch {
    return null;
  }
}

function mountL3Poster(world: WorldSpec, container: HTMLElement): void {
  const start = world.space.startRegionId;
  const slot = world.presentation?.spatialAssets?.[start];
  const url = slot?.videoUrl ?? slot?.assetUrl;
  if (!url || url.startsWith('data:application/json')) return;
  const isVideo =
    url.startsWith('data:video/') || /\.(mp4|webm)(\?|$)/i.test(url);
  const el = document.createElement(isVideo ? 'video' : 'img') as
    | HTMLVideoElement
    | HTMLImageElement;
  el.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.22;pointer-events:none;z-index:0;';
  if (isVideo) {
    const v = el as HTMLVideoElement;
    v.src = url;
    v.muted = true;
    v.autoplay = true;
    v.loop = true;
    v.playsInline = true;
  } else {
    (el as HTMLImageElement).src = url;
    (el as HTMLImageElement).alt = 'L3 poster';
  }
  container.style.position = 'relative';
  container.prepend(el);
}

function main(world: WorldSpec, brief: AssetBrief | null): void {
  const region =
    world.space.regions.find((r) => r.id === world.space.startRegionId) ??
    world.space.regions[0]!;
  const hud = document.getElementById('hud')!;
  const container = document.getElementById('game-container')!;

  mountL3Poster(world, container);

  const palette = brief?.palette ?? world.styleAnchor?.palette ?? ['#2d6a4f'];
  const groundHex = palette[0] ?? '#2d6a4f';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(groundHex);
  scene.fog = new THREE.Fog(new THREE.Color(groundHex).getHex(), 20, 60);

  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    200,
  );
  camera.position.set(region.width / 2, 18, region.height / 2 + 14);
  camera.lookAt(region.width / 2, 0, region.height / 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xd8f3dc, 0x1b4332, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3b0, 0.7);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  const loader = new THREE.TextureLoader();
  const roleList = brief?.assets?.length
    ? brief.assets
    : brief?.placeholders;
  const roleFile = (role: string, fallback: string) =>
    roleList?.find((p) => p.role === role)?.file ?? fallback;

  // MiniMax BGM when brief lists audio (browser may require user gesture)
  const bgmUrl =
    brief?.audio?.find((a) => a.id === 'bgm' || a.role === 'bgm')?.file ??
    './assets/bgm.mp3';
  try {
    const bgm = new Audio(bgmUrl);
    bgm.loop = true;
    bgm.volume = 0.35;
    void bgm.play().catch(() => undefined);
  } catch {
    // optional
  }

  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(groundHex),
    roughness: 0.9,
  });
  const groundTexUrl = roleFile('tile', './assets/ground.png');
  loader.load(
    groundTexUrl,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(region.width / 2, region.height / 2);
      groundMat.map = tex;
      groundMat.needsUpdate = true;
    },
    undefined,
    () => undefined,
  );

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(region.width, region.height),
    groundMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(region.width / 2, 0, region.height / 2);
  scene.add(ground);

  const grid = new THREE.GridHelper(
    Math.max(region.width, region.height),
    24,
    0x40916c,
    0x1b4332,
  );
  grid.position.set(region.width / 2, 0.02, region.height / 2);
  scene.add(grid);

  const meshes = new Map<string, THREE.Mesh>();
  const kindTex: Record<string, string> = {
    player: roleFile('player', './assets/player.png'),
    npc: roleFile('npc', './assets/npc.png'),
    enemy: roleFile('enemy', './assets/enemy.png'),
    item: roleFile('item', './assets/item.png'),
  };

  for (const e of world.entities.filter((x) => x.regionId === region.id)) {
    const color =
      e.kind === 'player'
        ? 0xf4a261
        : e.kind === 'npc'
          ? 0xe76f51
          : e.kind === 'enemy'
            ? 0xd00000
            : 0x264653;
    const mat = new THREE.MeshStandardMaterial({ color });
    const texUrl = kindTex[e.kind];
    if (texUrl) {
      loader.load(
        texUrl,
        (tex) => {
          mat.map = tex;
          mat.needsUpdate = true;
        },
        undefined,
        () => undefined,
      );
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, e.kind === 'player' ? 1.2 : 1, 0.7),
      mat,
    );
    mesh.position.set(e.pos.x + 0.5, 0.6, e.pos.y + 0.5);
    scene.add(mesh);
    meshes.set(e.id, mesh);
  }

  const player = world.entities.find((e) => e.kind === 'player')!;
  const keys = new Set<string>();
  window.addEventListener('keydown', (ev) => keys.add(ev.key.toLowerCase()));
  window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));

  let cooldown = 0;
  function refreshHud(): void {
    const q = world.narrative.quests
      .filter((x) => x.status === 'active' || x.status === 'completed')
      .map((x) => `${x.title}[${x.status}]`)
      .join(' | ');
    const l2 = world.presentation?.agenticDiff;
    const l2bit =
      l2 && l2.opsApplied > 0
        ? ` · L2 +${l2.afterRegions - l2.beforeRegions}r +${l2.afterQuests - l2.beforeQuests}q`
        : '';
    hud.textContent = `"${world.meta.title}" · ${region.name} · t=${Math.floor(world.timeHours)}h · ${q || 'no quests'}${l2bit} · WASD move · E talk`;
  }
  refreshHud();

  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() === 'e') {
      const npc = world.entities.find(
        (e) =>
          e.kind === 'npc' &&
          e.regionId === player.regionId &&
          Math.abs(e.pos.x - player.pos.x) <= 1 &&
          Math.abs(e.pos.y - player.pos.y) <= 1,
      );
      hud.textContent = npc
        ? `${npc.name}: ${npc.dialogueSeed ?? '...'}`
        : 'No one nearby.';
    }
    if (ev.key.toLowerCase() === 't') {
      world.timeHours += 1;
      refreshHud();
    }
  });

  function tick(dt: number): void {
    cooldown = Math.max(0, cooldown - dt);
    if (cooldown <= 0) {
      let dx = 0;
      let dy = 0;
      if (keys.has('a') || keys.has('arrowleft')) dx = -1;
      else if (keys.has('d') || keys.has('arrowright')) dx = 1;
      else if (keys.has('w') || keys.has('arrowup')) dy = -1;
      else if (keys.has('s') || keys.has('arrowdown')) dy = 1;
      if (dx || dy) {
        cooldown = 0.14;
        player.pos.x = Math.max(0, Math.min(region.width - 1, player.pos.x + dx));
        player.pos.y = Math.max(0, Math.min(region.height - 1, player.pos.y + dy));
        const mesh = meshes.get(player.id);
        if (mesh) mesh.position.set(player.pos.x + 0.5, 0.6, player.pos.y + 0.5);
        camera.position.set(player.pos.x + 0.5, 14, player.pos.y + 12);
        camera.lookAt(player.pos.x + 0.5, 0, player.pos.y + 0.5);
        refreshHud();
      }
    }
  }

  let last = performance.now();
  function frame(now: number): void {
    const dt = (now - last) / 1000;
    last = now;
    tick(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

Promise.all([loadWorld(), loadAssetBrief()])
  .then(([world, brief]) => main(world, brief))
  .catch((err) => {
    const hud = document.getElementById('hud');
    if (hud) hud.textContent = String(err);
  });
