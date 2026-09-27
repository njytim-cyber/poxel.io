// Background thread: generates chunk terrain and builds section meshes.
import { generateChunkData, meshSection, transferables, type SectionInput } from '../shared/worldgen.ts';

export type WorkerRequest =
  | { id: number; type: 'gen'; cx: number; cz: number; seed: number }
  | { id: number; type: 'mesh'; input: SectionInput };

const ctx = self as unknown as { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };

ctx.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.type === 'gen') {
      const data = generateChunkData(req.cx, req.cz, req.seed);
      ctx.postMessage({ id: req.id, ok: true, data }, [data.buffer]);
    } else {
      const out = meshSection(req.input);
      ctx.postMessage({ id: req.id, ok: true, out }, transferables(out));
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: String(err) });
  }
};
