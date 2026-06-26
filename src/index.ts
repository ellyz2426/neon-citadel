// ============================================================
// NEON CITADEL VR - Holographic Tower Defense
// Built with IWSDK 0.4.x - playable in VR and browser
// ============================================================

import {
  World, createSystem, PanelUI, PanelDocument, UIKitDocument, UIKit,
  BoxGeometry, MeshStandardMaterial, MeshBasicMaterial, Mesh,
  Color, Group, PointLight, DirectionalLight, AmbientLight, FogExp2,
  LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicMaterial,
  SphereGeometry, CylinderGeometry, EdgesGeometry, Object3D,
  Follower, ScreenSpace, InputComponent,
  PlaneGeometry, RingGeometry, TorusGeometry, DoubleSide, ConeGeometry,
  Vector3, Raycaster, Vector2, OctahedronGeometry,
  AdditiveBlending,
  eq,
} from '@iwsdk/core';

interface RuntimeInput {
  keyboard?: { getKeyDown(key: string): boolean; getKeyPressed(key: string): boolean; };
  xr: { gamepads: Record<'left'|'right', {
    getButtonDown(id: string): boolean; getButtonValue(id: string): number;
    getAxesValues(id: string): { x: number; y: number } | undefined;
    gamepad?: Gamepad;
  } | undefined> };
}

// ============================================================
// TYPES
// ============================================================
type Screen = 'title' | 'playing' | 'paused' | 'gameover' | 'wave-complete' | 'tower-select' | 'help';
type TowerType = 'laser' | 'pulse' | 'slow' | 'sniper' | 'chain';
type EnemyType = 'grunt' | 'fast' | 'tank' | 'boss' | 'swarm' | 'ghost';

interface TowerDef {
  name: string;
  cost: number;
  damage: number;
  range: number;
  fireRate: number; // shots per second
  color: string;
  desc: string;
}

interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  reward: number;
  color: string;
  scale: number;
}

interface Tower {
  type: TowerType;
  gridR: number;
  gridC: number;
  group: Group;
  cooldown: number;
  level: number;
  kills: number;
  targetEntity: Enemy | null;
  barrelMesh: Mesh;
}

interface Enemy {
  type: EnemyType;
  hp: number;
  maxHp: number;
  speed: number;
  reward: number;
  pathIdx: number;
  pathProgress: number;
  group: Group;
  healthBar: Mesh;
  healthBg: Mesh;
  slowTimer: number;
  alive: boolean;
}

interface Projectile {
  mesh: Mesh;
  target: Enemy;
  speed: number;
  damage: number;
  type: TowerType;
  origin: Vector3;
}

interface WaveDef {
  enemies: Array<{ type: EnemyType; count: number; delay: number }>;
}

// ============================================================
// CONSTANTS
// ============================================================
const GRID_SIZE = 12;
const CELL_SIZE = 0.1;
const GRID_OFFSET = -(GRID_SIZE * CELL_SIZE) / 2 + CELL_SIZE / 2;
const BOARD_Y = 0.85;
const START_GOLD = 150;
const START_LIVES = 20;
const UPGRADE_COST_MULT = 1.5;

// Path waypoints on the grid (r, c) - enemies follow this
const PATH_COORDS: [number, number][] = [
  [0, 5], [1, 5], [2, 5], [2, 4], [2, 3], [2, 2],
  [3, 2], [4, 2], [5, 2], [5, 3], [5, 4], [5, 5],
  [5, 6], [5, 7], [5, 8], [5, 9],
  [6, 9], [7, 9], [8, 9], [9, 9],
  [9, 8], [9, 7], [9, 6], [9, 5], [9, 4], [9, 3],
  [10, 3], [11, 3],
];

const TOWER_DEFS: Record<TowerType, TowerDef> = {
  laser: { name: 'Laser', cost: 50, damage: 10, range: 2.5, fireRate: 2, color: '#00ffff', desc: 'Fast single-target beam' },
  pulse: { name: 'Pulse', cost: 80, damage: 6, range: 1.8, fireRate: 1.2, color: '#ff4488', desc: 'AoE pulse damage' },
  slow: { name: 'Slow', cost: 60, damage: 3, range: 2.0, fireRate: 1, color: '#44aaff', desc: 'Slows enemies in range' },
  sniper: { name: 'Sniper', cost: 120, damage: 40, range: 4.0, fireRate: 0.5, color: '#ffaa00', desc: 'High damage, slow fire' },
  chain: { name: 'Chain', cost: 100, damage: 8, range: 2.2, fireRate: 1.5, color: '#aa33ff', desc: 'Chains to nearby enemies' },
};

const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  grunt: { name: 'Grunt', hp: 30, speed: 0.8, reward: 10, color: '#ff3333', scale: 1.0 },
  fast: { name: 'Scout', hp: 15, speed: 1.8, reward: 12, color: '#ffaa00', scale: 0.7 },
  tank: { name: 'Heavy', hp: 100, speed: 0.4, reward: 25, color: '#8844ff', scale: 1.4 },
  boss: { name: 'Boss', hp: 300, speed: 0.3, reward: 100, color: '#ff0066', scale: 1.8 },
  swarm: { name: 'Swarm', hp: 10, speed: 1.2, reward: 5, color: '#33ff33', scale: 0.5 },
  ghost: { name: 'Ghost', hp: 40, speed: 1.0, reward: 20, color: '#ffffff', scale: 0.9 },
};

// Wave definitions
function generateWaves(count: number): WaveDef[] {
  const waves: WaveDef[] = [];
  for (let w = 0; w < count; w++) {
    const enemies: WaveDef['enemies'] = [];
    const baseCount = 4 + Math.floor(w * 1.5);

    if (w < 3) {
      enemies.push({ type: 'grunt', count: baseCount, delay: 1.2 });
    } else if (w < 6) {
      enemies.push({ type: 'grunt', count: Math.floor(baseCount * 0.6), delay: 1.0 });
      enemies.push({ type: 'fast', count: Math.floor(baseCount * 0.4), delay: 0.6 });
    } else if (w < 10) {
      enemies.push({ type: 'grunt', count: Math.floor(baseCount * 0.3), delay: 0.8 });
      enemies.push({ type: 'fast', count: Math.floor(baseCount * 0.3), delay: 0.5 });
      enemies.push({ type: 'tank', count: Math.max(1, Math.floor(baseCount * 0.15)), delay: 2.0 });
      if (w >= 8) enemies.push({ type: 'swarm', count: Math.floor(baseCount * 0.3), delay: 0.3 });
    } else {
      enemies.push({ type: 'tank', count: Math.floor(baseCount * 0.2), delay: 1.5 });
      enemies.push({ type: 'fast', count: Math.floor(baseCount * 0.3), delay: 0.4 });
      enemies.push({ type: 'swarm', count: Math.floor(baseCount * 0.3), delay: 0.3 });
      enemies.push({ type: 'ghost', count: Math.floor(baseCount * 0.1), delay: 1.0 });
      if ((w + 1) % 5 === 0) enemies.push({ type: 'boss', count: 1, delay: 3.0 });
    }
    waves.push({ enemies });
  }
  return waves;
}

