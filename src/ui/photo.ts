import { $ } from './dom';

/** Elements hidden while a photograph is taken. */
const CHROME = ['status', 'inventory', 'quests', 'minimap', 'debug', 'areaName', 'compass', 'toast', 'castbar', 'chatPanel'];

/**
 * Photo mode: the interface steps out of the way and the camera comes free, so a world worth
 * looking at can be looked at. The shot is taken from the live canvas, so what you frame is
 * what you get.
 */
export class PhotoMode {
  private on = false;
  private readonly hint = $('photoHint');

  get active(): boolean { return this.on; }

  toggle(): boolean {
    this.on = !this.on;
    for (const id of CHROME) $(id).classList.toggle('photo-hidden', this.on);
    this.hint.classList.toggle('show', this.on);
    return this.on;
  }

  /**
   * Save the canvas as a PNG. The renderer must have drawn this frame with `preserveDrawingBuffer`,
   * so the caller redraws immediately before calling.
   */
  save(canvas: HTMLCanvasElement, seed: number): string {
    const name = `ai-world-${seed}-${stamp()}.png`;
    const link = document.createElement('a');
    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();
    return name;
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
