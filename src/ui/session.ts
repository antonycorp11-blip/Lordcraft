import type { Game } from '../sim/game';
import type { Renderer } from '../render/renderer';
import type { Minimap } from '../render/minimap';
import type { AIController } from '../ai/ai';
import type { Formation } from '../sim/commands';

// Estado compartilhado da sessão de jogo (interface ↔ entrada ↔ laço).
export type Mode =
  | { k: 'none' }
  | { k: 'move' } | { k: 'amove' } | { k: 'patrol' } | { k: 'guard' } | { k: 'rally' }
  | { k: 'build'; type: string }
  | { k: 'cast'; ability: string };

export interface Session {
  g: Game;
  r: Renderer;
  mm: Minimap;
  ais: AIController[];
  pid: number;
  selection: number[];
  groups: number[][];
  mode: Mode;
  formation: Formation;
  speed: number;
  paused: boolean;
  quality: string;
  isTouch: boolean;
  touchSelectMode: boolean;
  quickOrders: boolean;
  subgroup: string;
  lastAlert: { x: number; y: number } | null;
  dirty: boolean;
  onExit: () => void;
}