const TOTAL_WAVES = 25;
const WAVES = generateWaves(TOTAL_WAVES);

// ============================================================
// SAVE DATA
// ============================================================
interface Save {
  highWave: number;
  totalKills: number;
  totalGold: number;
  gamesPlayed: number;
  wins: number;
  bestScore: number;
  towersBuilt: number;
}

function loadSave(): Save {
  try {
    const d = localStorage.getItem('neon-citadel-save');
    if (d) return JSON.parse(d);
  } catch { /* ignore */ }
  return { highWave: 0, totalKills: 0, totalGold: 0, gamesPlayed: 0, wins: 0, bestScore: 0, towersBuilt: 0 };
}

function writeSave(s: Save) {
  try { localStorage.setItem('neon-citadel-save', JSON.stringify(s)); } catch { /* ignore */ }
}

// ============================================================
// GAME STATE
// ============================================================
class GameState {
  screen: Screen = 'title';
  gold = START_GOLD;
  lives = START_LIVES;
  wave = 0;
  score = 0;
  totalKills = 0;
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  grid: (Tower | null)[][] = [];
  isPath: boolean[][] = [];
  selectedTowerType: TowerType = 'laser';
  hoveredCell: { r: number; c: number } | null = null;
  waveActive = false;
  spawnQueue: Array<{ type: EnemyType; timer: number }> = [];
  spawnTimer = 0;
  waveEnemiesRemaining = 0;
  paused = false;
  gameSpeed = 1;
  save: Save;
  selectedTower: Tower | null = null;

  constructor() {
    this.save = loadSave();
    // Init grid
    for (let r = 0; r < GRID_SIZE; r++) {
      this.grid[r] = [];
      this.isPath[r] = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        this.grid[r][c] = null;
        this.isPath[r][c] = false;
      }
    }
    // Mark path cells
    for (const [r, c] of PATH_COORDS) {
      if (r < GRID_SIZE && c < GRID_SIZE) this.isPath[r][c] = true;
    }
  }

  canPlace(r: number, c: number): boolean {
    return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE &&
      !this.isPath[r][c] && !this.grid[r][c];
  }

  gridToWorld(r: number, c: number): Vector3 {
    return new Vector3(
      GRID_OFFSET + c * CELL_SIZE,
      BOARD_Y,
      GRID_OFFSET + r * CELL_SIZE
    );
  }
}

// ============================================================
// SCENE BUILDER
// ============================================================
class SceneBuilder {
  boardGroup = new Group();
  pathGroup = new Group();
  towerGroup = new Group();
  enemyGroup = new Group();
  projectileGroup = new Group();
  hoverIndicator!: Mesh;
  citadelMesh!: Group;

