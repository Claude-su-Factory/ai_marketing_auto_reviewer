import { vi } from "vitest";

const sharpMock = vi.fn((_path?: string) => ({
  metadata: vi.fn().mockResolvedValue({ width: 1080, height: 1080, format: "jpeg", size: 342000 }),
}));

export default sharpMock;
