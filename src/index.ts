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
type Screen = 'title' | 'playing' | 'paused' | 'gameover' | 'wave-complete' | 'tower-select' | 'help' | 'achievements';
type TowerType = 'laser' | 'pulse' | 'slow' | 'sniper' | 'chain';
type EnemyType = 'grunt' | 'fast' | 'tank' | 'boss' | 'swarm' | 'ghost';
type Difficulty = 'easy' | 'normal' | 'hard';
type TargetMode = 'first' | 'last' | 'strongest' | 'weakest';

interface TowerDef {
  name: string;
  cost: number;
  damage: number;
  range: number;
  fireRate: number;
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
  rangeMesh: Mesh | null;
  totalDamageDealt: number;
  targetMode: TargetMode;
  dps: number;
  dpsWindow: number[];
  lastDpsUpdate: number;
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

interface DamageNumber {
  mesh: Mesh;
  life: number;
  velocity: Vector3;
}

interface Particle {
  mesh: Mesh;
  life: number;
  velocity: Vector3;
  startLife: number;
}

// ============================================================
// ACHIEVEMENTS
// ============================================================
interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check: (game: GameState) => boolean;
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first-blood', name: 'First Blood', desc: 'Kill your first enemy', check: g => g.totalKills >= 1 },
  { id: 'builder', name: 'Builder', desc: 'Place 5 towers in one game', check: g => g.towers.length >= 5 },
  { id: 'architect', name: 'Architect', desc: 'Place 10 towers in one game', check: g => g.towersPlacedThisGame >= 10 },
  { id: 'wave-5', name: 'Wave 5', desc: 'Survive 5 waves', check: g => g.wave >= 5 },
  { id: 'wave-10', name: 'Wave 10', desc: 'Survive 10 waves', check: g => g.wave >= 10 },
  { id: 'wave-15', name: 'Wave 15', desc: 'Survive 15 waves', check: g => g.wave >= 15 },
  { id: 'wave-20', name: 'Wave 20', desc: 'Survive 20 waves', check: g => g.wave >= 20 },
  { id: 'champion', name: 'Champion', desc: 'Beat all 25 waves', check: g => g.wave >= TOTAL_WAVES },
  { id: 'sniper-elite', name: 'Sniper Elite', desc: 'Get 10 kills with Sniper towers', check: g => g.towerKillsByType.sniper >= 10 },
  { id: 'chain-master', name: 'Chain Master', desc: 'Get 20 kills with Chain towers', check: g => g.towerKillsByType.chain >= 20 },
  { id: 'pulse-storm', name: 'Pulse Storm', desc: 'Get 15 kills with Pulse towers', check: g => g.towerKillsByType.pulse >= 15 },
  { id: 'ice-age', name: 'Ice Age', desc: 'Slow 50 enemies total', check: g => g.enemiesSlowed >= 50 },
  { id: 'midas', name: 'Midas Touch', desc: 'Earn 1000 gold in one game', check: g => g.totalGoldEarned >= 1000 },
  { id: 'untouchable', name: 'Untouchable', desc: 'Complete a wave with no leaks', check: g => g.wavePerfect },
  { id: 'maxed-out', name: 'Maxed Out', desc: 'Upgrade a tower to Level 3', check: g => g.towers.some(t => t.level >= 3) },
  { id: 'boss-slayer', name: 'Boss Slayer', desc: 'Kill a Boss enemy', check: g => g.bossKills >= 1 },
  { id: 'ghost-buster', name: 'Ghost Buster', desc: 'Kill 5 Ghost enemies', check: g => g.ghostKills >= 5 },
  { id: 'speed-demon', name: 'Speed Demon', desc: 'Play at 3x speed', check: g => g.gameSpeed >= 3 },
  { id: 'recycler', name: 'Recycler', desc: 'Sell 3 towers in one game', check: g => g.towersSoldThisGame >= 3 },
  { id: 'perfectionist', name: 'Perfectionist', desc: 'Score 5000+ points', check: g => g.score >= 5000 },
  { id: 'combo-king', name: 'Combo King', desc: 'Get a 5x kill combo', check: g => g.maxCombo >= 5 },
  { id: 'last-stand', name: 'Last Stand', desc: 'Win with 1 life left', check: g => g.wave >= TOTAL_WAVES && g.lives === 1 },
  { id: 'genocide', name: 'Genocide', desc: '100 kills in one game', check: g => g.totalKills >= 100 },
  { id: 'full-grid', name: 'Full Grid', desc: 'Place 20+ towers', check: g => g.towersPlacedThisGame >= 20 },
  { id: 'triple-max', name: 'Triple Max', desc: '3 max-level towers at once', check: g => g.towers.filter(t => t.level >= 3).length >= 3 },
  { id: 'no-sell', name: 'No Sell', desc: 'Win without selling', check: g => g.wave >= TOTAL_WAVES && g.towersSoldThisGame === 0 },
  { id: 'big-spender', name: 'Big Spender', desc: 'Spend 2000+ gold', check: g => g.totalGoldSpent >= 2000 },
  { id: 'laser-focus', name: 'Laser Focus', desc: '30 kills with Laser towers', check: g => g.towerKillsByType.laser >= 30 },
  { id: 'fortress', name: 'Fortress', desc: 'Have 15 towers at once', check: g => g.towers.length >= 15 },
  { id: 'hard-won', name: 'Hard Won', desc: 'Beat game on Hard', check: g => g.wave >= TOTAL_WAVES && g.difficulty === 'hard' },
];

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

const DIFFICULTY_MULTS: Record<Difficulty, { hpMult: number; speedMult: number; rewardMult: number; startGold: number; startLives: number }> = {
  easy:   { hpMult: 0.7,  speedMult: 0.85, rewardMult: 1.3, startGold: 200, startLives: 30 },
  normal: { hpMult: 1.0,  speedMult: 1.0,  rewardMult: 1.0, startGold: 150, startLives: 20 },
  hard:   { hpMult: 1.5,  speedMult: 1.2,  rewardMult: 0.8, startGold: 100, startLives: 15 },
};

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
  achievements: string[];
}