  build(scene: Object3D, game: GameState): void {
    // Fog - scene is a Scene at runtime
    const s = scene as any;
    s.fog = new FogExp2(0x000a14, 0.5);
    s.background = new Color(0x000a14);

    // Lighting
    const ambient = new AmbientLight(0x112233, 0.4);
    scene.add(ambient);
    const dir = new DirectionalLight(0x4488cc, 0.6);
    dir.position.set(2, 5, 2);
    scene.add(dir);

    // Grid floor
    this.buildGrid(scene);

    // Board (play area)
    this.buildBoard(game);
    scene.add(this.boardGroup);
    scene.add(this.towerGroup);
    scene.add(this.enemyGroup);
    scene.add(this.projectileGroup);

    // Path visualization
    this.buildPath(game);
    scene.add(this.pathGroup);

    // Citadel (endpoint)
    this.buildCitadel(scene, game);

    // Hover indicator
    this.hoverIndicator = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.9, 0.002, CELL_SIZE * 0.9),
      new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 })
    );
    this.hoverIndicator.visible = false;
    scene.add(this.hoverIndicator);
  }

  buildGrid(scene: Object3D): void {
    const gridGeo = new BufferGeometry();
    const verts: number[] = [];
    const extent = 8;
    const step = 0.5;
    for (let i = -extent; i <= extent; i += step) {
      verts.push(i, 0, -extent, i, 0, extent);
      verts.push(-extent, 0, i, extent, 0, i);
    }
    gridGeo.setAttribute('position', new Float32BufferAttribute(verts, 3));
    const gridMat = new LineBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.2 });
    const grid = new LineSegments(gridGeo, gridMat);
    scene.add(grid);
  }

  buildBoard(game: GameState): void {
    // Board base
    const boardW = GRID_SIZE * CELL_SIZE;
    const base = new Mesh(
      new BoxGeometry(boardW + 0.04, 0.01, boardW + 0.04),
      new MeshStandardMaterial({ color: 0x0a1520, metalness: 0.8, roughness: 0.3 })
    );
    base.position.set(0, BOARD_Y - 0.005, 0);
    this.boardGroup.add(base);

    // Grid lines on board
    const gridGeo = new BufferGeometry();
    const verts: number[] = [];
    const half = boardW / 2;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const p = -half + i * CELL_SIZE;
      verts.push(p, BOARD_Y + 0.001, -half, p, BOARD_Y + 0.001, half);
      verts.push(-half, BOARD_Y + 0.001, p, half, BOARD_Y + 0.001, p);
    }
    gridGeo.setAttribute('position', new Float32BufferAttribute(verts, 3));
    const gridLines = new LineSegments(gridGeo, new LineBasicMaterial({
      color: 0x004466, transparent: true, opacity: 0.4,
    }));
    this.boardGroup.add(gridLines);

    // Cell markers for non-path cells
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (!game.isPath[r][c]) {
          const dot = new Mesh(
            new BoxGeometry(CELL_SIZE * 0.15, 0.002, CELL_SIZE * 0.15),
            new MeshBasicMaterial({ color: 0x003344, transparent: true, opacity: 0.3 })
          );
          const pos = game.gridToWorld(r, c);
          dot.position.copy(pos);
          dot.position.y += 0.002;
          this.boardGroup.add(dot);
        }
      }
    }
  }

  buildPath(game: GameState): void {
    // Path cells lit up
    for (const [r, c] of PATH_COORDS) {
      if (r >= GRID_SIZE || c >= GRID_SIZE) continue;
      const cell = new Mesh(
        new BoxGeometry(CELL_SIZE * 0.85, 0.003, CELL_SIZE * 0.85),
        new MeshBasicMaterial({ color: 0x112244, transparent: true, opacity: 0.5 })
      );
      const pos = game.gridToWorld(r, c);
      cell.position.copy(pos);
      cell.position.y += 0.001;
      this.pathGroup.add(cell);
    }

    // Path line connecting waypoints
    const pathVerts: number[] = [];
    for (const [r, c] of PATH_COORDS) {
      if (r >= GRID_SIZE || c >= GRID_SIZE) continue;
      const pos = game.gridToWorld(r, c);
      pathVerts.push(pos.x, BOARD_Y + 0.004, pos.z);
    }
    if (pathVerts.length >= 6) {
      const pathGeo = new BufferGeometry();
      pathGeo.setAttribute('position', new Float32BufferAttribute(pathVerts, 3));
      const pathLine = new LineSegments(pathGeo, new LineBasicMaterial({
        color: 0x0088cc, transparent: true, opacity: 0.6,
      }));
      this.pathGroup.add(pathLine);
    }

    // Spawn point marker (entry)
    const spawnMarker = new Mesh(
      new RingGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.45, 6),
      new MeshBasicMaterial({ color: 0xff4444, side: DoubleSide, transparent: true, opacity: 0.6 })
    );
    const spawnPos = game.gridToWorld(PATH_COORDS[0][0], PATH_COORDS[0][1]);
    spawnMarker.position.set(spawnPos.x, BOARD_Y + 0.005, spawnPos.z);
    spawnMarker.rotation.x = -Math.PI / 2;
    this.pathGroup.add(spawnMarker);
  }

  buildCitadel(scene: Object3D, game: GameState): void {
    this.citadelMesh = new Group();
    const lastWP = PATH_COORDS[PATH_COORDS.length - 1];
    const cPos = game.gridToWorld(lastWP[0], lastWP[1]);

    // Base
    const cBase = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.4, CELL_SIZE * 0.5, 0.04, 6),
      new MeshStandardMaterial({ color: 0x00ccff, emissive: 0x004466, metalness: 0.7, roughness: 0.3 })
    );
    cBase.position.set(cPos.x, BOARD_Y + 0.02, cPos.z);
    this.citadelMesh.add(cBase);

    // Tower spire
    const spire = new Mesh(
      new ConeGeometry(CELL_SIZE * 0.2, 0.1, 6),
      new MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00aacc, metalness: 0.9, roughness: 0.2 })
    );
    spire.position.set(cPos.x, BOARD_Y + 0.09, cPos.z);
    this.citadelMesh.add(spire);

    // Point light
    const cLight = new PointLight(0x00ccff, 0.5, 1.0);
    cLight.position.set(cPos.x, BOARD_Y + 0.15, cPos.z);
    this.citadelMesh.add(cLight);

    scene.add(this.citadelMesh);
  }

  createTowerMesh(type: TowerType, pos: Vector3): { group: Group; barrelMesh: Mesh } {
    const def = TOWER_DEFS[type];
    const col = new Color(def.color);
    const group = new Group();
    group.position.copy(pos);

    // Base
    const base = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.35, 0.025, 8),
      new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.4), metalness: 0.8, roughness: 0.3 })
    );
    base.position.y = 0.0125;
    group.add(base);

    // Body
    const body = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.2, CELL_SIZE * 0.25, 0.04, 8),
      new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.6), metalness: 0.7, roughness: 0.3 })
    );
    body.position.y = 0.045;
    group.add(body);

    // Barrel/top
    let barrelMesh: Mesh;
    if (type === 'sniper') {
      barrelMesh = new Mesh(
        new CylinderGeometry(0.005, 0.005, 0.06, 6),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.5), metalness: 0.9, roughness: 0.2 })
      );
      barrelMesh.rotation.x = Math.PI / 2;
      barrelMesh.position.y = 0.065;
      barrelMesh.position.z = -0.02;
    } else if (type === 'pulse') {
      barrelMesh = new Mesh(
        new SphereGeometry(CELL_SIZE * 0.15, 8, 6),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.4), metalness: 0.6, roughness: 0.4 })
      );
      barrelMesh.position.y = 0.075;
    } else {
      barrelMesh = new Mesh(
        new BoxGeometry(0.01, 0.01, 0.04),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.5), metalness: 0.9, roughness: 0.2 })
      );
      barrelMesh.position.y = 0.065;
      barrelMesh.position.z = -0.015;
    }
    group.add(barrelMesh);

    // Glow light
    const glow = new PointLight(col.getHex(), 0.15, 0.3);
    glow.position.y = 0.08;
    group.add(glow);

    // Edge wireframe
    const edges = new EdgesGeometry(new CylinderGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.35, 0.025, 8));
    const wireframe = new LineSegments(edges, new LineBasicMaterial({
      color: col, transparent: true, opacity: 0.4,
    }));
    wireframe.position.y = 0.0125;
    group.add(wireframe);

    return { group, barrelMesh };
  }

  createEnemyMesh(type: EnemyType): { group: Group; healthBar: Mesh; healthBg: Mesh } {
    const def = ENEMY_DEFS[type];
    const col = new Color(def.color);
    const group = new Group();
    const s = def.scale * 0.03;

    let bodyMesh: Mesh;
    if (type === 'tank') {
      bodyMesh = new Mesh(
        new BoxGeometry(s * 1.2, s, s * 1.2),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), metalness: 0.6, roughness: 0.4 })
      );
    } else if (type === 'fast' || type === 'swarm') {
      bodyMesh = new Mesh(
        new OctahedronGeometry(s * 0.7),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.4), metalness: 0.7, roughness: 0.3 })
      );
    } else if (type === 'boss') {
      bodyMesh = new Mesh(
        new SphereGeometry(s, 6, 6),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.5), metalness: 0.8, roughness: 0.2 })
      );
    } else if (type === 'ghost') {
      bodyMesh = new Mesh(
        new SphereGeometry(s * 0.8, 8, 6),
        new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 })
      );
    } else {
      bodyMesh = new Mesh(
        new SphereGeometry(s * 0.8, 6, 4),
        new MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), metalness: 0.5, roughness: 0.5 })
      );
    }
    bodyMesh.position.y = s + 0.005;
    group.add(bodyMesh);

    // Health bar background
    const hbW = 0.04;
    const healthBg = new Mesh(
      new BoxGeometry(hbW, 0.003, 0.003),
      new MeshBasicMaterial({ color: 0x330000 })
    );
    healthBg.position.y = s * 2 + 0.015;
    group.add(healthBg);

    // Health bar fill
    const healthBar = new Mesh(
      new BoxGeometry(hbW, 0.004, 0.004),
      new MeshBasicMaterial({ color: 0x00ff44 })
    );
    healthBar.position.y = s * 2 + 0.015;
    group.add(healthBar);

    return { group, healthBar, healthBg };
  }
}

