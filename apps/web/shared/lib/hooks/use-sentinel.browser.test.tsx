import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSentinel } from "@/shared/lib/hooks/use-sentinel";

type Callback = (
  entries: Pick<IntersectionObserverEntry, "isIntersecting">[],
) => void;

function stubObserver() {
  const instances: { callback: Callback; disconnect: () => void }[] = [];
  class FakeObserver {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: Callback) {
      instances.push({ callback, disconnect: this.disconnect });
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  return instances;
}

function Probe({
  onVisible,
  enabled,
}: {
  onVisible: () => void;
  enabled: boolean;
}) {
  const ref = useSentinel(onVisible, { enabled });
  return <div ref={ref} data-testid="sentinel" />;
}

afterEach(() => vi.unstubAllGlobals());

describe("useSentinel", () => {
  it("calls back only while the sentinel intersects", () => {
    const instances = stubObserver();
    const onVisible = vi.fn();
    render(<Probe onVisible={onVisible} enabled />);

    expect(instances).toHaveLength(1);
    instances[0]?.callback([{ isIntersecting: false }]);
    expect(onVisible).not.toHaveBeenCalled();
    instances[0]?.callback([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("observes nothing while disabled and disconnects on unmount", () => {
    const instances = stubObserver();
    const { rerender, unmount } = render(
      <Probe onVisible={vi.fn()} enabled={false} />,
    );
    expect(instances).toHaveLength(0);

    rerender(<Probe onVisible={vi.fn()} enabled />);
    expect(instances).toHaveLength(1);

    unmount();
    expect(instances[0]?.disconnect).toHaveBeenCalled();
  });
});
