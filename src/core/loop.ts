/**
 * Boucle à pas fixe avec accumulateur.
 * - la simulation avance par pas de 1/60 s (plafonné en nombre de sous-pas) ;
 * - le rendu reçoit `alpha` pour interpoler entre les deux derniers états.
 */
export interface LoopCallbacks {
  fixedUpdate(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5;
const MAX_FRAME_DT = 0.25;

export class FixedLoop {
  private last = -1;
  private acc = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  /** À appeler à chaque image (depuis renderer.setAnimationLoop). */
  tick(nowMs: number): void {
    const now = nowMs / 1000;
    if (this.last < 0) this.last = now;
    let frameDt = now - this.last;
    this.last = now;
    // Onglet en arrière-plan : on n'essaie pas de rattraper le temps perdu.
    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;

    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.cb.fixedUpdate(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS && this.acc > FIXED_DT) this.acc = 0; // évite la spirale de la mort

    this.cb.render(this.acc / FIXED_DT, frameDt);
  }
}