// ============================================================
// GAME LOGIC
// ============================================================
class GameLogic {
  game: GameState;
  scene: SceneBuilder;
  raycaster = new Raycaster();

  constructor(game: GameState, scene: SceneBuilder) {
    this.game = game;
    this.scene = scene;
  }

  startGame(): void {
    this.game.screen = 'playing';
    this.game.gold = START_GOLD;
    this.game.lives = START_LIVES;
    this.game.wave = 0;
    this.game.score = 0;
    this.game.totalKills = 0;
    this.game.waveActive = false;
    this.game.paused = false;
    this.game.gameSpeed = 1;
    this.game.selectedTower = null;

    // Clear existing entities
    this.clearAll();
    this.startNextWave();
  }

  clearAll(): void {
    for (const t of this.game.towers) {
      this.scene.towerGroup.remove(t.group);
    }
    for (const e of this.game.enemies) {
      this.scene.enemyGroup.remove(e.group);
    }
    for (const p of this.game.projectiles) {
      this.scene.projectileGroup.remove(p.mesh);
    }
    this.game.towers = [];
    this.game.enemies = [];
    this.game.projectiles = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        this.game.grid[r][c] = null;
      }
    }
  }

  startNextWave(): void {
    if (this.game.wave >= TOTAL_WAVES) {
      this.endGame(true);
      return;
    }
    const waveDef = WAVES[this.game.wave];
    this.game.spawnQueue = [];
    let totalCount = 0;
    for (const group of waveDef.enemies) {
      for (let i = 0; i < group.count; i++) {
        this.game.spawnQueue.push({ type: group.type, timer: totalCount * group.delay });
        totalCount++;
      }
    }
    this.game.waveEnemiesRemaining = totalCount;
    this.game.spawnTimer = 0;
    this.game.waveActive = true;
  }

  placeTower(r: number, c: number, type: TowerType): boolean {
    const def = TOWER_DEFS[type];
    if (this.game.gold < def.cost || !this.game.canPlace(r, c)) return false;

    this.game.gold -= def.cost;
    const pos = this.game.gridToWorld(r, c);
    const { group, barrelMesh } = this.scene.createTowerMesh(type, pos);
    this.scene.towerGroup.add(group);

    const tower: Tower = {
      type, gridR: r, gridC: c, group, barrelMesh,
      cooldown: 0, level: 1, kills: 0, targetEntity: null,
    };
    this.game.towers.push(tower);
    this.game.grid[r][c] = tower;
    this.game.save.towersBuilt++;
    return true;
  }

  upgradeTower(tower: Tower): boolean {
    const cost = Math.floor(TOWER_DEFS[tower.type].cost * UPGRADE_COST_MULT * tower.level);
    if (this.game.gold < cost || tower.level >= 3) return false;
    this.game.gold -= cost;
    tower.level++;

    // Visual feedback: scale up slightly
    tower.group.scale.setScalar(1 + (tower.level - 1) * 0.15);
    return true;
  }

  sellTower(tower: Tower): void {
    const refund = Math.floor(TOWER_DEFS[tower.type].cost * 0.6 * tower.level);
    this.game.gold += refund;
    this.scene.towerGroup.remove(tower.group);
    this.game.grid[tower.gridR][tower.gridC] = null;
    this.game.towers = this.game.towers.filter(t => t !== tower);
    if (this.game.selectedTower === tower) this.game.selectedTower = null;
  }

  spawnEnemy(type: EnemyType): void {
    const def = ENEMY_DEFS[type];
    const waveScale = 1 + this.game.wave * 0.15;
    const { group, healthBar, healthBg } = this.scene.createEnemyMesh(type);

    const startPos = this.game.gridToWorld(PATH_COORDS[0][0], PATH_COORDS[0][1]);
    group.position.copy(startPos);

    this.scene.enemyGroup.add(group);

    const enemy: Enemy = {
      type, hp: Math.floor(def.hp * waveScale), maxHp: Math.floor(def.hp * waveScale),
      speed: def.speed, reward: def.reward,
      pathIdx: 0, pathProgress: 0,
      group, healthBar, healthBg,
      slowTimer: 0, alive: true,
    };
    this.game.enemies.push(enemy);
  }

  updateEnemies(delta: number): void {
    const toRemove: Enemy[] = [];

    for (const enemy of this.game.enemies) {
      if (!enemy.alive) continue;

      const speed = enemy.slowTimer > 0
        ? enemy.speed * 0.4 * CELL_SIZE
        : enemy.speed * CELL_SIZE;

      enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
      enemy.pathProgress += speed * delta;

      // Move along path
      while (enemy.pathProgress >= 1 && enemy.pathIdx < PATH_COORDS.length - 1) {
        enemy.pathProgress -= 1;
        enemy.pathIdx++;
      }

      if (enemy.pathIdx >= PATH_COORDS.length - 1) {
        // Reached the citadel
        this.game.lives--;
        enemy.alive = false;
        toRemove.push(enemy);
        this.game.waveEnemiesRemaining--;
        continue;
      }

      // Interpolate position
      const curr = PATH_COORDS[enemy.pathIdx];
      const next = PATH_COORDS[Math.min(enemy.pathIdx + 1, PATH_COORDS.length - 1)];
      const currPos = this.game.gridToWorld(curr[0], curr[1]);
      const nextPos = this.game.gridToWorld(next[0], next[1]);

      enemy.group.position.lerpVectors(currPos, nextPos, Math.min(enemy.pathProgress, 1));

      // Update health bar
      const hpRatio = enemy.hp / enemy.maxHp;
      enemy.healthBar.scale.x = Math.max(0.01, hpRatio);
      const barColor = hpRatio > 0.6 ? 0x00ff44 : hpRatio > 0.3 ? 0xffaa00 : 0xff2222;
      (enemy.healthBar.material as MeshBasicMaterial).color.setHex(barColor);
    }

    // Remove dead enemies
    for (const e of toRemove) {
      this.scene.enemyGroup.remove(e.group);
      this.game.enemies = this.game.enemies.filter(en => en !== e);
    }

    // Check lives
    if (this.game.lives <= 0) {
      this.endGame(false);
    }
  }

  updateTowers(delta: number): void {
    for (const tower of this.game.towers) {
      tower.cooldown = Math.max(0, tower.cooldown - delta);
      if (tower.cooldown > 0) continue;

      const def = TOWER_DEFS[tower.type];
      const range = def.range * CELL_SIZE * (1 + (tower.level - 1) * 0.2);
      const tPos = this.game.gridToWorld(tower.gridR, tower.gridC);

      // Find nearest enemy in range
      let nearest: Enemy | null = null;
      let nearDist = Infinity;

      for (const enemy of this.game.enemies) {
        if (!enemy.alive) continue;
        const dist = tPos.distanceTo(enemy.group.position);
        if (dist <= range && dist < nearDist) {
          nearest = enemy;
          nearDist = dist;
        }
      }

      if (!nearest) continue;

      // Fire
      tower.cooldown = 1 / (def.fireRate * (1 + (tower.level - 1) * 0.15));
      tower.targetEntity = nearest;

      // Aim barrel
      const dir = new Vector3().subVectors(nearest.group.position, tower.group.position);
      tower.barrelMesh.lookAt(
        tower.barrelMesh.position.clone().add(new Vector3(dir.x, 0, dir.z).normalize())
      );

      const damage = def.damage * (1 + (tower.level - 1) * 0.4);

      if (tower.type === 'pulse') {
        // AoE: damage all enemies in range
        for (const enemy of this.game.enemies) {
          if (!enemy.alive) continue;
          const dist = tPos.distanceTo(enemy.group.position);
          if (dist <= range) {
            this.damageEnemy(enemy, damage * (1 - dist / range * 0.5));
          }
        }
        // Visual pulse
        this.createPulseEffect(tPos, range);
      } else if (tower.type === 'slow') {
        // Slow all enemies in range
        for (const enemy of this.game.enemies) {
          if (!enemy.alive) continue;
          const dist = tPos.distanceTo(enemy.group.position);
          if (dist <= range) {
            enemy.slowTimer = 2.0;
            this.damageEnemy(enemy, damage);
          }
        }
      } else if (tower.type === 'chain') {
        // Chain to up to 3 enemies
        let chainTarget: Enemy | null = nearest;
        const hit = new Set<Enemy>();
        for (let i = 0; i < 3 && chainTarget; i++) {
          hit.add(chainTarget);
          this.damageEnemy(chainTarget, damage * (1 - i * 0.2));
          this.fireProjectile(
            i === 0 ? tPos.clone().setY(BOARD_Y + 0.07) : chainTarget.group.position.clone(),
            chainTarget, tower.type, damage * (1 - i * 0.2)
          );
          // Find next nearest not yet hit
          let nextNearest: Enemy | null = null;
          let nextDist = Infinity;
          for (const e of this.game.enemies) {
            if (!e.alive || hit.has(e)) continue;
            const d = chainTarget.group.position.distanceTo(e.group.position);
            if (d <= range * 0.5 && d < nextDist) {
              nextNearest = e;
              nextDist = d;
            }
          }
          chainTarget = nextNearest;
        }
      } else {
        // Single target: laser, sniper
        this.fireProjectile(
          tPos.clone().setY(BOARD_Y + 0.07),
          nearest, tower.type, damage
        );
      }
    }
  }

  fireProjectile(origin: Vector3, target: Enemy, type: TowerType, damage: number): void {
    const def = TOWER_DEFS[type];
    const col = new Color(def.color);
    const proj = new Mesh(
      new SphereGeometry(0.005, 4, 4),
      new MeshBasicMaterial({ color: col })
    );
    proj.position.copy(origin);
    this.scene.projectileGroup.add(proj);

    this.game.projectiles.push({
      mesh: proj, target, speed: 3.0, damage, type, origin,
    });
  }

  createPulseEffect(center: Vector3, range: number): void {
    const ring = new Mesh(
      new RingGeometry(0, range, 16),
      new MeshBasicMaterial({
        color: TOWER_DEFS.pulse.color,
        transparent: true, opacity: 0.3, side: DoubleSide,
      })
    );
    ring.position.set(center.x, BOARD_Y + 0.005, center.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.projectileGroup.add(ring);

    // Auto-remove after short duration
    let life = 0.3;
    const update = () => {
      life -= 0.016;
      ring.scale.setScalar(1 + (0.3 - life) * 2);
      (ring.material as MeshBasicMaterial).opacity = life;
      if (life <= 0) {
        this.scene.projectileGroup.remove(ring);
      } else {
        requestAnimationFrame(update);
      }
    };
    requestAnimationFrame(update);
  }

  updateProjectiles(delta: number): void {
    const toRemove: Projectile[] = [];

    for (const proj of this.game.projectiles) {
      if (!proj.target.alive) {
        toRemove.push(proj);
        continue;
      }

      const dir = new Vector3().subVectors(proj.target.group.position, proj.mesh.position);
      const dist = dir.length();

      if (dist < 0.01) {
        // Hit
        this.damageEnemy(proj.target, proj.damage);
        toRemove.push(proj);
      } else {
        dir.normalize().multiplyScalar(proj.speed * delta);
        proj.mesh.position.add(dir);
      }
    }

    for (const p of toRemove) {
      this.scene.projectileGroup.remove(p.mesh);
    }
    this.game.projectiles = this.game.projectiles.filter(p => !toRemove.includes(p));
  }

  damageEnemy(enemy: Enemy, damage: number): void {
    if (!enemy.alive) return;
    enemy.hp -= damage;
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      this.game.gold += enemy.reward;
      this.game.score += enemy.reward * 2;
      this.game.totalKills++;
      this.game.waveEnemiesRemaining--;
      this.scene.enemyGroup.remove(enemy.group);
      this.game.enemies = this.game.enemies.filter(e => e !== enemy);
    }
  }

  updateSpawning(delta: number): void {
    if (!this.game.waveActive || this.game.spawnQueue.length === 0) return;

    this.game.spawnTimer += delta;

    while (this.game.spawnQueue.length > 0 && this.game.spawnQueue[0].timer <= this.game.spawnTimer) {
      const spawn = this.game.spawnQueue.shift()!;
      this.spawnEnemy(spawn.type);
    }
  }

  checkWaveComplete(): void {
    if (!this.game.waveActive) return;
    if (this.game.spawnQueue.length === 0 && this.game.enemies.length === 0) {
      this.game.waveActive = false;
      this.game.wave++;

      // Bonus gold
      this.game.gold += 20 + this.game.wave * 5;
      this.game.score += 100 * this.game.wave;

      if (this.game.wave >= TOTAL_WAVES) {
        this.endGame(true);
      } else {
        // Auto-start next wave after brief delay
        setTimeout(() => {
          if (this.game.screen === 'playing') {
            this.startNextWave();
          }
        }, 2000);
      }
    }
  }

  endGame(won: boolean): void {
    this.game.screen = 'gameover';
    this.game.save.gamesPlayed++;
    this.game.save.totalKills += this.game.totalKills;
    this.game.save.totalGold += this.game.gold;
    if (this.game.wave > this.game.save.highWave) this.game.save.highWave = this.game.wave;
    if (this.game.score > this.game.save.bestScore) this.game.save.bestScore = this.game.score;
    if (won) this.game.save.wins++;
    writeSave(this.game.save);
  }

  handleBoardClick(camera: any, ndcX: number, ndcY: number): void {
    if (this.game.screen !== 'playing' || this.game.paused) return;

    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

    // Check if clicking on existing tower
    for (const tower of this.game.towers) {
      const intersects = this.raycaster.intersectObject(tower.group, true);
      if (intersects.length > 0) {
        this.game.selectedTower = tower;
        return;
      }
    }

    // Check grid cell
    const boardPlane = new Mesh(
      new PlaneGeometry(GRID_SIZE * CELL_SIZE * 2, GRID_SIZE * CELL_SIZE * 2),
      new MeshBasicMaterial()
    );
    boardPlane.rotation.x = -Math.PI / 2;
    boardPlane.position.y = BOARD_Y;
    boardPlane.updateMatrixWorld();

    const intersects = this.raycaster.intersectObject(boardPlane);
    if (intersects.length > 0) {
      const hit = intersects[0].point;
      const c = Math.round((hit.x - GRID_OFFSET) / CELL_SIZE);
      const r = Math.round((hit.z - GRID_OFFSET) / CELL_SIZE);

      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        if (this.game.grid[r][c]) {
          this.game.selectedTower = this.game.grid[r][c];
        } else {
          this.placeTower(r, c, this.game.selectedTowerType);
        }
      }
    }
    this.game.selectedTower = null;
  }

  update(delta: number): void {
    if (this.game.screen !== 'playing' || this.game.paused) return;

    const dt = delta * this.game.gameSpeed;
    this.updateSpawning(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.checkWaveComplete();
  }
}