function loadSave(): Save {
  try {
    const d = localStorage.getItem('neon-citadel-save');
    if (d) {
      const parsed = JSON.parse(d);
      if (!parsed.achievements) parsed.achievements = [];
      return parsed;
    }
  } catch { /* ignore */ }
  return { highWave: 0, totalKills: 0, totalGold: 0, gamesPlayed: 0, wins: 0, bestScore: 0, towersBuilt: 0, achievements: [] };
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
  damageNumbers: DamageNumber[] = [];
  particles: Particle[] = [];
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
  difficulty: Difficulty = 'normal';

  // Achievement tracking
  towersPlacedThisGame = 0;
  towersSoldThisGame = 0;
  towerKillsByType: Record<TowerType, number> = { laser: 0, pulse: 0, slow: 0, sniper: 0, chain: 0 };
  enemiesSlowed = 0;
  totalGoldEarned = 0;
  totalGoldSpent = 0;
  wavePerfect = true;
  bossKills = 0;
  ghostKills = 0;
  waveLeaks = 0;

  // Combo system
  comboCount = 0;
  comboTimer = 0;
  maxCombo = 0;
  comboScore = 0;

  // Wave announce
  waveAnnounceTimer = 0;
  showWaveAnnounce = false;

  // Newly unlocked achievements for notification
  pendingAchievements: string[] = [];

  constructor() {
    this.save = loadSave();
    for (let r = 0; r < GRID_SIZE; r++) {
      this.grid[r] = [];
      this.isPath[r] = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        this.grid[r][c] = null;
        this.isPath[r][c] = false;
      }
    }
    for (const [r, c] of PATH_COORDS) {
      if (r < GRID_SIZE && c < GRID_SIZE) this.isPath[r][c] = true;
    }
  }

  canPlace(r: number, c: number): boolean {
    return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE &&
      !this.isPath[r][c] && !this.grid[r][c];
  }

  gridToWorld(r: number, c: number): Vector3 {
    return new Vector3(GRID_OFFSET + c * CELL_SIZE, BOARD_Y, GRID_OFFSET + r * CELL_SIZE);
  }

  resetGameTracking(): void {
    this.towersPlacedThisGame = 0;
    this.towersSoldThisGame = 0;
    this.towerKillsByType = { laser: 0, pulse: 0, slow: 0, sniper: 0, chain: 0 };
    this.enemiesSlowed = 0;
    this.totalGoldEarned = 0;
    this.totalGoldSpent = 0;
    this.wavePerfect = true;
    this.bossKills = 0;
    this.ghostKills = 0;
    this.waveLeaks = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.comboScore = 0;
    this.pendingAchievements = [];
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
  effectsGroup = new Group();
  hoverIndicator!: Mesh;
  hoverRangeRing!: Mesh;
  citadelMesh!: Group;

  build(scene: Object3D, game: GameState): void {
    const s = scene as any;
    s.fog = new FogExp2(0x000a14, 0.5);
    s.background = new Color(0x000a14);

    const ambient = new AmbientLight(0x112233, 0.4);
    scene.add(ambient);
    const dir = new DirectionalLight(0x4488cc, 0.6);
    dir.position.set(2, 5, 2);
    scene.add(dir);

    this.buildGrid(scene);
    this.buildBoard(game);
    scene.add(this.boardGroup);
    scene.add(this.towerGroup);
    scene.add(this.enemyGroup);
    scene.add(this.projectileGroup);
    scene.add(this.effectsGroup);

    this.buildPath(game);
    scene.add(this.pathGroup);
    this.buildCitadel(scene, game);

    // Hover indicator
    this.hoverIndicator = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.9, 0.002, CELL_SIZE * 0.9),
      new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 })
    );
    this.hoverIndicator.visible = false;
    scene.add(this.hoverIndicator);

    // Range preview ring (shown when hovering a placement cell)
    this.hoverRangeRing = new Mesh(
      new RingGeometry(0.1, 0.105, 32),
      new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15, side: DoubleSide })
    );
    this.hoverRangeRing.rotation.x = -Math.PI / 2;
    this.hoverRangeRing.visible = false;
    scene.add(this.hoverRangeRing);
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
    scene.add(new LineSegments(gridGeo, gridMat));
  }

  buildBoard(game: GameState): void {
    const boardW = GRID_SIZE * CELL_SIZE;
    const base = new Mesh(
      new BoxGeometry(boardW + 0.04, 0.01, boardW + 0.04),
      new MeshStandardMaterial({ color: 0x0a1520, metalness: 0.8, roughness: 0.3 })
    );
    base.position.set(0, BOARD_Y - 0.005, 0);
    this.boardGroup.add(base);

    const gridGeo = new BufferGeometry();
    const verts: number[] = [];
    const half = boardW / 2;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const p = -half + i * CELL_SIZE;
      verts.push(p, BOARD_Y + 0.001, -half, p, BOARD_Y + 0.001, half);
      verts.push(-half, BOARD_Y + 0.001, p, half, BOARD_Y + 0.001, p);
    }
    gridGeo.setAttribute('position', new Float32BufferAttribute(verts, 3));
    this.boardGroup.add(new LineSegments(gridGeo, new LineBasicMaterial({ color: 0x004466, transparent: true, opacity: 0.4 })));

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

    // Path direction arrows
    for (let i = 0; i < PATH_COORDS.length - 1; i += 2) {
      const [r1, c1] = PATH_COORDS[i];
      const [r2, c2] = PATH_COORDS[Math.min(i + 1, PATH_COORDS.length - 1)];
      if (r1 >= GRID_SIZE || c1 >= GRID_SIZE) continue;
      const from = game.gridToWorld(r1, c1);
      const to = game.gridToWorld(r2, c2);

      const arrow = new Mesh(
        new ConeGeometry(CELL_SIZE * 0.12, CELL_SIZE * 0.25, 3),
        new MeshBasicMaterial({ color: 0x0066aa, transparent: true, opacity: 0.4 })
      );
      const mid = from.clone().lerp(to, 0.5);
      arrow.position.set(mid.x, BOARD_Y + 0.006, mid.z);
      arrow.rotation.x = -Math.PI / 2;

      // Point arrow in direction of travel
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      arrow.rotation.z = -Math.atan2(dx, dz);
      this.pathGroup.add(arrow);
    }

    // Spawn point marker
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

    const cBase = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.4, CELL_SIZE * 0.5, 0.04, 6),
      new MeshStandardMaterial({ color: 0x00ccff, emissive: 0x004466, metalness: 0.7, roughness: 0.3 })
    );
    cBase.position.set(cPos.x, BOARD_Y + 0.02, cPos.z);
    this.citadelMesh.add(cBase);

    const spire = new Mesh(
      new ConeGeometry(CELL_SIZE * 0.2, 0.1, 6),
      new MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00aacc, metalness: 0.9, roughness: 0.2 })
    );
    spire.position.set(cPos.x, BOARD_Y + 0.09, cPos.z);
    this.citadelMesh.add(spire);

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

    const base = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.35, 0.025, 8),
      new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.4), metalness: 0.8, roughness: 0.3 })
    );
    base.position.y = 0.0125;
    group.add(base);

    const body = new Mesh(
      new CylinderGeometry(CELL_SIZE * 0.2, CELL_SIZE * 0.25, 0.04, 8),
      new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.6), metalness: 0.7, roughness: 0.3 })
    );
    body.position.y = 0.045;
    group.add(body);

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

    const glow = new PointLight(col.getHex(), 0.15, 0.3);
    glow.position.y = 0.08;
    group.add(glow);

    const edges = new EdgesGeometry(new CylinderGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.35, 0.025, 8));
    const wireframe = new LineSegments(edges, new LineBasicMaterial({ color: col, transparent: true, opacity: 0.4 }));
    wireframe.position.y = 0.0125;
    group.add(wireframe);

    return { group, barrelMesh };
  }

  createRangeRing(range: number, color: Color): Mesh {
    const r = range * CELL_SIZE;
    const ring = new Mesh(
      new RingGeometry(r - 0.003, r, 32),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    return ring;
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

    const hbW = 0.04;
    const healthBg = new Mesh(
      new BoxGeometry(hbW, 0.003, 0.003),
      new MeshBasicMaterial({ color: 0x330000 })
    );
    healthBg.position.y = s * 2 + 0.015;
    group.add(healthBg);

    const healthBar = new Mesh(
      new BoxGeometry(hbW, 0.004, 0.004),
      new MeshBasicMaterial({ color: 0x00ff44 })
    );
    healthBar.position.y = s * 2 + 0.015;
    group.add(healthBar);

    return { group, healthBar, healthBg };
  }

  spawnDeathParticles(position: Vector3, color: Color, count: number): Particle[] {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const size = 0.003 + Math.random() * 0.004;
      const mesh = new Mesh(
        new SphereGeometry(size, 4, 4),
        new MeshBasicMaterial({ color, transparent: true, opacity: 1.0 })
      );
      mesh.position.copy(position);
      this.effectsGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const upward = 0.15 + Math.random() * 0.25;
      const outward = 0.05 + Math.random() * 0.15;
      const life = 0.4 + Math.random() * 0.4;

      particles.push({
        mesh,
        life,
        startLife: life,
        velocity: new Vector3(
          Math.cos(angle) * outward,
          upward,
          Math.sin(angle) * outward
        ),
      });
    }
    return particles;
  }

  spawnDamageNumber(position: Vector3, damage: number, color: Color): DamageNumber {
    // Create a small bright sphere as a "damage indicator"
    const mesh = new Mesh(
      new SphereGeometry(0.004 + Math.min(damage / 100, 0.006), 4, 4),
      new MeshBasicMaterial({ color, transparent: true, opacity: 1.0 })
    );
    mesh.position.copy(position);
    mesh.position.y += 0.03;
    this.effectsGroup.add(mesh);

    return {
      mesh,
      life: 0.6,
      velocity: new Vector3((Math.random() - 0.5) * 0.02, 0.12, (Math.random() - 0.5) * 0.02),
    };
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
    const diffSettings = DIFFICULTY_MULTS[this.game.difficulty];
    this.game.screen = 'playing';
    this.game.gold = diffSettings.startGold;
    this.game.lives = diffSettings.startLives;
    this.game.wave = 0;
    this.game.score = 0;
    this.game.totalKills = 0;
    this.game.waveActive = false;
    this.game.paused = false;
    this.game.gameSpeed = 1;
    this.game.selectedTower = null;
    this.game.resetGameTracking();
    this.clearAll();
    this.startNextWave();
  }

  clearAll(): void {
    for (const t of this.game.towers) {
      this.scene.towerGroup.remove(t.group);
      if (t.rangeMesh) this.scene.towerGroup.remove(t.rangeMesh);
    }
    for (const e of this.game.enemies) this.scene.enemyGroup.remove(e.group);
    for (const p of this.game.projectiles) this.scene.projectileGroup.remove(p.mesh);
    for (const d of this.game.damageNumbers) this.scene.effectsGroup.remove(d.mesh);
    for (const p of this.game.particles) this.scene.effectsGroup.remove(p.mesh);
    this.game.towers = [];
    this.game.enemies = [];
    this.game.projectiles = [];
    this.game.damageNumbers = [];
    this.game.particles = [];
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
    this.game.wavePerfect = true;
    this.game.waveLeaks = 0;

    // Trigger wave announcement
    this.game.showWaveAnnounce = true;
    this.game.waveAnnounceTimer = 2.5;
  }

  placeTower(r: number, c: number, type: TowerType): boolean {
    const def = TOWER_DEFS[type];
    if (this.game.gold < def.cost || !this.game.canPlace(r, c)) return false;

    this.game.gold -= def.cost;
    this.game.totalGoldSpent += def.cost;
    const pos = this.game.gridToWorld(r, c);
    const { group, barrelMesh } = this.scene.createTowerMesh(type, pos);
    this.scene.towerGroup.add(group);

    // Range ring (hidden by default, shown when selected)
    const rangeMesh = this.scene.createRangeRing(def.range, new Color(def.color));
    rangeMesh.position.set(pos.x, BOARD_Y + 0.004, pos.z);
    rangeMesh.visible = false;
    this.scene.towerGroup.add(rangeMesh);

    const tower: Tower = {
      type, gridR: r, gridC: c, group, barrelMesh, rangeMesh,
      cooldown: 0, level: 1, kills: 0, targetEntity: null, totalDamageDealt: 0,
      targetMode: 'first', dps: 0, dpsWindow: [], lastDpsUpdate: 0,
    };
    this.game.towers.push(tower);
    this.game.grid[r][c] = tower;
    this.game.save.towersBuilt++;
    this.game.towersPlacedThisGame++;
    return true;
  }

  upgradeTower(tower: Tower): boolean {
    const cost = Math.floor(TOWER_DEFS[tower.type].cost * UPGRADE_COST_MULT * tower.level);
    if (this.game.gold < cost || tower.level >= 3) return false;
    this.game.gold -= cost;
    this.game.totalGoldSpent += cost;
    tower.level++;
    tower.group.scale.setScalar(1 + (tower.level - 1) * 0.15);

    // Update range ring
    if (tower.rangeMesh) {
      this.scene.towerGroup.remove(tower.rangeMesh);
      const def = TOWER_DEFS[tower.type];
      const range = def.range * (1 + (tower.level - 1) * 0.2);
      tower.rangeMesh = this.scene.createRangeRing(range, new Color(def.color));
      const pos = this.game.gridToWorld(tower.gridR, tower.gridC);
      tower.rangeMesh.position.set(pos.x, BOARD_Y + 0.004, pos.z);
      tower.rangeMesh.visible = (this.game.selectedTower === tower);
      this.scene.towerGroup.add(tower.rangeMesh);
    }
    return true;
  }

  sellTower(tower: Tower): void {
    const refund = Math.floor(TOWER_DEFS[tower.type].cost * 0.6 * tower.level);
    this.game.gold += refund;
    this.scene.towerGroup.remove(tower.group);
    if (tower.rangeMesh) this.scene.towerGroup.remove(tower.rangeMesh);
    this.game.grid[tower.gridR][tower.gridC] = null;
    this.game.towers = this.game.towers.filter(t => t !== tower);
    if (this.game.selectedTower === tower) this.game.selectedTower = null;
    this.game.towersSoldThisGame++;
  }

  spawnEnemy(type: EnemyType): void {
    const def = ENEMY_DEFS[type];
    const waveScale = 1 + this.game.wave * 0.15;
    const diffMult = DIFFICULTY_MULTS[this.game.difficulty];
    const { group, healthBar, healthBg } = this.scene.createEnemyMesh(type);
    const startPos = this.game.gridToWorld(PATH_COORDS[0][0], PATH_COORDS[0][1]);
    group.position.copy(startPos);
    this.scene.enemyGroup.add(group);
    const scaledHp = Math.floor(def.hp * waveScale * diffMult.hpMult);
    const scaledReward = Math.floor(def.reward * diffMult.rewardMult);
    const enemy: Enemy = {
      type, hp: scaledHp, maxHp: scaledHp,
      speed: def.speed * diffMult.speedMult, reward: scaledReward,
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

      while (enemy.pathProgress >= 1 && enemy.pathIdx < PATH_COORDS.length - 1) {
        enemy.pathProgress -= 1;
        enemy.pathIdx++;
      }

      if (enemy.pathIdx >= PATH_COORDS.length - 1) {
        this.game.lives--;
        this.game.wavePerfect = false;
        this.game.waveLeaks++;
        enemy.alive = false;
        toRemove.push(enemy);
        this.game.waveEnemiesRemaining--;
        continue;
      }

      const curr = PATH_COORDS[enemy.pathIdx];
      const next = PATH_COORDS[Math.min(enemy.pathIdx + 1, PATH_COORDS.length - 1)];
      const currPos = this.game.gridToWorld(curr[0], curr[1]);
      const nextPos = this.game.gridToWorld(next[0], next[1]);
      enemy.group.position.lerpVectors(currPos, nextPos, Math.min(enemy.pathProgress, 1));

      const hpRatio = enemy.hp / enemy.maxHp;
      enemy.healthBar.scale.x = Math.max(0.01, hpRatio);
      const barColor = hpRatio > 0.6 ? 0x00ff44 : hpRatio > 0.3 ? 0xffaa00 : 0xff2222;
      (enemy.healthBar.material as MeshBasicMaterial).color.setHex(barColor);

      // Pulsing glow for ghost type
      if (enemy.type === 'ghost') {
        (enemy.group.children[0] as Mesh).material = new MeshBasicMaterial({
          color: 0xffffff, transparent: true,
          opacity: 0.3 + Math.sin(Date.now() * 0.005) * 0.2,
        });
      }
    }

    for (const e of toRemove) {
      this.scene.enemyGroup.remove(e.group);
      this.game.enemies = this.game.enemies.filter(en => en !== e);
    }

    if (this.game.lives <= 0) this.endGame(false);
  }

  updateTowers(delta: number): void {
    for (const tower of this.game.towers) {
      tower.cooldown = Math.max(0, tower.cooldown - delta);

      // Update DPS tracking
      const now = performance.now() / 1000;
      tower.dpsWindow = tower.dpsWindow.filter(t => now - t < 5);
      if (now - tower.lastDpsUpdate > 0.5) {
        const windowSecs = tower.dpsWindow.length > 0 ? Math.min(5, now - tower.dpsWindow[0]) : 5;
        const totalDmgInWindow = tower.dpsWindow.length;
        tower.dps = windowSecs > 0 ? (totalDmgInWindow / windowSecs) : 0;
        tower.lastDpsUpdate = now;
      }

      if (tower.cooldown > 0) continue;

      const def = TOWER_DEFS[tower.type];
      const range = def.range * CELL_SIZE * (1 + (tower.level - 1) * 0.2);
      const tPos = this.game.gridToWorld(tower.gridR, tower.gridC);

      // Target selection based on targeting mode
      let target: Enemy | null = null;
      const inRange: Enemy[] = [];
      for (const enemy of this.game.enemies) {
        if (!enemy.alive) continue;
        const dist = tPos.distanceTo(enemy.group.position);
        if (dist <= range) inRange.push(enemy);
      }

      if (inRange.length > 0) {
        switch (tower.targetMode) {
          case 'first':
            target = inRange.reduce((best, e) =>
              e.pathIdx > best.pathIdx || (e.pathIdx === best.pathIdx && e.pathProgress > best.pathProgress) ? e : best
            );
            break;
          case 'last':
            target = inRange.reduce((best, e) =>
              e.pathIdx < best.pathIdx || (e.pathIdx === best.pathIdx && e.pathProgress < best.pathProgress) ? e : best
            );
            break;
          case 'strongest':
            target = inRange.reduce((best, e) => e.hp > best.hp ? e : best);
            break;
          case 'weakest':
            target = inRange.reduce((best, e) => e.hp < best.hp ? e : best);
            break;
        }
      }
      if (!target) continue;

      tower.cooldown = 1 / (def.fireRate * (1 + (tower.level - 1) * 0.15));
      tower.targetEntity = target;

      // Aim barrel at target
      const dir = new Vector3().subVectors(target.group.position, tower.group.position);
      tower.barrelMesh.lookAt(
        tower.barrelMesh.position.clone().add(new Vector3(dir.x, 0, dir.z).normalize())
      );

      const damage = def.damage * (1 + (tower.level - 1) * 0.4);

      // Track DPS window
      tower.dpsWindow.push(performance.now() / 1000);

      if (tower.type === 'pulse') {
        for (const enemy of this.game.enemies) {
          if (!enemy.alive) continue;
          const dist = tPos.distanceTo(enemy.group.position);
          if (dist <= range) {
            const dmg = damage * (1 - dist / range * 0.5);
            this.damageEnemy(enemy, dmg, tower);
          }
        }
        this.createPulseEffect(tPos, range);
      } else if (tower.type === 'slow') {
        for (const enemy of this.game.enemies) {
          if (!enemy.alive) continue;
          const dist = tPos.distanceTo(enemy.group.position);
          if (dist <= range) {
            enemy.slowTimer = 2.0;
            this.game.enemiesSlowed++;
            this.damageEnemy(enemy, damage, tower);
          }
        }
      } else if (tower.type === 'chain') {
        let chainTarget: Enemy | null = target;
        const hit = new Set<Enemy>();
        for (let i = 0; i < 3 && chainTarget; i++) {
          hit.add(chainTarget);
          const dmg = damage * (1 - i * 0.2);
          this.damageEnemy(chainTarget, dmg, tower);
          this.fireProjectile(
            i === 0 ? tPos.clone().setY(BOARD_Y + 0.07) : chainTarget.group.position.clone(),
            chainTarget, tower.type, dmg
          );
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
        // For laser and sniper: create a beam effect
        this.fireProjectile(tPos.clone().setY(BOARD_Y + 0.07), target, tower.type, damage);
        if (tower.type === 'laser') {
          this.createBeamEffect(tPos.clone().setY(BOARD_Y + 0.07), target.group.position.clone(), new Color(def.color));
        }
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
    this.game.projectiles.push({ mesh: proj, target, speed: 3.0, damage, type, origin });
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
    this.scene.effectsGroup.add(ring);

    let life = 0.3;
    const update = () => {
      life -= 0.016;
      ring.scale.setScalar(1 + (0.3 - life) * 2);
      (ring.material as MeshBasicMaterial).opacity = life;
      if (life <= 0) {
        this.scene.effectsGroup.remove(ring);
      } else {
        requestAnimationFrame(update);
      }
    };
    requestAnimationFrame(update);
  }

  createBeamEffect(from: Vector3, to: Vector3, color: Color): void {
    const direction = new Vector3().subVectors(to, from);
    const length = direction.length();
    const midpoint = from.clone().add(direction.multiplyScalar(0.5));

    const beamGeo = new CylinderGeometry(0.002, 0.002, length, 4);
    const beamMat = new MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
      blending: AdditiveBlending,
    });
    const beam = new Mesh(beamGeo, beamMat);
    beam.position.copy(midpoint);
    beam.lookAt(to);
    beam.rotateX(Math.PI / 2);

    this.scene.effectsGroup.add(beam);

    let life = 0.15;
    const fadeBeam = () => {
      life -= 0.016;
      beamMat.opacity = Math.max(0, life / 0.15) * 0.8;
      if (life <= 0) {
        this.scene.effectsGroup.remove(beam);
        beamGeo.dispose();
        beamMat.dispose();
      } else {
        requestAnimationFrame(fadeBeam);
      }
    };
    requestAnimationFrame(fadeBeam);
  }

  updateProjectiles(delta: number): void {
    const toRemove: Projectile[] = [];
    for (const proj of this.game.projectiles) {
      if (!proj.target.alive) { toRemove.push(proj); continue; }
      const dir = new Vector3().subVectors(proj.target.group.position, proj.mesh.position);
      const dist = dir.length();
      if (dist < 0.01) {
        this.damageEnemy(proj.target, proj.damage, null);
        toRemove.push(proj);
      } else {
        dir.normalize().multiplyScalar(proj.speed * delta);
        proj.mesh.position.add(dir);
      }
    }
    for (const p of toRemove) this.scene.projectileGroup.remove(p.mesh);
    this.game.projectiles = this.game.projectiles.filter(p => !toRemove.includes(p));
  }

  damageEnemy(enemy: Enemy, damage: number, tower: Tower | null): void {
    if (!enemy.alive) return;
    enemy.hp -= damage;

    // Spawn damage indicator
    const col = tower ? new Color(TOWER_DEFS[tower.type].color) : new Color(0xff4444);
    const dmgNum = this.scene.spawnDamageNumber(enemy.group.position.clone(), damage, col);
    this.game.damageNumbers.push(dmgNum);

    if (tower) tower.totalDamageDealt += damage;

    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      this.game.gold += enemy.reward;
      this.game.totalGoldEarned += enemy.reward;
      this.game.totalKills++;
      this.game.waveEnemiesRemaining--;

      // Combo system: kills within 1.5s increase combo
      this.game.comboCount++;
      this.game.comboTimer = 1.5;
      if (this.game.comboCount > this.game.maxCombo) {
        this.game.maxCombo = this.game.comboCount;
      }

      // Combo bonus: extra score and gold for streaks
      const comboMult = Math.min(this.game.comboCount, 10);
      const comboBonus = Math.floor(enemy.reward * (comboMult - 1) * 0.2);
      this.game.gold += comboBonus;
      this.game.totalGoldEarned += comboBonus;
      this.game.comboScore += comboBonus;

      this.game.score += enemy.reward * 2 + comboBonus;

      // Track tower kills
      if (tower) {
        tower.kills++;
        this.game.towerKillsByType[tower.type]++;
      }

      // Track special kills
      if (enemy.type === 'boss') this.game.bossKills++;
      if (enemy.type === 'ghost') this.game.ghostKills++;

      // Death particles
      const enemyColor = new Color(ENEMY_DEFS[enemy.type].color);
      const newParticles = this.scene.spawnDeathParticles(enemy.group.position.clone(), enemyColor, 8);
      this.game.particles.push(...newParticles);

      this.scene.enemyGroup.remove(enemy.group);
      this.game.enemies = this.game.enemies.filter(e => e !== enemy);
    }
  }

  updateEffects(delta: number): void {
    // Damage numbers
    const dnRemove: DamageNumber[] = [];
    for (const dn of this.game.damageNumbers) {
      dn.life -= delta;
      dn.mesh.position.add(dn.velocity.clone().multiplyScalar(delta));
      (dn.mesh.material as MeshBasicMaterial).opacity = Math.max(0, dn.life / 0.6);
      dn.mesh.scale.setScalar(1 + (0.6 - dn.life) * 0.5);
      if (dn.life <= 0) dnRemove.push(dn);
    }
    for (const d of dnRemove) this.scene.effectsGroup.remove(d.mesh);
    this.game.damageNumbers = this.game.damageNumbers.filter(d => !dnRemove.includes(d));

    // Particles
    const pRemove: Particle[] = [];
    for (const p of this.game.particles) {
      p.life -= delta;
      p.velocity.y -= 0.3 * delta; // gravity
      p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
      (p.mesh.material as MeshBasicMaterial).opacity = Math.max(0, p.life / p.startLife);
      if (p.life <= 0) pRemove.push(p);
    }
    for (const p of pRemove) this.scene.effectsGroup.remove(p.mesh);
    this.game.particles = this.game.particles.filter(p => !pRemove.includes(p));
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
      this.game.gold += 20 + this.game.wave * 5;
      this.game.totalGoldEarned += 20 + this.game.wave * 5;
      this.game.score += 100 * this.game.wave;

      // Check achievements after wave
      this.checkAchievements();

      if (this.game.wave >= TOTAL_WAVES) {
        this.endGame(true);
      } else {
        setTimeout(() => {
          if (this.game.screen === 'playing') this.startNextWave();
        }, 2000);
      }
    }
  }

  checkAchievements(): void {
    for (const ach of ACHIEVEMENT_DEFS) {
      if (this.game.save.achievements.includes(ach.id)) continue;
      if (ach.check(this.game)) {
        this.game.save.achievements.push(ach.id);
        this.game.pendingAchievements.push(ach.name);
      }
    }
    writeSave(this.game.save);
  }

  endGame(won: boolean): void {
    this.game.screen = 'gameover';
    this.game.save.gamesPlayed++;
    this.game.save.totalKills += this.game.totalKills;
    this.game.save.totalGold += this.game.gold;
    if (this.game.wave > this.game.save.highWave) this.game.save.highWave = this.game.wave;
    if (this.game.score > this.game.save.bestScore) this.game.save.bestScore = this.game.score;
    if (won) this.game.save.wins++;
    this.checkAchievements();
    writeSave(this.game.save);
  }

  handleBoardClick(camera: any, ndcX: number, ndcY: number): void {
    if (this.game.screen !== 'playing' || this.game.paused) return;
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

    // Check if clicking on existing tower
    for (const tower of this.game.towers) {
      const intersects = this.raycaster.intersectObject(tower.group, true);
      if (intersects.length > 0) {
        this.selectTower(tower);
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
          this.selectTower(this.game.grid[r][c]!);
          return;
        } else {
          this.placeTower(r, c, this.game.selectedTowerType);
        }
      }
    }
    this.deselectTower();
  }

  selectTower(tower: Tower): void {
    // Hide previous tower's range
    if (this.game.selectedTower && this.game.selectedTower !== tower && this.game.selectedTower.rangeMesh) {
      this.game.selectedTower.rangeMesh.visible = false;
    }
    this.game.selectedTower = tower;
    if (tower.rangeMesh) tower.rangeMesh.visible = true;
  }

  deselectTower(): void {
    if (this.game.selectedTower?.rangeMesh) {
      this.game.selectedTower.rangeMesh.visible = false;
    }
    this.game.selectedTower = null;
  }

  update(delta: number): void {
    // Update effects always (even when paused for visual continuity)
    this.updateEffects(delta);

    // Wave announcement timer
    if (this.game.showWaveAnnounce) {
      this.game.waveAnnounceTimer -= delta;
      if (this.game.waveAnnounceTimer <= 0) {
        this.game.showWaveAnnounce = false;
      }
    }

    // Combo timer decay (always ticks even during pause)
    if (this.game.comboTimer > 0) {
      this.game.comboTimer -= delta;
      if (this.game.comboTimer <= 0) {
        this.game.comboCount = 0;
        this.game.comboTimer = 0;
      }
    }

    if (this.game.screen !== 'playing' || this.game.paused) return;
    const dt = delta * this.game.gameSpeed;
    this.updateSpawning(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.checkWaveComplete();

    // Periodic achievement check during gameplay
    if (Math.random() < 0.01) this.checkAchievements();
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
  towerInfoDoc: UIKitDocument | null = null;
  achievementsDoc: UIKitDocument | null = null;
  waveAnnounceDoc: UIKitDocument | null = null;

  hudEntity: any = null;
  titleEntity: any = null;
  towerEntity: any = null;
  gameoverEntity: any = null;
  helpEntity: any = null;
  pauseEntity: any = null;
  towerInfoEntity: any = null;
  achievementsEntity: any = null;
  waveAnnounceEntity: any = null;

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
    const btnAch = doc.getElementById('btn-achievements') as UIKit.Text | undefined;
    btnAch?.addEventListener('click', () => {
      this.game.screen = 'achievements';
      this.updateAchievements();
      this.updateVisibility();
    });

    // Difficulty buttons
    const difficulties: Difficulty[] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      const btn = doc.getElementById(`btn-${diff}`) as UIKit.Text | undefined;
      btn?.addEventListener('click', () => {
        this.game.difficulty = diff;
        this.updateDifficultyButtons();
      });
    }
    this.updateDifficultyButtons();

    const statsText = doc.getElementById('stats-text') as UIKit.Text | undefined;
    const s = this.game.save;
    statsText?.setProperties({
      text: `Best Wave: ${s.highWave} | Kills: ${s.totalKills} | Wins: ${s.wins}`,
    });

    const achCountText = doc.getElementById('ach-count-title') as UIKit.Text | undefined;
    achCountText?.setProperties({
      text: `${s.achievements.length}/${ACHIEVEMENT_DEFS.length} Achievements`,
    });
  }

  updateDifficultyButtons(): void {
    if (!this.titleDoc) return;
    const diffs: { id: Difficulty; color: string; borderColor: string; activeColor: string; activeBorder: string }[] = [
      { id: 'easy', color: '#44ff44', borderColor: '#226622', activeColor: '#003300', activeBorder: '#44ff44' },
      { id: 'normal', color: '#00ccff', borderColor: '#0066aa', activeColor: '#002244', activeBorder: '#00ccff' },
      { id: 'hard', color: '#ff4444', borderColor: '#663333', activeColor: '#330000', activeBorder: '#ff4444' },
    ];
    for (const d of diffs) {
      const btn = this.titleDoc.getElementById(`btn-${d.id}`) as UIKit.Text | undefined;
      const isActive = this.game.difficulty === d.id;
      btn?.setProperties({
        borderWidth: isActive ? 2 : 1,
        borderColor: isActive ? d.activeBorder : d.borderColor,
        backgroundColor: isActive ? d.activeColor : '#112233',
      });
    }
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

  bindTowerInfo(doc: UIKitDocument, entity: any): void {
    this.towerInfoDoc = doc;
    this.towerInfoEntity = entity;

    const btnUpgrade = doc.getElementById('btn-upgrade') as UIKit.Text | undefined;
    btnUpgrade?.addEventListener('click', () => {
      if (this.game.selectedTower) {
        this.logic.upgradeTower(this.game.selectedTower);
        this.updateTowerInfo();
      }
    });
    const btnSell = doc.getElementById('btn-sell') as UIKit.Text | undefined;
    btnSell?.addEventListener('click', () => {
      if (this.game.selectedTower) {
        this.logic.sellTower(this.game.selectedTower);
        this.updateVisibility();
      }
    });
    const btnClose = doc.getElementById('btn-close-info') as UIKit.Text | undefined;
    btnClose?.addEventListener('click', () => {
      this.logic.deselectTower();
      this.updateVisibility();
    });
    const btnTarget = doc.getElementById('btn-target') as UIKit.Text | undefined;
    btnTarget?.addEventListener('click', () => {
      if (this.game.selectedTower) {
        const modes: TargetMode[] = ['first', 'last', 'strongest', 'weakest'];
        const idx = modes.indexOf(this.game.selectedTower.targetMode);
        this.game.selectedTower.targetMode = modes[(idx + 1) % modes.length];
        this.updateTowerInfo();
      }
    });
  }

  bindAchievements(doc: UIKitDocument, entity: any): void {
    this.achievementsDoc = doc;
    this.achievementsEntity = entity;
    const btnClose = doc.getElementById('btn-close-ach') as UIKit.Text | undefined;
    btnClose?.addEventListener('click', () => {
      this.game.screen = 'title';
      this.updateVisibility();
    });
  }

  bindWaveAnnounce(doc: UIKitDocument, entity: any): void {
    this.waveAnnounceDoc = doc;
    this.waveAnnounceEntity = entity;
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
    setText('speed-text', `${this.game.gameSpeed}x`);
    setText('diff-text', this.game.difficulty.toUpperCase());

    const selected = this.game.selectedTowerType;
    const def = TOWER_DEFS[selected];
    setText('selected-text', `[${def.name}] $${def.cost} | DMG:${def.damage} | RNG:${def.range}`);

    // Combo display
    if (this.game.comboCount >= 2) {
      const comboEl = this.hudDoc.getElementById('combo-text') as UIKit.Text | undefined;
      comboEl?.setProperties({
        text: `${this.game.comboCount}x COMBO!`,
        color: this.game.comboCount >= 8 ? '#ff00ff' : this.game.comboCount >= 5 ? '#ff8800' : '#ffcc00',
      });
    } else {
      const comboEl = this.hudDoc.getElementById('combo-text') as UIKit.Text | undefined;
      comboEl?.setProperties({ text: '' });
    }

    // Achievement notification
    if (this.game.pendingAchievements.length > 0) {
      const achName = this.game.pendingAchievements[0];
      setText('ach-notify', `Achievement: ${achName}!`);
      // Clear after showing
      setTimeout(() => {
        this.game.pendingAchievements.shift();
        const el = this.hudDoc?.getElementById('ach-notify') as UIKit.Text | undefined;
        el?.setProperties({ text: '' });
      }, 3000);
    }
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

  updateTowerInfo(): void {
    if (!this.towerInfoDoc || !this.game.selectedTower) return;
    const tower = this.game.selectedTower;
    const def = TOWER_DEFS[tower.type];
    const damage = def.damage * (1 + (tower.level - 1) * 0.4);
    const range = def.range * (1 + (tower.level - 1) * 0.2);
    const fireRate = def.fireRate * (1 + (tower.level - 1) * 0.15);
    const upgradeCost = tower.level < 3 ? Math.floor(def.cost * UPGRADE_COST_MULT * tower.level) : 0;
    const sellValue = Math.floor(def.cost * 0.6 * tower.level);

    const setText = (id: string, text: string) => {
      const el = this.towerInfoDoc!.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };

    setText('tower-name', `${def.name} Tower`);
    setText('tower-type', `Type: ${def.desc}`);
    setText('tower-level', `Level: ${tower.level}/3`);
    setText('tower-damage', `Damage: ${damage.toFixed(1)}`);
    setText('tower-range', `Range: ${range.toFixed(1)}`);
    setText('tower-fire-rate', `Fire Rate: ${fireRate.toFixed(1)}/s`);
    setText('tower-kills', `Kills: ${tower.kills} | DMG: ${Math.floor(tower.totalDamageDealt)}`);

    // DPS display
    const theoreticalDps = damage * fireRate;
    setText('tower-dps', `DPS: ${theoreticalDps.toFixed(1)} (${tower.dps > 0 ? tower.dps.toFixed(1) : '0'} actual)`);

    // Target mode button
    const targetModeNames: Record<TargetMode, string> = {
      first: 'First', last: 'Last', strongest: 'Strongest', weakest: 'Weakest',
    };
    const btnTarget = this.towerInfoDoc.getElementById('btn-target') as UIKit.Text | undefined;
    btnTarget?.setProperties({ text: `Target: ${targetModeNames[tower.targetMode]}` });

    const btnUpgrade = this.towerInfoDoc.getElementById('btn-upgrade') as UIKit.Text | undefined;
    if (tower.level >= 3) {
      btnUpgrade?.setProperties({ text: 'MAX LEVEL', backgroundColor: '#333333' });
    } else {
      const canAfford = this.game.gold >= upgradeCost;
      btnUpgrade?.setProperties({
        text: `Upgrade ($${upgradeCost})`,
        backgroundColor: canAfford ? '#003344' : '#220000',
      });
    }

    const btnSell = this.towerInfoDoc.getElementById('btn-sell') as UIKit.Text | undefined;
    btnSell?.setProperties({ text: `Sell ($${sellValue})` });
  }

  updateGameover(): void {
    if (!this.gameoverDoc) return;
    const won = this.game.wave >= TOTAL_WAVES;
    const setText = (id: string, text: string) => {
      const el = this.gameoverDoc!.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };
    setText('result-text', won ? 'VICTORY!' : 'CITADEL FELL');
    setText('final-score', `Score: ${this.game.score} (${this.game.difficulty.toUpperCase()})`);
    setText('final-wave', `Wave: ${this.game.wave}/${TOTAL_WAVES}`);
    setText('final-kills', `Kills: ${this.game.totalKills} | Max Combo: ${this.game.maxCombo}x`);
    setText('final-ach', `New Achievements: ${this.game.pendingAchievements.length > 0 ? this.game.pendingAchievements.join(', ') : 'None'}`);
  }

  updateAchievements(): void {
    if (!this.achievementsDoc) return;
    const unlocked = this.game.save.achievements;

    const countEl = this.achievementsDoc.getElementById('ach-count') as UIKit.Text | undefined;
    countEl?.setProperties({ text: `${unlocked.length} / ${ACHIEVEMENT_DEFS.length} Unlocked` });

    for (let i = 0; i < ACHIEVEMENT_DEFS.length; i++) {
      const ach = ACHIEVEMENT_DEFS[i];
      const el = this.achievementsDoc.getElementById(`ach-${i}`) as UIKit.Text | undefined;
      const isUnlocked = unlocked.includes(ach.id);
      el?.setProperties({
        text: `${isUnlocked ? '[*] ' : '[ ] '}${ach.name} - ${ach.desc}`,
        color: isUnlocked ? '#ffcc00' : '#446688',
        backgroundColor: isUnlocked ? '#1a1a00' : '#112233',
      });
    }
  }

  updateWaveAnnounce(): void {
    if (!this.waveAnnounceDoc) return;
    const waveDef = WAVES[this.game.wave];
    const setText = (id: string, text: string) => {
      const el = this.waveAnnounceDoc!.getElementById(id) as UIKit.Text | undefined;
      el?.setProperties({ text });
    };
    setText('wave-announce', `WAVE ${this.game.wave + 1}`);

    // Describe enemies
    const enemyDescs: string[] = [];
    for (const group of waveDef.enemies) {
      const def = ENEMY_DEFS[group.type];
      enemyDescs.push(`${group.count} ${def.name}${group.count > 1 ? 's' : ''}`);
    }
    setText('wave-enemies', enemyDescs.join(' + '));

    if (this.game.wave >= 20) {
      setText('wave-desc', 'FINAL WAVES - Hold the line!');
    } else if (this.game.wave >= 10) {
      setText('wave-desc', 'They grow stronger...');
    } else if (this.game.wave >= 5) {
      setText('wave-desc', 'New threats approaching!');
    } else {
      setText('wave-desc', 'Incoming enemies!');
    }
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
    show(this.towerInfoEntity, this.game.screen === 'playing' && this.game.selectedTower !== null);
    show(this.achievementsEntity, this.game.screen === 'achievements');
    show(this.waveAnnounceEntity, this.game.screen === 'playing' && this.game.showWaveAnnounce);

    if (this.game.screen === 'gameover') this.updateGameover();
    if (this.game.screen === 'achievements') this.updateAchievements();
    if (this.game.showWaveAnnounce) this.updateWaveAnnounce();
    if (this.game.selectedTower) this.updateTowerInfo();
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
  towerInfoPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/tower-info.json')] },
  achievementsPanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achvlist.json')] },
  waveAnnouncePanels: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/wave-announce.json')] },
}) {
  private game!: GameState;
  private logic!: GameLogic;
  private ui!: UIManager;
  private hudUpdateTimer = 0;
  private xrStickDebounce = 0;

  setRefs(refs: { game: GameState; logic: GameLogic; ui: UIManager }): void {
    this.game = refs.game;
    this.logic = refs.logic;
    this.ui = refs.ui;
  }

  init(): void {
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
    this.queries.towerInfoPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindTowerInfo(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.achievementsPanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindAchievements(doc, entity);
      this.ui.updateVisibility();
    });
    this.queries.waveAnnouncePanels.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (doc) this.ui.bindWaveAnnounce(doc, entity);
      this.ui.updateVisibility();
    });
  }

  update(delta: number, time: number): void {
    this.logic.update(delta);

    this.hudUpdateTimer += delta;
    if (this.hudUpdateTimer >= 0.1) {
      this.hudUpdateTimer = 0;
      this.ui.updateHud();
      this.ui.updateTowerSelection();
      if (this.game.selectedTower) this.ui.updateTowerInfo();

      // Update wave announce + tower info visibility
      const showTowerInfo = this.game.screen === 'playing' && this.game.selectedTower !== null;
      if (this.ui.towerInfoEntity?.object3D) {
        this.ui.towerInfoEntity.object3D.visible = showTowerInfo;
      }
      const showWaveAnnounce = this.game.screen === 'playing' && this.game.showWaveAnnounce;
      if (this.ui.waveAnnounceEntity?.object3D) {
        this.ui.waveAnnounceEntity.object3D.visible = showWaveAnnounce;
      }
    }

    this.handleKeyboard();
    this.handleXRInput(delta);

    // Animate citadel spire
    if (this.logic.scene.citadelMesh) {
      this.logic.scene.citadelMesh.children.forEach((child, i) => {
        if (i === 1) child.rotation.y = time * 1.5;
      });
    }

    // Hover indicator pulse
    if (this.logic.scene.hoverIndicator.visible) {
      const mat = this.logic.scene.hoverIndicator.material as MeshBasicMaterial;
      mat.opacity = 0.2 + Math.sin(time * 4) * 0.1;
    }

    // Range preview ring pulse
    if (this.logic.scene.hoverRangeRing.visible) {
      const mat = this.logic.scene.hoverRangeRing.material as MeshBasicMaterial;
      mat.opacity = 0.1 + Math.sin(time * 3) * 0.05;
    }
  }

  handleKeyboard(): void {
    const inp = (this.world as any).input as RuntimeInput | undefined;
    if (!inp?.keyboard) return;
    const kb = inp.keyboard;

    if (kb.getKeyDown('Digit1')) this.game.selectedTowerType = 'laser';
    if (kb.getKeyDown('Digit2')) this.game.selectedTowerType = 'pulse';
    if (kb.getKeyDown('Digit3')) this.game.selectedTowerType = 'slow';
    if (kb.getKeyDown('Digit4')) this.game.selectedTowerType = 'sniper';
    if (kb.getKeyDown('Digit5')) this.game.selectedTowerType = 'chain';

    if (kb.getKeyDown('Escape') || kb.getKeyDown('KeyP')) {
      if (this.game.screen === 'playing') {
        this.game.paused = !this.game.paused;
        this.ui.updateVisibility();
      }
    }

    if (kb.getKeyDown('KeyF')) {
      this.game.gameSpeed = this.game.gameSpeed >= 3 ? 1 : this.game.gameSpeed + 1;
    }

    if (kb.getKeyDown('KeyX') && this.game.selectedTower) {
      this.logic.sellTower(this.game.selectedTower);
      this.ui.updateVisibility();
    }
    if (kb.getKeyDown('KeyU') && this.game.selectedTower) {
      this.logic.upgradeTower(this.game.selectedTower);
      this.ui.updateTowerInfo();
    }

    // Tab to deselect tower
    if (kb.getKeyDown('Tab')) {
      this.logic.deselectTower();
      this.ui.updateVisibility();
    }
  }

  handleXRInput(delta: number): void {
    const inp = (this.world as any).input as RuntimeInput | undefined;
    const right = inp?.xr?.gamepads?.right;
    if (!right) return;

    if (right.getButtonDown(InputComponent.Trigger)) {
      if (this.game.screen === 'playing' && this.game.hoveredCell) {
        const { r, c } = this.game.hoveredCell;
        if (this.game.grid[r][c]) {
          this.logic.selectTower(this.game.grid[r][c]!);
          this.ui.updateVisibility();
        } else {
          this.logic.placeTower(r, c, this.game.selectedTowerType);
        }
      }
    }

    // Debounced thumbstick tower cycling
    this.xrStickDebounce = Math.max(0, this.xrStickDebounce - delta);
    const stick = right.getAxesValues(InputComponent.Thumbstick);
    if (stick && Math.abs(stick.x) > 0.7 && this.xrStickDebounce <= 0) {
      const types: TowerType[] = ['laser', 'pulse', 'slow', 'sniper', 'chain'];
      const idx = types.indexOf(this.game.selectedTowerType);
      const newIdx = stick.x > 0
        ? (idx + 1) % types.length
        : (idx - 1 + types.length) % types.length;
      this.game.selectedTowerType = types[newIdx];
      this.xrStickDebounce = 0.3;
    }

    if (right.getButtonDown(InputComponent.B_Button) && this.game.selectedTower) {
      this.logic.sellTower(this.game.selectedTower);
      this.ui.updateVisibility();
    }
    if (right.getButtonDown(InputComponent.A_Button) && this.game.selectedTower) {
      this.logic.upgradeTower(this.game.selectedTower);
      this.ui.updateTowerInfo();
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

  const game = new GameState();
  const sceneBuilder = new SceneBuilder();
  const logic = new GameLogic(game, sceneBuilder);
  const ui = new UIManager(game, logic);

  sceneBuilder.build(world.scene, game);

  // Panel configs: config path, position, name
  const panelConfigs = [
    { config: './ui/title.json', pos: [0, 0, -1.5], name: 'title' },
    { config: './ui/hud.json', pos: [0, 0.35, -1.2], name: 'hud' },
    { config: './ui/tower-select.json', pos: [-0.55, -0.1, -1.2], name: 'tower-select' },
    { config: './ui/gameover.json', pos: [0, 0, -1.5], name: 'gameover' },
    { config: './ui/help.json', pos: [0, 0, -1.5], name: 'help' },
    { config: './ui/pause.json', pos: [0, 0, -1.5], name: 'pause' },
    { config: './ui/tower-info.json', pos: [0.55, -0.1, -1.2], name: 'tower-info' },
    { config: './ui/achvlist.json', pos: [0, 0, -1.5], name: 'achievements' },
    { config: './ui/wave-announce.json', pos: [0, 0.15, -1.3], name: 'wave-announce' },
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
      entity.object3D.visible = false;
    }
  }

  world.registerSystem(GameSystem);
  const gameSystem = world.getSystem(GameSystem)!;
  gameSystem.setRefs({ game, logic, ui });

  // Canvas click handler
  const canvas = world.renderer.domElement;
  canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    logic.handleBoardClick(world.camera, ndcX, ndcY);
    ui.updateVisibility();
  });

  // Mousemove for hover + range preview
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

        // Show range preview for selected tower type
        const def = TOWER_DEFS[game.selectedTowerType];
        const rangeWorld = def.range * CELL_SIZE;
        sceneBuilder.hoverRangeRing.position.set(pos.x, BOARD_Y + 0.003, pos.z);
        // Scale the ring geometry to match range
        const ringInner = rangeWorld - 0.003;
        const ringOuter = rangeWorld;
        sceneBuilder.hoverRangeRing.geometry.dispose();
        sceneBuilder.hoverRangeRing.geometry = new RingGeometry(ringInner, ringOuter, 32);
        (sceneBuilder.hoverRangeRing.material as MeshBasicMaterial).color.set(def.color);
        sceneBuilder.hoverRangeRing.visible = true;
      } else {
        game.hoveredCell = null;
        sceneBuilder.hoverIndicator.visible = false;
        sceneBuilder.hoverRangeRing.visible = false;
      }
    } else {
      game.hoveredCell = null;
      sceneBuilder.hoverIndicator.visible = false;
      sceneBuilder.hoverRangeRing.visible = false;
    }
  });
}

main().catch(console.error);
