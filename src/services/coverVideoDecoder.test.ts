import { describe, it } from 'node:test';
import assert from 'node:assert';
import { serializeAvcDescription } from './coverVideoDecoder';

describe('Cover clip avcC description', () => {
  it('should return the box payload without the 8-byte header', () => {
    const fullBox = [0, 0, 0, 12, 0x61, 0x76, 0x63, 0x43, 1, 2, 3, 4];
    const stubBox = {
      write(stream: { writeUint8: (v: number) => void }) {
        for (const b of fullBox) stream.writeUint8(b);
      },
    };
    assert.deepStrictEqual(
      Array.from(serializeAvcDescription(stubBox)),
      [1, 2, 3, 4],
    );
  });
});