// ============================================================
// UI SYSTEM (PanelUI)
// ============================================================
class UIManager {
  game: GameState;
  logic: GameLogic;
  hudDoc: UIKitDocument | null = null;
  titleDoc: UIKitDocument | null = null;
  towerDoc: UIKitDocument | null = null;
  gameoverDoc: UIKitDocument | null = null;
  helpDoc: UIKitDocument | null = null;
  pauseDoc: UIKitDocument | null = null;

  // Panel entities for show/hide
  hudEntity: any = null;
  titleEntity: any = null;
  towerEntity: any = null;
  gameoverEntity: any = null;
  helpEntity: any = null;
  pauseEntity: any = null;

  constructor(game: GameState, logic: GameLogic) {
    this.game = game;
    this.logic = logic;
  }

  bindTitle(doc: UIKitDocument, entity: any): void {
    this.titleDoc = doc;
    this.titleEntity = entity;

    const btnStart = doc.getElementById('btn-start') as UIKit.Text | undefined;
    btnStart?.addEventListener('click', () => {
      this.logic.startGame();
      this.updateVisibility();
    });

    const btnHelp = doc.getElementById('btn-help') as UIKit.Text | undefined;
    btnHelp?.addEventListener('click', () => {
      this.game.screen = 'help';
      this.updateVisibility();
    });

    // Show stats
    const statsText = doc.getElementById('stats-text') as UIKit.Text | undefined;
    const s = this.game.save;
    statsText?.setProperties({
      text: `Best Wave: ${s.highWave} | Kills: ${s.totalKills} | Wins: ${s.wins}`,
    });
  }

  bindHud(doc: UIKitDocument, entity: any): void {
    this.hudDoc = doc;
    this.hudEntity = entity;
  }

  bindTowerSelect(doc: UIKitDocument, entity: any): void {
    this.towerDoc = doc;
    this.towerEntity = entity;

    const types: TowerType[] = ['laser', 'pulse', 'slow', 'sniper', 'chain'];
    for (const type of types) {
      const btn = doc.getElementById(`btn-${type}`) as UIKit.Text | undefined;
      const def = TOWER_DEFS[type];
      btn?.setProperties({ text: `${def.name} ($${def.cost})` });
      btn?.addEventListener('click', () => {
        this.game.selectedTowerType = type;
        this.updateTowerSelection();
      });
    }
    this.updateTowerSelection();
  }

  bindGameover(doc: UIKitDocument, entity: any): void {
    this.gameoverDoc = doc;
    this.gameoverEntity = entity;

    const btnRestart = doc.getElementById('btn-restart') as UIKit.Text | undefined;
    btnRestart?.addEventListener('click', () => {
      this.logic.startGame();
      this.updateVisibility();
    });

    const btnMenu = doc.getElementById('btn-menu') as UIKit.Text | undefined;
    btnMenu?.addEventListener('click', () => {
      this.game.screen = 'title';
      this.logic.clearAll();
      this.updateVisibility();
    });
  }

  bindHelp(doc: UIKitDocument, entity: any): void {
    this.helpDoc = doc;
    this.helpEntity = entity;

    const btnBack = doc.getElementById('btn-back') as UIKit.Text | undefined;
    btnBack?.addEventListener('click', () => {
      this.game.screen = 'title';
      this.updateVisibility();
    });
  }

  bindPause(doc: UIKitDocument, entity: any): void {
    this.pauseDoc = doc;
    this.pauseEntity = entity;

    const btnResume = doc.getElementById('btn-resume') as UIKit.Text | undefined;
    btnResume?.addEventListener('click', () => {
      this.game.paused = false;
      this.game.screen = 'playing';
      this.updateVisibility();
    });

    const btnQuit = doc.getElementById('btn-quit') as UIKit.Text | undefined;
    btnQuit?.addEventListener('click', () => {
      this.game.screen = 'title';
      this.game.paused = false;
      this.logic.clearAll();
      this.updateVisibility();
    });
  }

  updateHud(): void {
    if (!this.hudDoc) return;

    const setText = (id: string, text: string) => {
      const el = this.hudDoc!.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };

    setText('gold-text', `Gold: ${this.game.gold}`);
    setText('lives-text', `Lives: ${this.game.lives}`);
    setText('wave-text', `Wave: ${this.game.wave + 1}/${TOTAL_WAVES}`);
    setText('score-text', `Score: ${this.game.score}`);
    setText('kills-text', `Kills: ${this.game.totalKills}`);

    // Selected tower info
    const selected = this.game.selectedTowerType;
    const def = TOWER_DEFS[selected];
    setText('selected-text', `[${def.name}] $${def.cost} | DMG:${def.damage} | RNG:${def.range}`);
  }

  updateTowerSelection(): void {
    if (!this.towerDoc) return;
    const types: TowerType[] = ['laser', 'pulse', 'slow', 'sniper', 'chain'];
    for (const type of types) {
      const btn = this.towerDoc.getElementById(`btn-${type}`) as UIKit.Text | undefined;
      const def = TOWER_DEFS[type];
      const isSelected = type === this.game.selectedTowerType;
      const canAfford = this.game.gold >= def.cost;
      btn?.setProperties({
        text: `${isSelected ? '> ' : ''}${def.name} ($${def.cost})`,
        backgroundColor: isSelected ? '#004466' : canAfford ? '#112233' : '#220000',
      });
    }
  }

  updateGameover(): void {
    if (!this.gameoverDoc) return;
    const won = this.game.wave >= TOTAL_WAVES;
    const setText = (id: string, text: string) => {
      const el = this.gameoverDoc!.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };
    setText('result-text', won ? 'VICTORY!' : 'CITADEL FELL');
    setText('final-score', `Score: ${this.game.score}`);
    setText('final-wave', `Wave: ${this.game.wave}/${TOTAL_WAVES}`);
    setText('final-kills', `Kills: ${this.game.totalKills}`);
  }

  updateVisibility(): void {
    const show = (entity: any, visible: boolean) => {
      if (entity?.object3D) entity.object3D.visible = visible;
    };

    show(this.titleEntity, this.game.screen === 'title');
    show(this.hudEntity, this.game.screen === 'playing');
    show(this.towerEntity, this.game.screen === 'playing');
    show(this.gameoverEntity, this.game.screen === 'gameover');
    show(this.helpEntity, this.game.screen === 'help');
    show(this.pauseEntity, this.game.screen === 'paused' || (this.game.screen === 'playing' && this.game.paused));

    if (this.game.screen === 'gameover') this.updateGameover();
  }
}

// ============================================================
// ECS SYSTEMS
// ============================================================
class GameSystem extends createSystem({
  titlePanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/title.json')] },
  hudPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
  towerPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/tower-select.json')] },
  gameoverPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/gameover.json')] },
  helpPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/help.json')] },
  pausePanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/pause.json')] },
}) {
  private game!: GameState;
  private logic!: GameLogic;
  private ui!: UIManager;
  private hudUpdateTimer = 0;
  private animTime = 0;

  setRefs(refs: { game: GameState; logic: GameLogic; ui: UIManager }): void {
    this.game = refs.game;
    this.logic = refs.logic;
    this.ui = refs.ui;
  }

  init(): void {
    // Bind panels
    this.queries.titlePanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindTitle(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.hudPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindHud(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.towerPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindTowerSelect(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.gameoverPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindGameover(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.helpPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindHelp(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.pausePanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindPause(doc, entity);
      this.ui.updateVisibility();
    });
  }

  update(delta: number, time: number): void {
    this.animTime = time;

    // Game logic update
    this.logic.update(delta);

    // HUD update (throttled)
    this.hudUpdateTimer += delta;
    if (this.hudUpdateTimer >= 0.1) {
      this.hudUpdateTimer = 0;
      this.ui.updateHud();
      this.ui.updateTowerSelection();
    }

    // Keyboard input
    this.handleKeyboard();

    // XR input
    this.handleXRInput();

    // Animate citadel
    if (this.logic.scene.citadelMesh) {
      this.logic.scene.citadelMesh.children.forEach((child, i) => {
        if (i === 1) { // spire
          child.rotation.y = time * 1.5;
        }
      });
    }

    // Animate hover
    if (this.logic.scene.hoverIndicator.visible) {
      const mat = this.logic.scene.hoverIndicator.material as MeshBasicMaterial;
      mat.opacity = 0.2 + Math.sin(time * 4) * 0.1;
    }
  }

  handleKeyboard(): void {
    const inp = (this.world as any).input as RuntimeInput | undefined;
    if (!inp?.keyboard) return;
    const kb = inp.keyboard;

    // Tower type selection with number keys
    if (kb.getKeyDown('Digit1')) this.game.selectedTowerType = 'laser';
    if (kb.getKeyDown('Digit2')) this.game.selectedTowerType = 'pulse';
    if (kb.getKeyDown('Digit3')) this.game.selectedTowerType = 'slow';
    if (kb.getKeyDown('Digit4')) this.game.selectedTowerType = 'sniper';
    if (kb.getKeyDown('Digit5')) this.game.selectedTowerType = 'chain';

    // Pause
    if (kb.getKeyDown('Escape') || kb.getKeyDown('KeyP')) {
      if (this.game.screen === 'playing') {
        this.game.paused = !this.game.paused;
        this.ui.updateVisibility();
      }
    }

    // Speed control
    if (kb.getKeyDown('KeyF')) {
      this.game.gameSpeed = this.game.gameSpeed >= 3 ? 1 : this.game.gameSpeed + 1;
    }

    // Sell selected tower
    if (kb.getKeyDown('KeyX') && this.game.selectedTower) {
      this.logic.sellTower(this.game.selectedTower);
    }

    // Upgrade selected tower
    if (kb.getKeyDown('KeyU') && this.game.selectedTower) {
      this.logic.upgradeTower(this.game.selectedTower);
    }
  }

  handleXRInput(): void {
    const inp = (this.world as any).input as RuntimeInput | undefined;
    const right = inp?.xr?.gamepads?.right;
    if (!right) return;

    // Tower placement with trigger in VR
    if (right.getButtonDown(InputComponent.Trigger)) {
      if (this.game.screen === 'playing' && this.game.hoveredCell) {
        const { r, c } = this.game.hoveredCell;
        if (this.game.grid[r][c]) {
          this.game.selectedTower = this.game.grid[r][c];
        } else {
          this.logic.placeTower(r, c, this.game.selectedTowerType);
        }
      }
    }

    // Cycle tower type with thumbstick
    const stick = right.getAxesValues(InputComponent.Thumbstick);
    if (stick && Math.abs(stick.x) > 0.7) {
      const types: TowerType[] = ['laser', 'pulse', 'slow', 'sniper', 'chain'];
      const idx = types.indexOf(this.game.selectedTowerType);
      const newIdx = stick.x > 0
        ? (idx + 1) % types.length
        : (idx - 1 + types.length) % types.length;
      this.game.selectedTowerType = types[newIdx];
    }

    // Sell with B button
    if (right.getButtonDown(InputComponent.B_Button) && this.game.selectedTower) {
      this.logic.sellTower(this.game.selectedTower);
    }

    // Upgrade with A button
    if (right.getButtonDown(InputComponent.A_Button) && this.game.selectedTower) {
      this.logic.upgradeTower(this.game.selectedTower);
    }
  }
}

// ============================================================
// MAIN ENTRY
// ============================================================
async function main() {
  const container = document.getElementById('app') as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: 'once' },
    input: { canvasPointerEvents: true },
    features: {
      locomotion: { browserControls: true },
      physics: false,
      grabbing: false,
    },
    render: {
      near: 0.01,
      far: 100,
      defaultLighting: false,
      camera: { position: [0, 1.6, 0.8], lookAt: [0, 0.85, 0] },
    },
  } as any);

  // Initialize game
  const game = new GameState();
  const sceneBuilder = new SceneBuilder();
  const logic = new GameLogic(game, sceneBuilder);
  const ui = new UIManager(game, logic);

  // Build scene
  sceneBuilder.build(world.scene, game);

  // Create PanelUI panels using Follower + ScreenSpace pattern
  const panelConfigs = [
    { config: './ui/title.json', pos: [0, 0, -1.5], name: 'title' },
    { config: './ui/hud.json', pos: [0, 0.35, -1.2], name: 'hud' },
    { config: './ui/tower-select.json', pos: [-0.55, -0.1, -1.2], name: 'tower-select' },
    { config: './ui/gameover.json', pos: [0, 0, -1.5], name: 'gameover' },
    { config: './ui/help.json', pos: [0, 0, -1.5], name: 'help' },
    { config: './ui/pause.json', pos: [0, 0, -1.5], name: 'pause' },
  ];

  for (const pc of panelConfigs) {
    const entity = world.createTransformEntity();
    entity.addComponent(PanelUI, { config: pc.config });
    entity.addComponent(Follower);
    const off = entity.getVectorView(Follower, 'offsetPosition');
    if (off) { off[0] = pc.pos[0]; off[1] = pc.pos[1] - 1.6; off[2] = pc.pos[2]; }
    entity.addComponent(ScreenSpace);
    if (entity.object3D) {
      entity.object3D.position.set(pc.pos[0], pc.pos[1], pc.pos[2]);
      // Hide all panels initially; updateVisibility will show the right ones
      entity.object3D.visible = false;
    }
  }

  // Register system
  world.registerSystem(GameSystem);
  const gameSystem = world.getSystem(GameSystem)!;
  gameSystem.setRefs({ game, logic, ui });

  // Canvas click handler for browser mode
  const canvas = world.renderer.domElement;
  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    logic.handleBoardClick(world.camera, ndcX, ndcY);
  });

  // Mousemove for hover
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (game.screen !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(ndcX, ndcY), world.camera);

    const boardPlane = new Mesh(
      new PlaneGeometry(GRID_SIZE * CELL_SIZE * 2, GRID_SIZE * CELL_SIZE * 2),
      new MeshBasicMaterial()
    );
    boardPlane.rotation.x = -Math.PI / 2;
    boardPlane.position.y = BOARD_Y;
    boardPlane.updateMatrixWorld();

    const intersects = raycaster.intersectObject(boardPlane);
    if (intersects.length > 0) {
      const hit = intersects[0].point;
      const c = Math.round((hit.x - GRID_OFFSET) / CELL_SIZE);
      const r = Math.round((hit.z - GRID_OFFSET) / CELL_SIZE);

      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE && game.canPlace(r, c)) {
        game.hoveredCell = { r, c };
        const pos = game.gridToWorld(r, c);
        sceneBuilder.hoverIndicator.position.set(pos.x, BOARD_Y + 0.003, pos.z);
        sceneBuilder.hoverIndicator.visible = true;
      } else {
        game.hoveredCell = null;
        sceneBuilder.hoverIndicator.visible = false;
      }
    } else {
      game.hoveredCell = null;
      sceneBuilder.hoverIndicator.visible = false;
    }
  });
}

main().catch(console.error);
